# Changelog

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
