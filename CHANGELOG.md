# Changelog

## Unreleased

Clarifications only. No birth rule or stored-key change.

- Appendix A: a wallet must not broadcast a claim or a pull whose dry run, one block past the tip, would not count. A same-block slot refusal (status 7) does not hold the signature. An address that already claimed, or a full supply, does. A second broadcast waits until the first receipt is indexed.
- §6.2: a §20.1 refusal is decided before the block-budget test. When both would apply, the receipt is the gate refusal and `R` is unchanged. `ok`, `fuel_used`, and `born` already match either order.
- §6.3: an out-of-fuel trap records `fuel_used` as the grant, not 0. An indexer that stored 0 for those receipts diverges on a consensus field and has to replay those calls.

- README status line now says v0.4.3 (it still said v0.4.1).
- §20.1 writes the per-block lock test as `height < 6,475,700` / `height >= 6,475,700`, so the 6,475,700 boundary cannot be read as exclusive of that height.
- §11: a derived index (per-address history, a listing of print slots) rolls back with the block, the same as the keys it was built from.
- Appendix A: dry-run fuel follows §6.2 (omitted is `MAX_FUEL`; 0 grants 1); a dry run does not apply the residual live-block budget; a wallet should pass the fuel it will put in the cellpack; `incoming` on a pull is credited to the would-be print; a Dogecoin P2PKH `sender` is allowed beside `sender_hex`.

## 0.4.3 (2026-11-27)

- §20.1: from height 6,475,700 a print program may birth more than one print in a block. The cap of 420 and one pull per verified sender stay. Below that height the per-block refusal stands, and those blocks are not replayed. Proof, Shibkane and Doge Orbital share it. The inscribed programs do not change.

## 0.4.2 (2026-11-27)

Answers for doginals.store / thedoginalsexplorer after their notes in pull request 3. No birth rule changes. An indexer that already follows §24 does not reindex.

- §24 names three wasm hashes that are not print programs (`43a9ebb3`, `3cba3028`, `9e9bfc04`) and says the live Proof `6475242:19` is the current Proof row `7c9b14ca`. [vectors/canonical-builds.json](vectors/canonical-builds.json) is the §24 table.
- Appendix A: a dry run of a pull applies the §20.1 refusals, runs the birth, and returns `born`. A wallet must not sign a dry run the gate would refuse.

## 0.4.1 (2026-11-27)

This pass pins and documents what the reference already does. It changes no rule, no receipt and no stored key, so no indexer needs to reindex.

- §20.1 (normative): print births. Which contracts are print programs, when a pull is refused before execution, the print's id and caller, and the keys `0x10`, `0x11`, `0x13`, `0x14` and `0x15` written on success. §20, §21 and §23 are no longer marked informative.
- §24: the table of canonical code hashes. Print programs are recognised by these hashes; the other rows are labels only. §6.6 notes that births are the one place execution depends on a code hash.
- "One pull per verified sender" now says what it means: one per address, not one per person.
- §23: the Doge Orbital hash is of the build with CRLF line ends, whatever a checkout uses. Before this, an LF checkout of the reference built a different hash.
- vectors/mainnet-receipts.json: the Proof program's deploy, the four mainnet Proof prints, two refused pulls, and the other calls through block 6,475,565, each with a note on how it was checked.

The items below were listed as Unreleased and ship with 0.4.1.


- §23: Doge Orbital. One inscribed copy of the site mark. Opcode `77` births a print until 420, with Proof's refusal. Opcode `200` returns that face. Classic is untinted. Night, Sakura, Sea, Ember, and Ghost multiply the coat channels. `POST /api/alkanes/preview` accepts `kind: doge`. Nothing here is inscribed by this change.

- §21: a Shibkane collection stops at 420. One pull per block, one pull per verified sender. Opcode `106` returns 420. The indexer uses the same refusal as Proof. The document names `ears` (Point, Tall, Wide, Flop) from the low two bits of hash byte 8, which the picture already drew. Nothing here is inscribed by this change. `POST /api/alkanes/preview` accepts `kind: shibkane`.

- §20: how a client shows a print. The inscription is the program. A holding with `clone_of` set is one collectible, tagged as a Dalkane, and the picture is opcode `200` from `POST /api/alkanes/simulate`, decoded as SVG. The factory stays a token. Appendix A names `clone_of` on `GET /api/alkanes/markets`.

- §18: view opcodes for Howl, Ash, Quiet, Ember, Vigil, Collar, and Bone. Howl's `101` is the treasury left in the contract. `102` is the era, `103` the claim size, `104` the coins this sender has in a den, `105` the unlock height, and `106` is 1 when this sender has claimed.
- §20: the first print is index 0. A refused pull records `fuel_used` 0 and leaves the block fuel budget unchanged. Key `0x15` followed by the sender stores the single byte `0x01`.

- §6.5: a call that births a print (§20) runs with the program as its caller, not `0:0`; §20 says so where the print's parent key is described. The canonical Proof and Shibkane builds already read it.

- `vectors/mainnet-receipts.json`: the 13 mainnet calls with a receipt through block 6,475,327, on which dogex and an independent indexer agree (ok, fuel_used, return_hex).

- §20: a Proof collection stops at 420. One pull per block, one pull per verified sender. Opcode `106` returns 420. The indexer refuses a birth past the cap, in a block that already pulled, or from an address that already pulled. Nothing here is inscribed by this change.

