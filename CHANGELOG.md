# Changelog

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
