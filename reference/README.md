# Reference helper

`decoder.ts` handles the wire format only. It is not an indexer or a WASM runtime.

It mirrors dogex's v0.2 wire rules: required version byte, first valid output, checked u64:u32 ids, bounded u128 LEB128, fuel saturating to u64, at most 256 fully present inputs. `attachedValue` returns the value of the first valid carrier output (DOGE burned with the call).

Run `node --experimental-strip-types reference/check-vectors.ts` (Node 22.6+) or `npx tsx reference/check-vectors.ts`. It checks the positive encoding vectors and the positive/negative parser vectors. WASM execution, deploys, ledger and reorgs need the reference indexer's Rust tests; see [../IMPLEMENTATION.md](../IMPLEMENTATION.md).
