/**
 * Dalkanes reference encoder and decoder for `0xD1` messages (spec v0.4, sections 5 and 16).
 *
 * Dependency-free TypeScript that runs in browsers and Node 18+.
 * Ported from the Dig wallet, dogexplorer and dogex (`src/alkanes/wire.rs`, `parcel.rs`).
 * It follows the reference indexer's wire rules strictly: the version byte is required,
 * and a transaction carries at most one `0xD1` message. Two `0xD1` outputs, or one that
 * does not decode, make the transaction ambiguous (see `classifyMessage`).
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

/**
 * The transaction's version `0x01` call, if it has one (section 5.1). Null when there is no
 * `0xD1` output, when the only one is a parcel message, or when the transaction is ambiguous.
 * Before v0.4 this returned the first output that decoded; that rule is gone.
 */
export function extractCall(outputScripts: Uint8Array[]): Cellpack | null {
  const m = classifyMessage(outputScripts);
  return m.kind === 'call' ? m.cellpack : null;
}

/* ------------------------------------------------------------- Attached value */

/**
 * Spec section 6.5: koinu on the carrier output of the call the transaction runs (burned
 * DOGE). 0 when it runs no call.
 */
export function attachedValue(outputs: Array<{ value: bigint; script: Uint8Array }>): bigint {
  const m = classifyMessage(outputs.map((o) => o.script));
  if (m.kind === 'call' || (m.kind === 'parcel' && m.parcel.call)) return outputs[m.vout]!.value;
  return 0n;
}

/* --------------------------------------------------- One message per transaction */

/**
 * Section 5.1: an `OP_RETURN` output whose first data push is the single byte `D1` or begins
 * with `D1`. A first push that runs past the end of the script still counts.
 */
export function isD1Carrier(script: Uint8Array): boolean {
  if (script[0] !== 0x6a || script.length < 2) return false;
  const op = script[1]!;
  let at: number;
  if (op >= 1 && op <= 75) at = 2;
  else if (op === 0x4c) at = 3;
  else if (op === 0x4d) at = 4;
  else return false;
  return script[at] === MAGIC;
}

export type Message =
  | { kind: 'none' }
  | { kind: 'call'; vout: number; cellpack: Cellpack }
  | { kind: 'parcel'; vout: number; parcel: ParcelMessage }
  | { kind: 'ambiguous' };

/**
 * Sections 5.1 and 16. `none`: input parcels go to the first non-`OP_RETURN` output.
 * `call`: a version `0x01` call runs; parcels still follow the first non-`OP_RETURN` output.
 * `parcel`: the version `0x02` message routes the parcels. `ambiguous`: no call runs and every
 * input parcel burns.
 */
export function classifyMessage(outputScripts: Uint8Array[]): Message {
  let found = -1;
  for (let i = 0; i < outputScripts.length; i++) {
    if (!isD1Carrier(outputScripts[i]!)) continue;
    if (found >= 0) return { kind: 'ambiguous' };
    found = i;
  }
  if (found < 0) return { kind: 'none' };
  const script = outputScripts[found]!;
  const parcel = parseParcelScript(script);
  if (parcel) return { kind: 'parcel', vout: found, parcel };
  const cellpack = parseCallScript(script);
  if (cellpack) return { kind: 'call', vout: found, cellpack };
  return { kind: 'ambiguous' };
}

/* ------------------------------------------------------- Output parcels (0x02) */

export const PARCEL_VERSION = 0x02;
/** Edict output (and pointer) value that deposits into the call in the same message. */
export const OUTPUT_DEPOSIT = 0xfffffffe;
/** Pointer value meaning "no pointer": the remainder burns. */
export const POINTER_NONE = 0xffffffff;
export const MAX_EDICTS = 16;

export interface Edict {
  /** `block:tx` */
  id: string;
  /** 0 = the rest of that token */
  amount: bigint;
  output: number;
}

export interface ParcelMessage {
  /** null = no pointer (the remainder burns) */
  pointer: number | null;
  edicts: Edict[];
  call: Cellpack | null;
}

function parseId(id: string): { block: bigint; tx: bigint } {
  const m = /^(\d+):(\d+)$/.exec(id.trim());
  if (!m) throw new Error(`bad alkane id ${id}`);
  const block = BigInt(m[1]!);
  const tx = BigInt(m[2]!);
  if (block > U64_MAX || tx > U32_MAX) throw new RangeError(`alkane id out of range ${id}`);
  return { block, tx };
}

/** `body` starts at the version byte. Null if any field is missing or out of range. */
export function decodeParcelBody(body: Uint8Array): ParcelMessage | null {
  if (body[0] !== PARCEL_VERSION) return null;
  const pos = { i: 1 };
  const pointerRaw = decodeLeb128(body, pos);
  if (pointerRaw === null) return null;
  let pointer: number | null;
  if (pointerRaw === BigInt(POINTER_NONE)) pointer = null;
  else if (pointerRaw > U32_MAX) return null;
  else pointer = Number(pointerRaw);
  const n = decodeLeb128(body, pos);
  if (n === null || n > BigInt(MAX_EDICTS)) return null;
  const edicts: Edict[] = [];
  for (let k = 0n; k < n; k++) {
    const block = decodeLeb128(body, pos);
    const tx = decodeLeb128(body, pos);
    const amount = decodeLeb128(body, pos);
    const output = decodeLeb128(body, pos);
    if (block === null || tx === null || amount === null || output === null) return null;
    if (block > U64_MAX || tx > U32_MAX || output > U32_MAX) return null;
    edicts.push({ id: `${block}:${tx}`, amount, output: Number(output) });
  }
  const hasCall = decodeLeb128(body, pos);
  if (hasCall === null || hasCall > 1n) return null;
  let call: Cellpack | null = null;
  if (hasCall === 1n) {
    call = decodeCellpack(body.subarray(pos.i));
    if (!call) return null;
  }
  return { pointer, edicts, call };
}

