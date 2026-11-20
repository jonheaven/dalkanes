# Implementation status

Updated 2026-11-20 for v0.2. The reference is dogex; its implementation source is not yet public. This is still experimental, **not a production-readiness or live-chain-replay claim**.

## Corrected and covered by reference tests

- Same-block deploy visibility and sequential storage/ledger writes through a block overlay. Later deploys are invisible to earlier calls; a transaction can deploy and call its own contract. First valid deploy per transaction wins.
- Nested writes remain under the callee's id. Children see staged storage/ledger state; staticcall and failed child writes are discarded.
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

- **Reindex required.** v0.2 deliberately changes experimental state semantics. Do not reuse an old Dalkanes database as if it were v0.2 state. No automatic migration or historical-state compatibility is claimed.
- **Activation.** Mainnet activates at block 6,466,500 (§2); an indexer needs the v0.2.1 reference build before that block. Testnet remains off. Environment overrides work on regtest only.
- **Existing templates.** Deployed v0 token bytecode remains unauthenticated. Existing dice gets no synthetic stake parcel. Retired templates are not made safe by explorer labels. New token initialization is first-caller-wins; deploy and initialize atomically in one transaction if an initial allocation matters.
- **Reorg undo.** Undo conflates absent storage with a present empty value; reads return 0 bytes for both, but exact presence restoration is not implemented.
- **Fuel receipts on early setup failure.** Start-function fuel can be under-reported when instantiation, export or memory setup fails. No per-block fuel budget yet.
- **Nested return buffer.** A successful child's writes are staged before validating the caller's output buffer. An invalid buffer makes `call` return −1 without removing those staged writes; a failed top-level execution still discards them.
- No module validation at deploy, float-free subset, independent runtime implementation, adversarial fuzzing, or chain replay has been completed.
- The wallet must use token v1's 20-byte account layout and sender-bound calls, and must not describe ordinary self-payments as attached DOGE deposits. Wallet UI integration is outside this spec revision.
