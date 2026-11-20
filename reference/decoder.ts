/**
 * Dalkanes reference encoder and decoder for `0xD1` calls (spec v0.2, section 5).
 *
 * Dependency-free TypeScript that runs in browsers and Node 18+.
 * Ported from the Dig wallet and dogexplorer helpers. It follows the reference
 * indexer's wire rules strictly: the version byte is required, and the first
 * output that decodes wins.
 *
 * SPDX-License-Identifier: MIT
 */

export const MAGIC = 0xd1;
export const VERSION = 0x01;
export const DEPLOY_MAGIC = Uint8Array.of(0x00, 0x41, 0x4c, 0x4b); // "\0ALK"
export const WASM_MAGIC = Uint8Array.of(0x00, 0x61, 0x73, 0x6d); // "\0asm"
export const MAX_INPUTS = 256;
export const MAX_RELAY_PAYLOAD = 80; // Dogecoin Core default datacarrier limit
export const CALLDATA_PTR = 0x1000;

const U128_MAX = (1n << 128n) - 1n;
const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = (1n << 32n) - 1n;

export interface Cellpack {
  targetBlock: bigint;
  targetTx: bigint;
  fuel: bigint;
  inputs: bigint[];
}

/* ------------------------------------------------------------------ LEB128 */

export function encodeLeb128(value: bigint): number[] {
  if (value < 0n || value > U128_MAX) throw new RangeError('LEB128 value out of u128 range');
  const out: number[] = [];
  let v = value;
  for (;;) {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v === 0n) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

/** Decodes one u128 varint at `pos.i`. Returns null if it is truncated or overflows u128. */
export function decodeLeb128(bytes: Uint8Array, pos: { i: number }): bigint | null {
  let value = 0n;
  let shift = 0n;
  for (;;) {
    if (pos.i >= bytes.length) return null;
    const b = bytes[pos.i++]!;
    value |= BigInt(b & 0x7f) << shift;
    if (value > U128_MAX) return null;
    shift += 7n;
    if ((b & 0x80) === 0) return value;
    if (shift >= 128n) return null;
  }
}

/* ---------------------------------------------------------------- Cellpack */

export function encodeCellpack(cp: Cellpack): Uint8Array {
  if (cp.inputs.length > MAX_INPUTS) throw new RangeError(`more than ${MAX_INPUTS} inputs`);
  if (cp.targetBlock > U64_MAX) throw new RangeError('target_block exceeds u64');
  if (cp.targetTx > U32_MAX) throw new RangeError('target_tx exceeds u32');
  const out: number[] = [];
  for (const v of [cp.targetBlock, cp.targetTx, cp.fuel, BigInt(cp.inputs.length), ...cp.inputs]) {
    out.push(...encodeLeb128(v));
  }
  return Uint8Array.from(out);
}

/** Spec section 5.2. Trailing bytes are ignored. */
export function decodeCellpack(bytes: Uint8Array): Cellpack | null {
  const pos = { i: 0 };
  const targetBlock = decodeLeb128(bytes, pos);
  const targetTx = decodeLeb128(bytes, pos);
  const fuel = decodeLeb128(bytes, pos);
  const n = decodeLeb128(bytes, pos);
  if (targetBlock === null || targetTx === null || fuel === null || n === null) return null;
  if (n > BigInt(MAX_INPUTS)) return null;
  const inputs: bigint[] = [];
  for (let k = 0n; k < n; k++) {
    const v = decodeLeb128(bytes, pos);
    if (v === null) return null;
    inputs.push(v);
  }
  if (targetBlock > U64_MAX || targetTx > U32_MAX) return null;
  return { targetBlock, targetTx, fuel: fuel > U64_MAX ? U64_MAX : fuel, inputs };
}

/** Calldata as the guest sees it: each input as a 16-byte little-endian u128 (section 5.3). */
export function calldataBytes(inputs: bigint[]): Uint8Array {
  const out = new Uint8Array(inputs.length * 16);
  inputs.forEach((v, idx) => {
    let x = v;
    for (let j = 0; j < 16; j++) {
      out[idx * 16 + j] = Number(x & 0xffn);
      x >>= 8n;
    }
  });
  return out;
}

/* ------------------------------------------------------------------ Script */

function pushData(script: number[], data: Uint8Array): void {
  if (data.length <= 75) script.push(data.length);
  else if (data.length <= 255) script.push(0x4c, data.length);
  else if (data.length <= 0xffff) script.push(0x4d, data.length & 0xff, data.length >> 8);
  else throw new RangeError('push too large');
  script.push(...data);
}

/** Builds a form-A call script: OP_RETURN <D1 01 ‖ cellpack>. */
export function buildCallScript(cp: Cellpack, opts: { enforceRelayLimit?: boolean } = {}): Uint8Array {
  const cell = encodeCellpack(cp);
  const payload = new Uint8Array(2 + cell.length);
  payload[0] = MAGIC;
  payload[1] = VERSION;
  payload.set(cell, 2);
  if ((opts.enforceRelayLimit ?? true) && payload.length > MAX_RELAY_PAYLOAD) {
    throw new RangeError(`payload ${payload.length} B exceeds the ${MAX_RELAY_PAYLOAD} B relay limit`);
  }
  const script: number[] = [0x6a];
  pushData(script, payload);
  return Uint8Array.from(script);
}

/** Splits script data into pushes. Stops at the first non-push opcode; null if a push runs past the end. */
function decodePushes(data: Uint8Array): Uint8Array[] | null {
  const out: Uint8Array[] = [];
  let i = 0;
  while (i < data.length) {
    const op = data[i++]!;
    let len: number;
    if (op <= 0x4b) len = op;
    else if (op === 0x4c) {
      if (i >= data.length) return null;
      len = data[i++]!;
    } else if (op === 0x4d) {
      if (i + 2 > data.length) return null;
      len = data[i]! | (data[i + 1]! << 8);
      i += 2;
    } else break;
    if (i + len > data.length) return null;
    out.push(data.subarray(i, i + len));
    i += len;
  }
  return out;
}

/** Decodes one output script (section 5.1). Returns null if it is not a Dalkanes call. */
export function parseCallScript(script: Uint8Array): Cellpack | null {
  if (script[0] !== 0x6a) return null;
  const p = decodePushes(script.subarray(1));
  if (!p) return null;
  // Form B: [D1] [01] [cellpack] (…more pushes allowed)
  if (p.length >= 3 && p[0]!.length === 1 && p[0]![0] === MAGIC && p[1]!.length === 1 && p[1]![0] === VERSION) {
    return decodeCellpack(p[2]!);
  }
  // Form A: [D1 01 ‖ cellpack]
  if (p.length === 1 && p[0]!.length >= 2 && p[0]![0] === MAGIC && p[0]![1] === VERSION) {
    return decodeCellpack(p[0]!.subarray(2));
  }
  // Form C: [D1] [01 ‖ cellpack]
  if (p.length === 2 && p[0]!.length === 1 && p[0]![0] === MAGIC && p[1]![0] === VERSION) {
    return decodeCellpack(p[1]!.subarray(1));
  }
  return null;
}

/** First output (in order) that decodes as a call. */
export function extractCall(outputScripts: Uint8Array[]): Cellpack | null {
  for (const s of outputScripts) {
    const cp = parseCallScript(s);
    if (cp) return cp;
  }
  return null;
}

/* ------------------------------------------------------------- Attached value */

/** Spec section 6.5: koinu on the first valid Dalkanes carrier output (burned DOGE). */
export function attachedValue(outputs: Array<{ value: bigint; script: Uint8Array }>): bigint {
  for (const out of outputs) {
    if (parseCallScript(out.script)) return out.value;
  }
  return 0n;
}

/* ------------------------------------------------------------------ Helpers */

export function formatAlkaneId(block: bigint, tx: bigint): string {
  return `${block}:${tx}`;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/\s+/g, '');
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) throw new Error('bad hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