export function encodeParcelBody(msg: ParcelMessage): Uint8Array {
  if (msg.edicts.length > MAX_EDICTS) throw new RangeError(`more than ${MAX_EDICTS} edicts`);
  const pointer = msg.pointer === null ? BigInt(POINTER_NONE) : BigInt(msg.pointer);
  if (pointer < 0n || pointer > U32_MAX) throw new RangeError('pointer out of range');
  const out: number[] = [PARCEL_VERSION, ...encodeLeb128(pointer), ...encodeLeb128(BigInt(msg.edicts.length))];
  for (const e of msg.edicts) {
    const { block, tx } = parseId(e.id);
    if (!Number.isInteger(e.output) || e.output < 0 || e.output > 0xffffffff) throw new RangeError('edict output out of range');
    out.push(...encodeLeb128(block), ...encodeLeb128(tx), ...encodeLeb128(e.amount), ...encodeLeb128(BigInt(e.output)));
  }
  out.push(msg.call ? 1 : 0);
  if (msg.call) out.push(...encodeCellpack(msg.call));
  return Uint8Array.from(out);
}

/** Canonical parcel script: `OP_RETURN <D1 02 ‖ body>` in one push. */
export function buildParcelScript(msg: ParcelMessage, opts: { enforceRelayLimit?: boolean } = {}): Uint8Array {
  const body = encodeParcelBody(msg);
  const payload = new Uint8Array(1 + body.length);
  payload[0] = MAGIC;
  payload.set(body, 1);
  if ((opts.enforceRelayLimit ?? true) && payload.length > MAX_RELAY_PAYLOAD) {
    throw new RangeError(`payload ${payload.length} B exceeds the ${MAX_RELAY_PAYLOAD} B relay limit`);
  }
  const script: number[] = [0x6a];
  pushData(script, payload);
  return Uint8Array.from(script);
}

/**
 * Section 16 push forms. Single push `D1 02 ‖ body`, or push `D1` then push `02 ‖ body`.
 * Later pushes are ignored in both forms.
 */
export function parseParcelScript(script: Uint8Array): ParcelMessage | null {
  if (script[0] !== 0x6a) return null;
  const p = decodePushes(script.subarray(1));
  if (!p) return null;
  let body: Uint8Array | null = null;
  if (p.length >= 2 && p[0]!.length === 1 && p[0]![0] === MAGIC && p[1]![0] === PARCEL_VERSION) body = p[1]!;
  else if (p.length >= 1 && p[0]!.length >= 2 && p[0]![0] === MAGIC && p[0]![1] === PARCEL_VERSION) body = p[0]!.subarray(1);
  return body ? decodeParcelBody(body) : null;
}

export type Routing = { kind: 'default' } | { kind: 'burn' } | { kind: 'message'; message: ParcelMessage };

export interface Route {
  /** [vout, id, amount] in the order the indexer credits them */
  toOutput: Array<[number, string, bigint]>;
  deposits: Array<[string, bigint]>;
  burned: Array<[string, bigint]>;
}

function addTo(list: Array<[string, bigint]>, id: string, amt: bigint): void {
  const slot = list.find((x) => x[0] === id);
  if (slot) slot[1] += amt;
  else list.push([id, amt]);
}

/**
 * Section 16 routing, mirroring dogex `parcel::route`. `canHold[v]` is true when output `v`
 * exists and is not an `OP_RETURN`. Deposits are what a call would receive; if the call
 * fails, has no code, or there is no call, the caller credits them to the pointer when it
 * can hold them and burns them otherwise.
 */
export function routeParcels(inputs: Array<[string, bigint]>, routing: Routing, canHold: boolean[]): Route {
  const left: Array<[string, bigint]> = [];
  for (const [id, amt] of inputs) if (amt > 0n) addTo(left, id, amt);
  const r: Route = { toOutput: [], deposits: [], burned: [] };
  const holds = (v: number) => canHold[v] === true;
  const place = (output: number, id: string, amt: bigint) => {
    if (amt === 0n) return;
    if (output === OUTPUT_DEPOSIT) addTo(r.deposits, id, amt);
    else if (holds(output)) r.toOutput.push([output, id, amt]);
    else addTo(r.burned, id, amt);
  };
  if (routing.kind === 'burn') {
    for (const [id, amt] of left) addTo(r.burned, id, amt);
    return r;
  }
  if (routing.kind === 'default') {
    const first = canHold.findIndex((h) => h);
    for (const [id, amt] of left) {
      if (first >= 0) r.toOutput.push([first, id, amt]);
      else addTo(r.burned, id, amt);
    }
    return r;
  }
  const msg = routing.message;
  for (const e of msg.edicts) {
    const slot = left.find((x) => x[0] === e.id);
    if (!slot || slot[1] === 0n) continue;
    const take = e.amount === 0n || e.amount > slot[1] ? slot[1] : e.amount;
    slot[1] -= take;
    place(e.output, e.id, take);
  }
  for (const [id, amt] of left) {
    if (msg.pointer === null) {
      if (amt > 0n) addTo(r.burned, id, amt);
    } else place(msg.pointer, id, amt);
  }
  return r;
}

/** `canHold` for a list of output scripts: true unless the script starts with `OP_RETURN`. */
export function holdableOutputs(outputScripts: Uint8Array[]): boolean[] {
  return outputScripts.map((s) => s[0] !== 0x6a);
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