- §18: Kibble, a canonical build beside the Pack. Opcode `77` mints 10,000, once per verified sender and once per block, cap 432,000,000. A missed block stays open. No deposit, no burn, no reserved id. `GET /api/alkanes/kibble/build` returns that bytecode and does not accept a replacement. Nothing here is inscribed by this change.

- §20 and §21: a Proof or Shibkane collection records each print. Opcode `103` is the count, `104` is the print at an index, `105` is the tag `dalkane-orbital/1`, and `202` is one metadata document. Opcode `200` stays the SVG. The parent cannot be written by the program while it runs as the new id, so the birth writes the count, the slot, and the child's index. No template id, and nothing is inscribed by this change.

- §22: a project card. The deployer of an already inscribed contract inscribes an `application/json` body that names the contract and an image inscription. The reveal key must match the contract's reveal key. A later card from that key replaces it. Opcode `1000` on Bitcoin returns witness bytes stored at initialize; Dogecoin has no witness, so the picture is its own inscription. No program is re-inscribed and the activation height does not move.

Edge-case pass. No consensus rule changed: every sentence below states what the reference already does, now with vectors.

- §5.1: `OP_0` counts as a push, so form A followed by `OP_0` is a broken `0xD1` output; `OP_1`–`OP_16`, `OP_1NEGATE` and `OP_PUSHDATA4` stop parsing. A transaction's `0xD1` outputs are classified by the first push before anything decodes. Coinbase transactions are processed like any other and have no sender.
- §6.5: the sender's script code is the P2PKH script as data. Removing `0xab` bytes from inside the pubkey hash loses the sender. `vectors/sender.json` is the mainnet Howl claim that hit this in the reference before dogex `73be46b`.
- §16 split into §16.1 format, §16.2 routing, §16.3 deposits, §16.4 sending part of a balance. New in the text: form C′ and trailing pushes after form A′; a pointer above `u32::MAX` or a has-call other than 0/1 does not decode; the pointer may be `u32::MAX − 1` and then deposits the remainder (a refund of it burns); edicts clamp, skip tokens the inputs lack, and run in order; there is no Runes split edict; per-token amounts saturate at 2^128 − 1; any non-`OP_RETURN` script can hold a parcel.
- §7.5: `parcel_send` also returns 0 for a zero amount or a nested call; fuel is charged before any `parcel_*` check.
- §9: `born` is consensus-relevant. The reference's informative receipt fields are listed and in the schema.
- §10: rows for a `0x02` message with no call, a missing target, a failed call, and a burned edict.
- §11: parcels and print ids are restored on a reorg.
- §13: status codes of the canonical builds.
- §2: a database that indexed below activation must drop that state.
- Appendix A: `/api/alkanes/events`, `/{id}/activity` and `/{id}/history`; `/calls` is ordered by height.
- `reference/decoder.ts` follows v0.4: `classifyMessage`, parcel encode/decode and routing. `extractCall` and `attachedValue` no longer take the first output that decodes.
- `vectors/parcel.json` and `vectors/sender.json`, mirrored by dogex tests `message_edge_cases`, `routing_edge_cases` and `howl_mainnet_claim_has_a_sender`.

- A pull of an inscribed Proof or Shibkane births a print. The new id is that transaction's `block:tx`, the inscribed program is what runs, and the parcel is of the new id. The program is not inscribed again. A create that carries new WASM still does not fit Dogecoin (§14, §20).

- `vectors/host-abi/rollback_parent_bad_buffer.wat`, `rollback_parent_failed_child.wat` and `rollback_parent_grandchild.wat` did not parse: part of each header comment had wrapped onto lines that were not comments. Those lines are comments again; the modules are unchanged.
- §7.5 lists `parcel_mint` and `parcel_withdraw`. Each costs 3,000 fuel, returns 1 or 0, and returns 0 from a nested call, the same as `parcel_send`.
- The README lists an independent indexer.

## Pack limits — 2026-11-26

No wire change. Howl burns 0.01 DOGE per coin claimed and accepts one claim per block. Ash's cap is 1,000 and a claim mints at most 10, one mint per block. Vigil accepts one claim per block, so a 20-block window mints at most 20. Quiet, Ember, Collar, and Bone are additional canonical builds in [spec.md §18](spec.md#18-the-pack-informative). `POST /api/alkanes/preview` runs those builds before they are inscribed. Nothing here was inscribed.

## Proof — 2026-11-26

No wire change. A new canonical build, [spec.md §20](spec.md#20-proof-informative). One deploy, one pull, one parcel. The SVG and the traits are the SHA-256 of the pull's block, transaction index, time, and sender. `GET /api/alkanes/proof/build` returns that bytecode and does not accept a replacement.

The picture was revised the same day, before anything was inscribed. Proof is a sacred-geometry print: a flower of life, a merkaba, Metatron’s cube, a vesica, a seal, or a lattice. The line under the plate, when there is one, is a Doge phrase rather than a printer’s abbreviation. The dog drawing from the first pass is a separate canonical build, [spec.md §21](spec.md#21-shibkanes-informative). `GET /api/alkanes/shibkane/build` returns that bytecode. The cap of each Proof and each Shibkane is still 1.

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
- Pool views (`99`–`104`) refuse a deposit, so a stray deposit returns to the pointer instead of sitting on the pool's sheet outside the reserves.
- The Howl build did not parse (one extra parenthesis in opcode `106`), so building or recognising it would have stopped the reference indexer. Fixed; Howl's code hash is the one this build produces.
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
