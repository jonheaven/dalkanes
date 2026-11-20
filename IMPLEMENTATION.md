# Implementation status

This is a source-reading audit of the reference implementation as of 2026-11-20. Nothing was compiled, tested, run or replayed for it. **Not production-ready.**

## Implemented in source

- Detecting Doginals WASM deploys (raw, `\0ALK\x01`-framed or gzip), storing code under a `block:tx` id, and recording metadata.
- Three `0xD1` call push layouts, with LEB128 cellpacks.
- Execution in `wasmi` with fuel metering, and the `env` host imports listed in the spec.
- Contract storage, a host ledger, nested `staticcall` and `call`, receipts, and block undo records.
- Activation disabled by default on mainnet and testnet; regtest defaults to height 0.

## Blocking defects

- **Same-block visibility.** Calls read the pre-block database while every write goes into one `WriteBatch` per block. A deploy and a call in the same block, or several calls in one block, therefore do not see each other's staged state, and conflicting writes resolve last-write-wins.
- **Nested-call storage.** A child's storage writes from a mutating nested `call` are merged into the parent as unprefixed keys, then committed under the top-level target's namespace.
- **Self-transfer.** In `ledger_transfer`, when `from == to` the credit overwrites the debit, so the balance increases.
- **Template safety.** The token template's transfer takes the `from` account from calldata with no authorisation check. The dice result is predictable from the block height and transaction index.
- **Attached value.** The "attached value" is a change heuristic, not custody of any funds.
- **Dice special case.** The updater injects a synthetic incoming parcel, keyed on the dice template's code hash.
- **Bounded snapshots.** A call loads every contract and its storage into a catalog. The ledger snapshot stops after 50,000 keys.
- **Reorg undo.** Undo stores an empty value for an absent key and deletes on restore, so a genuinely stored empty value is not distinguished from an absent one.
- **Varint range.** The LEB128 range check is incomplete, and ids, fuel and the input count are narrowed with truncating casts.
- **Unpinned settings.** The interpreter version, fuel schedule, fuel cap, activation height and replay profile are not pinned in a cross-implementation profile.

No mainnet activation height, deployment count or live usage was verified for this repository.
