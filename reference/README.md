# Reference helper

`decoder.ts` handles the wire format only. It is not an indexer or a WASM runtime.

It mirrors dogex's v0.4 wire rules:

- calls: required version byte, checked u64:u32 ids, bounded u128 LEB128, fuel saturating to u64, at most 256 fully present inputs (§5);
- one message per transaction: `classifyMessage` returns `none`, `call`, `parcel` or `ambiguous` (§5.1). `extractCall` and `attachedValue` follow it; before v0.4 they took the first output that decoded, which is no longer the rule;
- version `0x02` parcels: `buildParcelScript`, `parseParcelScript`, `decodeParcelBody` (§16.1) and `routeParcels` (§16.2).

Run `node reference/check-vectors.ts` (Node 23.6+ strips types by default; on 22.6+ add `--experimental-strip-types`) or `npx tsx reference/check-vectors.ts`. It checks the encoding vectors, the positive and negative parser vectors, and `parcel.json`. `sender.json` needs secp256k1 and is checked by the reference indexer's Rust tests. WASM execution, deploys, ledger and reorgs need the reference indexer's Rust tests; see [../IMPLEMENTATION.md](../IMPLEMENTATION.md).
