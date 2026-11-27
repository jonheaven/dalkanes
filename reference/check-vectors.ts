/**
 * Checks reference/decoder.ts against vectors/wire.json.
 * Run with: npx tsx reference/check-vectors.ts   (or node --experimental-strip-types on Node 22.6+)
 */
import { readFileSync } from 'node:fs';
import {
  buildCallScript,
  buildParcelScript,
  bytesToHex,
  calldataBytes,
  classifyMessage,
  encodeCellpack,
  hexToBytes,
  parseCallScript,
  parseParcelScript,
  routeParcels,
} from './decoder.ts';

const wire = JSON.parse(readFileSync(new URL('../vectors/wire.json', import.meta.url), 'utf8'));
let failed = 0;
for (const v of wire.cellpacks) {
  const cp = {
    targetBlock: BigInt(v.cellpack.target_block),
    targetTx: BigInt(v.cellpack.target_tx),
    fuel: BigInt(v.cellpack.fuel),
    inputs: v.cellpack.inputs.map((x: string) => BigInt(x)),
  };
  const checks: Array<[string, string, string]> = [
    ['cellpack_hex', bytesToHex(encodeCellpack(cp)), v.cellpack_hex],
    ['script_hex', bytesToHex(buildCallScript(cp)), v.script_hex],
    ['calldata_hex', bytesToHex(calldataBytes(cp.inputs)), v.calldata_hex],
  ];
  const parsed = parseCallScript(hexToBytes(v.script_hex));
  checks.push(['decode', JSON.stringify(parsed, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)),
    JSON.stringify(cp, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))]);
  for (const [what, got, want] of checks) {
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${v.name} ${what}${ok ? '' : `: got ${got} want ${want}`}`);
  }
}
const parser = JSON.parse(readFileSync(new URL('../vectors/parser.json', import.meta.url), 'utf8'));
for (const v of parser.cases) {
  const cp = parseCallScript(hexToBytes(v.script_hex));
  const ok = (cp !== null) === v.valid && (!v.valid ||
    (`${cp!.targetBlock}:${cp!.targetTx}` === v.target && cp!.fuel.toString() === v.fuel));
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} parser ${v.name}`);
}

const json = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
const parcel = JSON.parse(readFileSync(new URL('../vectors/parcel.json', import.meta.url), 'utf8'));
for (const v of parcel.messages) {
  const m = classifyMessage(v.outputs.map(hexToBytes));
  const ok = m.kind === v.kind && (v.vout === undefined || ('vout' in m && m.vout === v.vout));
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} message ${v.name}${ok ? '' : `: got ${json(m)}`}`);
}
for (const v of parcel.routing) {
  const routing =
    v.routing.kind === 'message'
      ? {
          kind: 'message' as const,
          message: {
            pointer: v.routing.message.pointer,
            edicts: v.routing.message.edicts.map((e: { id: string; amount: string; output: number }) => ({ ...e, amount: BigInt(e.amount) })),
            call: null,
          },
        }
      : v.routing;
  const r = routeParcels(
    v.inputs.map(([id, a]: [string, string]) => [id, BigInt(a)] as [string, bigint]),
    routing,
    v.can_hold,
  );
  const got = json({ to_output: r.toOutput, deposits: r.deposits, burned: r.burned });
  const want = json({ to_output: v.to_output, deposits: v.deposits, burned: v.burned });
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} routing ${v.name}${ok ? '' : `: got ${got} want ${want}`}`);
}
for (const v of parcel.scripts) {
  const msg = {
    pointer: v.message.pointer,
    edicts: v.message.edicts.map((e: { id: string; amount: string; output: number }) => ({ ...e, amount: BigInt(e.amount) })),
    call: v.message.call
      ? {
          targetBlock: BigInt(v.message.call.targetBlock),
          targetTx: BigInt(v.message.call.targetTx),
          fuel: BigInt(v.message.call.fuel),
          inputs: v.message.call.inputs.map((x: string) => BigInt(x)),
        }
      : null,
  };
  const enc = bytesToHex(buildParcelScript(msg));
  const dec = json(parseParcelScript(hexToBytes(v.script_hex)));
  const ok = enc === v.script_hex && dec === json(msg);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} parcel script ${v.name}${ok ? '' : `: got ${enc}`}`);
}
process.exit(failed ? 1 : 0);
