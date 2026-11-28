# Spec findings from doginals.store / thedoginalsexplorer (0.4.3)

Reviewed against `09eec75` (v0.4.3) after a pass over our explorer, indexer, and market. Alkanes-rs was used only as the semantic reference for contract behavior. Where this spec or Dogecoin consensus differs from Alkanes-rs (no Taproot or witness, the inscribed Doginal as the program template, P2PKH verified senders, the default 80-byte `OP_RETURN` relay limit, `block:tx` ids, and Dogecoin block times), the spec and Dogecoin win. This note is not a consensus change. Suggested wording that looks clear is already in the spec edits in this pull request.

## Already in sync (no decision needed)

- The 6,475,700 print-lock boundary in §20.1, as `height < 6,475,700`. We shipped that inequality before 0.4.3 named it, and we have not replayed earlier blocks. At the time of this note the tip was still below 6,475,700 (last seen 6,475,687). Live Proof `6475242:19` is unchanged: prints #0–#3 at `6475472:30`, `6475541:30`, `6475544:34`, `6475565:27`.
- Cellpack and LEB128 (§5.2), parcel edicts and the pointer (§16), saturating u128 amounts, refunds of deposits on a failed or refused call (§16.3), fuel grant and `BLOCK_FUEL_BUDGET` (§6.2), context / caller / myself including a print birth (§6.5, §20.1), storage key sizes, factory-style births via opcode 77 on an inscribed program (not Bitcoin `[1,0]` / `[3,n]` / `[6,n]` headers), and atomic reorg undo of Dalkanes tables including print keys.
- Dogecoin-specific rules we checked and are not proposing to change: P2PKH input-0 `SIGHASH_ALL` senders, no envelope/witness deploy, `alkane_value` as koinu on the carrier `OP_RETURN`, default 80-byte payload / 78-byte cellpack, `block:tx` ids, and §11's note that Dogecoin targets a block about every 60 seconds.

## Needs your judgment

1. **Order of a zero block budget and a §20.1 refusal.** §6.2 says that when the remaining budget `R` is 0, the call is not executed and the receipt is `ok: false`, `fuel_used: 0`, error `block fuel budget exhausted`. §20.1 says a refused pull also gets `ok: false`, `fuel_used: 0`, no `born`, and does not use the budget. If both apply, the consensus fields already agree (`ok`, `fuel_used`, `return_hex`, `born`; §9 says `error` may differ). We check the budget first, so a pull that the gate would also have refused is reported as budget-exhausted. If you would rather the gate's wording win when both apply, a sentence in §6.2 or §20.1 would lock that down. Suggested, if you want the budget first: "If `R` is 0, the budget receipt is issued even for a pull that §20.1 would also have refused."

2. **Dry-run residual block budget.** This pull request's Appendix A text says a dry run does not apply the residual budget of a block still being indexed: it is a single call with a full grant, as if first in a new block. That matches what a wallet can know at sign time. If dogex instead applies the live residual `R`, we should follow that, knowing a later transaction in the same block can still fail the budget after a successful dry run.

3. **`fuel_used` when a call runs out of fuel.** §6.3 says `fuel_used` is granted fuel minus remaining fuel once fuel has been granted, including an out-of-fuel trap. A dry run of Proof `6475242:19` opcode `103` uses 4,112 fuel when the grant is large enough, but with a grant of 2,000 (or 1, or 10) we return `ok: false`, `error: "out of fuel"`, and `fuel_used: 0`. If dogex reports 2,000 (the grant, fully consumed) for the same case, our receipts would diverge, and a fix would need a replay because `fuel_used` is consensus-relevant (§9). We have not changed this. Could you confirm what dogex records?

4. **A recommended confirmation depth.** §11 already says applications SHOULD choose a policy appropriate to reorg risk, and does not establish a settlement guarantee. We keep a 200-block undo window, which is a few hours at Dogecoin's ~60-second target, not a Bitcoin-like depth. If you have a depth you want wallets to use, an informative sentence in §11 would help. We are not proposing a normative number.

## Our implementation (brief, not for this spec)

These are in our repos, not this one.

- Explorer status now reports `specVersion` `0.4.3`. `GET /v1/dalkanes/simulate` accepts an optional `fuel` (omitted is `MAX_FUEL`; a provided value, including 0, follows §6.2) and a P2PKH `sender`. The market's claim dry run passes the same 1,000,000 fuel it puts in the cellpack. Simulate is rate-limited as a heavy route.
- We do not yet accept `incoming` on that simulate route. Print claims do not need it. We will add it if a version `0x02` dry run starts to matter.
- Our pre-run error when a pull shares a transaction with a deploy is `print birth refused: this transaction already has an id`. The reference wording in §20.1 is `this transaction already deploys a contract`. `error` is not consensus; we can align the string if you prefer they match.
