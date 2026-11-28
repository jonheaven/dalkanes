# Spec findings from doginals.store / thedoginalsexplorer (0.4.3)

Reviewed against `09eec75` (v0.4.3) after a pass over our explorer, indexer, and market. Alkanes-rs was used only as the semantic reference for contract behavior. Where this spec or Dogecoin consensus differs from Alkanes-rs (no Taproot or witness, the inscribed Doginal as the program template, P2PKH verified senders, the default 80-byte `OP_RETURN` relay limit, `block:tx` ids, and Dogecoin block times), the spec and Dogecoin win. This note is not a consensus change. Suggested wording that looks clear is already in the spec edits in this pull request.

## Already in sync (no decision needed)

- The 6,475,700 print-lock boundary in §20.1, as `height < 6,475,700`. We shipped that inequality before 0.4.3 named it, and we have not replayed earlier blocks. At the time of this note the tip was still below 6,475,700 (last seen 6,475,687). Live Proof `6475242:19` is unchanged: prints #0–#3 at `6475472:30`, `6475541:30`, `6475544:34`, `6475565:27`.
- Cellpack and LEB128 (§5.2), parcel edicts and the pointer (§16), saturating u128 amounts, refunds of deposits on a failed or refused call (§16.3), fuel grant and `BLOCK_FUEL_BUDGET` (§6.2), context / caller / myself including a print birth (§6.5, §20.1), storage key sizes, factory-style births via opcode 77 on an inscribed program (not Bitcoin `[1,0]` / `[3,n]` / `[6,n]` headers), and atomic reorg undo of Dalkanes tables including print keys.
- Dogecoin-specific rules we checked and are not proposing to change: P2PKH input-0 `SIGHASH_ALL` senders, no envelope/witness deploy, `alkane_value` as koinu on the carrier `OP_RETURN`, default 80-byte payload / 78-byte cellpack, `block:tx` ids, and §11's note that Dogecoin targets a block about every 60 seconds.

## Answers

1. **Budget versus a §20.1 refusal.** The reference checks the gate first. If the pull is refused, the receipt is that refusal even when `R` is 0, and the budget is not touched. If the gate allows the pull and `R` is 0, the receipt is `block fuel budget exhausted`. `ok`, `fuel_used`, and `born` match either order, so a budget-first error string does not need a replay. §6.2 now says this.
2. **Dry-run residual budget.** Appendix A matches the reference. `POST /api/alkanes/simulate` grants `max(1, min(fuel, MAX_FUEL))` and does not read the live block's remaining `R`. Omitted `fuel` is `MAX_FUEL`. A requested 0 grants 1.
3. **`fuel_used` on an out-of-fuel trap.** The reference records the grant. A Proof opcode `103` granted 2,000 that traps on fuel has `fuel_used` 2,000, not 0. The same rule is why a call that burns its whole 5,000,000 grant records `fuel_used` 5,000,000. §6.3 already said a trap reports fuel consumed; it now says the out-of-fuel case in those words. Receipts you stored as `fuel_used: 0` for a trap diverge, and those calls need a replay. The mainnet receipt file through block 6,475,565 has no out-of-fuel trap.
4. **Confirmation depth.** No number. §11 stays as it is. A 200-block undo window is your own retention, not a settlement depth this spec will name.

The reference error when a pull shares a transaction with a deploy stays `this transaction already deploys a contract`. A different error string is fine: `error` is not consensus.

## Our implementation (brief, not for this spec)

These are in our repos, not this one.

- Explorer status now reports `specVersion` `0.4.3`. `GET /v1/dalkanes/simulate` accepts an optional `fuel` (omitted is `MAX_FUEL`; a provided value, including 0, follows §6.2) and a P2PKH `sender`. The market's claim dry run passes the same 1,000,000 fuel it puts in the cellpack. Simulate is rate-limited as a heavy route.
- We do not yet accept `incoming` on that simulate route. Print claims do not need it. We will add it if a version `0x02` dry run starts to matter.
- Our pre-run error when a pull shares a transaction with a deploy is `print birth refused: this transaction already has an id`. The reference wording in §20.1 is `this transaction already deploys a contract`. `error` is not consensus; we can align the string if you prefer they match.
