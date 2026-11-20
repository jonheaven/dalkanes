/**
 * Checks reference/decoder.ts against vectors/wire.json.
 * Run with: npx tsx reference/check-vectors.ts   (or node --experimental-strip-types on Node 22.6+)
 */
import { readFileSync } from 'node:fs';
import { buildCallScript, bytesToHex, calldataBytes, encodeCellpack, hexToBytes, parseCallScript } from './decoder.ts';

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
process.exit(failed ? 1 : 0);
