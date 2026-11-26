# Changelog

## 0.4.0 — 2026-11-25

Output parcels. A wallet balance sits on a Dogecoin output. The host ledger is the sheet a contract holds after a deposit. This does not change version `0x01` calls. No parcel exists on chain until something mints one, so indexers pick this up by opening the new `alkane_outpoint` column — they do not replay `0x01` history.

- Version `0x02` parcel: pointer, edicts, optional cellpack call (§16).
- Spending an output that holds a parcel with no `0xD1` message (or with a version `0x01` call) moves it to the first non-`OP_RETURN` output, as Runes do. A malformed or doubled `0xD1` message burns it.
- `env.parcel_mint` creates units of the called alkane on an output. Template `dalkanes-utxo-token-v1`, opcode `77`.
- Fair-launch bytecode is built from name, symbol, cap, and mint size. The indexer labels a contract only when that rebuild matches the code hash (§17).
- Deposit output `u32::MAX - 1` fills `incoming_*` and, on a successful call, the contract's ledger sheet.
- `env.parcel_withdraw` moves the called alkane from the contract's own ledger account onto an output.
- Canonical Pack builds: Howl (scheduled claim and den), Ash (mint from burned DOGE), Vigil (a daily block window). An indexer labels them only when the bytecode hash matches.
- `env.parcel_send` pays any token the contract holds onto an output. The canonical pool (§19) uses it: edicts are the amounts, the cellpack is the opcode, LP is a parcel, and 30 bps stays in the reserves.

Hardening pass before 0.4.0 ships (same day, nothing was on chain yet):

- **Pool.** The pair is now part of the bytecode (no `init` to front-run) and the indexer records `pair`. Remove accepts only the pool's own LP; before this, a deposit of any self-minted token could drain the reserves. Products are 128-bit, sums are checked, and add/remove take `min_lp` / `min0` / `min1`. Opcode `1` is gone.
- **Landing check (§16).** A call that sends a parcel to a missing or `OP_RETURN` output fails as a whole and refunds its deposit, instead of succeeding while the units vanish. This also protects one-per-sender mints from being spent on a bad vout.
- **No-call deposits** go to the pointer, as §16 already said; the reference had burned them.
- **Unmentioned parcels follow the first real output.** A spend with no `0xD1` message, or with only a version `0x01` call, moves input parcels to the first non-`OP_RETURN` output instead of burning them. A version `0x01` call no longer destroys the parcels its inputs carry.
- **Ambiguous is a burn.** Two or more `0xD1` outputs, or one that does not decode, run no call and burn the input parcels. Before this, a `0x01` and a `0x02` call in one transaction both ran and the second receipt overwrote the first.
- **`ledger_transfer` cannot debit another contract's sheet.** A 12-byte `from` must be the executing contract's own id, so a token cannot pull its units back out of a pool. No existing template debits another contract's 12-byte account.
- Every `OP_RETURN` output burns an edict sent to it, not only the first one.
- Simulate credits deposits to the contract's sheet like the indexer, rejects malformed cells, and returns `outgoing`. Simulate and inspect are concurrency-limited; inspect views are capped at 1,000,000 fuel.

## 0.3.0 — 2026-11-20

Closes the open execution and reorg gaps from 0.2. Consensus-relevant: the block budget and `fuel_used` changes alter receipts, so every indexer must run a 0.3 build from mainnet activation (block 6,466,500).

- Per-block fuel budget `BLOCK_FUEL_BUDGET` = 100,000,000, pinned (§6.2, §12), with vectors in `vectors/block-fuel.json`. Exhausted calls get `ok: false`, `fuel_used: 0`.
- `fuel_used` is reported for every exit after fuel is granted, including start-function and instantiation failures (§6.3).
- A nested `call` keeps a child's writes only after the return-data copy succeeds; a bad buffer returns −1 and discards them (§7, §7.6). Failed children roll back exactly, including grandchildren.
- Reorgs restore a stored empty value as present and delete keys that were absent (§11).
- New host-ABI cases for nested rollback and setup-failure fuel; `burner.wat` for the budget vectors.

## 0.2.1 — 2026-11-20

- Mainnet activation height set to block 6,466,500 (§2), just above the 2026-11-20 tip of 6,466,091. Testnet remains unset; regtest unchanged.

## 0.2.0 — 2026-11-20

Experimental-state corrections, deliberately incompatible with the earlier source-audit profile; reindex before using this profile. Mainnet/testnet activation remains unset and off.

- Sequential in-block state; first-valid deploy per tx; nested writes keep the callee namespace; self-transfers no longer inflate balances.
- Sender proof from input 0 P2PKH SIGHASH_ALL; `alkane_sender` import; token v1 binds transfers to that sender and uses 20-byte address-payload accounts.
- Retired predictable dice and fictional DOGE-custody AMM; removed dice code-hash exception. `alkane_value` is the value burned in the carrier OP_RETURN.
- wasmi 1.1.0 and max fuel pinned; public-network activation cannot be overridden by environment.
- Lazy reads replace capped snapshots; gzip inflation bounded; checked integer decoding; strict explorer parsers.
- Added implementation-test-derived negative parser vectors and WAT cases for lazy reads, nested namespaces, self-transfer and sender visibility.

## 0.1.0 — 2026-11-20

The first public repository of the experimental draft. It records the implementation as read from source on this date. It does not claim mainnet readiness, live verification or production interoperability.

- A fresh public repository. The private draft history was deliberately not exported.
- The original draft text and three cellpack vectors were carried over, with the vector bytes recomputed and checked against the TypeScript helper only.
- A source-audit implementation status was added, with blocking defects listed.
- The ALKANES comparison and the Dogecoin carrier constraints were added.
- A TypeScript wire helper, its vector checker and JSON schemas were added.
- Activation is described as operator-configured. Mainnet and testnet default to disabled.
