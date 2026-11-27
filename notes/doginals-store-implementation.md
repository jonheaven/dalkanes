# doginals.store / thedoginalsexplorer: implementation notes

Status of the Ðalkanes support on [doginals.store](https://doginals.store/inscribe?protocol=dalkanes) and [thedoginalsexplorer.com](https://thedoginalsexplorer.com/dalkanes), as of spec `9dcd781` (2026-11-27). This file is informative only. It changes nothing in the spec.

## Synced to `1f80b65` and `9dcd781`

- **One print gate for Proof, Shibkane and Doge Orbital (§20, §21, §23).** The gate is 420 per collection, one pull per block, and one pull per verified sender. It is checked before execution. A refused pull gets `ok: false` and `fuel_used: 0`, with no new id, and it uses neither the block nor the address. On success the indexer writes `0x14` (height) and `0x15 ‖ sender = 0x01`. The first print is index 0. We replayed from activation under the new rules.
  - Indexer: [thedoginalsexplorer/indexers `e743d84`](https://github.com/thedoginalsexplorer/indexers/commit/e743d84) (Shibkane shares the gate) and [`fd9a2e7`](https://github.com/thedoginalsexplorer/indexers/commit/fd9a2e7) (Doge Orbital). The live explorer runs the same module (explorer `e369d1f`, `0912a51`; that repo is private).
- **The dry run applies the birth and the gate.** `GET /v1/dalkanes/simulate?target=&inputs=77,1&sender=` runs a pull the way a block does. The gate comes first. Then the program runs as the new id, with the program as its caller. The response includes `born`, the id the print would take: the next block, with tx index 1 as a placeholder, since the real id is only known once the pull is mined.
- **Prints show as collectibles ("Showing a print").** An id with `clone_of` set whose kind is a print kind is one collectible, painted from opcode `200` on its own id. It is left out of the fungible list, and the factory stays with the tokens. We refuse an SVG that contains `script`, `javascript:` or `foreignObject`, and serve the rest as an image with a no-script CSP. The coin that holds a print is kept out of every other spend.
- **The live Proof collection `6475242:19` matches the spec.** Count 4. Prints `6475472:30` (#0), `6475541:30` (#1), `6475544:34` (#2) and `6475565:27` (#3) carry indexes 0–3 in `0x13` and the slots. A second pull from any of those four addresses is refused with `this address already pulled`.

## A gap we found in our own code (fixed)

Our dry run used to execute opcode 77 as a plain call on the program, without the birth or the pre-run gate. So it answered `ok` for an address that had already pulled, and a wallet would have signed a claim that the block refuses (and paid its fees). The fix is in the commits above.

**Suggestion:** Appendix A could say that `POST /api/alkanes/simulate` applies the same pre-run refusals as a block (the §20 gate) and runs a pull as a birth. It could also say that the response carries the would-be `born`. This doesn't affect consensus, but every wallet depends on it.

## Answers (spec 0.4.2)

The notes above were written against `9dcd781`. `444af0d` (0.4.1) already published §24. This section is the reply. Keep the dry run you described. It matches Appendix A as of 0.4.2.

1. **Shibkane fingerprint.** SHA-256 of the wasm is `b69f0aa9b8cd66335d1c08fa6c86d3af7d6b0def30c8d8688eff6ebefe9c71a4`, 7,412 bytes (§24, and [vectors/canonical-builds.json](../vectors/canonical-builds.json)). That is the capped build: opcode `106` returns 420, and the document names ears. dogex `3c416b4` is that wasm. The later pin (`571f296`) only stores the hash; it does not change the module.
2. **Doge Orbital fingerprint.** SHA-256 of the wasm is `aeafccfee33779532d930b86bfbd2fbb0e5519db072dc26e29888e3c4040a4c4`, 61,486 bytes. Nothing with this hash is inscribed. The hash is of the build that embeds `doge.svg` with CRLF line ends.
3. **Older bodies.** dogex labels and gates only the §24 row. `7c9b14ca…` is the current Proof, live at `6475242:19`, and the gate applies. `43a9ebb3…`, `3cba3028…` and `9e9bfc04…` are not in the table. They get no `proof` or `shibkane` label and no §20.1 gate. Gating them diverges from dogex: a pull the reference would run, you would refuse.
4. **Where the hashes live.** This repo is the public copy. dogex and doginals.lol stay private. Read §24 or `vectors/canonical-builds.json`. Do not wait on `GET /api/alkanes/*/build`.
5. **dogex.command.dog** was still HTTP 502 at 23:40 UTC on 2026-11-27, including the build routes. The hashes above do not depend on it. dogex `POST /api/alkanes/simulate` as of `571f296` still runs opcode 77 on the target in place, with the caller `0:0`, and the response has no `born`. Your dry run is the one Appendix A now describes. Do not copy that dogex route until it returns `born`.
