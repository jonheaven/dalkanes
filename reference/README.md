# Reference helper

`decoder.ts` handles the wire format only. It is not an indexer, not a WASM runtime, and not a full conformance implementation.

It implements the `OP_RETURN` push layouts, cellpack encoding and decoding, and calldata layout. Unlike the audited Rust decoder, it rejects values outside the u128, u64 or u32 ranges instead of truncating them. Its results therefore differ from the current Rust implementation for out-of-range input.

`check-vectors.ts` checks the helper against `../vectors/wire.json`. Those checks cover only the three sourced positive cellpack vectors. They do not cover deploy, execution, ledger, fees, reorgs or adversarial negative cases.
