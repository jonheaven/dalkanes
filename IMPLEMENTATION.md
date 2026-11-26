# Implementation status

Updated 2026-11-25 for v0.4. The reference is dogex; its implementation source is not yet public. This is still experimental, **not a production-readiness or live-chain-replay claim**.

Version `0x02` output parcels, `parcel_mint`, and the `dalkanes-utxo-token-v1` template are in the reference. Version `0x01` calls are unchanged. Opening the indexer creates the `alkane_outpoint` column; existing `0x01` receipts do not need a replay.

Fair-launch tokens are built by `POST /api/alkanes/launch/build` from name, symbol, cap, and mint size. The indexer stores `launch` on the deploy metadata only when the bytecode hashes to that build. doginals.lol inscribes the returned deploy body; it does not accept an uploaded WASM file.

## Corrected and covered by reference tests

- Same-block deploy visibility and sequential storage/ledger writes through a block overlay. Later deploys are invisible to earlier calls; a transaction can deploy and call its own contract. First valid deploy per transaction wins.
- Nested writes remain under the callee's id. Children see staged storage/ledger state; staticcall and failed child writes are discarded. The call tree shares one staged state with a per-frame undo journal (no copy of the parent's writes per nested call); a failed child, a staticcall or a failed return-data copy rolls back exactly, including writes made by grandchildren.
- A successful child's writes are kept only after its return data is copied to the caller; an out-of-bounds buffer makes `call` return −1 and discards them.
- `fuel_used` is reported at every exit after fuel is granted, including instantiation/start-function failure, missing exports and a failed calldata write.
- Per-block fuel budget: `BLOCK_FUEL_BUDGET` = 100,000,000, pinned (§6.2). Calls are granted `min(requested, MAX_FUEL, remaining)`; once it is spent, later calls in the block get an exhausted receipt with `fuel_used` 0. Vectors in [vectors/block-fuel.json](vectors/block-fuel.json).
- Reorg undo distinguishes an absent storage key from a stored empty value and restores each exactly. Older undo records fall back to the previous rule.
- Self-transfer succeeds without changing the balance (and still requires a sufficient balance).
- Token v1 transfers spend only the verified sender's P2PKH hash160 account. Input 0's SIGHASH_ALL signature commits to the carrier. Sender identity is unavailable to nested calls. Token v0's bytecode cannot be repaired in place and remains unsafe; it is recognised as retired, not offered for deploy.
- The dice code-hash exception is gone. Dice is retired (predictable randomness), and custody-AMM is retired (no DOGE custody). Template routes report retirement rather than serve deploy bytes.
- `alkane_value` is the koinu burned in the carrier OP_RETURN, not change guessed from unrelated outputs. Prediction/market examples are burn/play-money demonstrations; no contract can pay out DOGE.
- wasmi pinned exactly to 1.1.0; max fuel pinned at 5,000,000. Mainnet activation is the spec constant 6,466,500 and testnet stays disabled; neither honours environment overrides.
- Code, storage and ledger reads are lazy; no 8,192-storage-key or 50,000-ledger-key snapshot caps.
- Gzip inflation stops at 512 KiB + 1, rejecting oversized output. LEB128 is checked for u128 overflow; ids and input counts are range-checked.
- dogexplorer and WatchDoge require the version byte and mirror the strict decoder; WatchDoge walks output scripts rather than scanning arbitrary transaction bytes.

The reference's targeted Alkanes and activation tests pass on Linux. Positive and negative wire cases are mirrored in [vectors/parser.json](vectors/parser.json) and the explorers' tests; host WAT cases are in [vectors/host-abi/](vectors/host-abi/). The TypeScript helper passes the wire vector checker. None of this replaces independent replay or an audit.

## Remaining gaps / migration warnings

- **Reindex required (pre-mainnet databases only).** v0.2 deliberately changed experimental state semantics, and v0.3 changes receipts for setup failures and adds the block budget. Mainnet has no Dalkanes state before block 6,466,500, so a mainnet indexer built from v0.3 needs no reindex. Do not reuse an old Dalkanes database as if it were v0.3 state. No automatic migration or historical-state compatibility is claimed.
- **Activation.** Mainnet activates at block 6,466,500 (§2); an indexer needs the v0.3 reference build before that block. Testnet remains off. Environment overrides work on regtest only.
- **Existing templates.** Deployed v0 token bytecode remains unauthenticated. Existing dice gets no synthetic stake parcel. Retired templates are not made safe by explorer labels. New token initialization is first-caller-wins; deploy and initialize atomically in one transaction if an initial allocation matters.
- No module validation at deploy, float-free subset, independent runtime implementation, adversarial fuzzing, or chain replay has been completed.
- **Unmentioned parcels go to the first real output.** With no `0xD1` message, parcels move to the first non-`OP_RETURN` output, as Runes do, so an unaware wallet's consolidation keeps them. A plain payment from a parcel output hands the parcel to the payee. Wallets should still guard parcel outputs the way Doginal wallets guard inscription postage.
- **Pool legs.** `ledger_transfer` refuses to debit a 12-byte account other than the executing contract's own, so no token can pull its units out of a pool's sheet. A non-canonical token can still mint without limit, so sites should still label any pool whose legs are not a recognised canonical hash.
- **One mint per sender is as farmable as on Bitcoin.** A new key costs a fee. This is left as is for now.
- Wallet: dig (`@dig/web`) builds calls with a strict encoder that round-trips through a dogex-equivalent parser, burns any `alkane_value` on the carrier OP_RETURN (default 0, explicit confirmation), uses token v1's 20-byte account cells, and checks before broadcast that input 0 is the sender's P2PKH spend signed SIGHASH_ALL. Other wallets must do the same; nothing here is a deposit.
