# Dalkanes

**WebAssembly smart contracts for Dogecoin, run by indexers.**

Dalkanes (written Ðalkanes in some UIs) is a Dogecoin metaprotocol. Contracts are WebAssembly modules deployed as Doginals inscriptions. Calls are small `OP_RETURN` messages tagged with the byte `0xD1`. The design is to replay calls in a metered WASM interpreter without changing Dogecoin consensus. The reference implementation has tests for sequential state, nested storage isolation and sender-authorised token transfers, but it is still experimental. See [IMPLEMENTATION.md](IMPLEMENTATION.md) before using it.

| | |
| --- | --- |
| Status | **Experimental draft v0.4.1.** Reference unit tests; not production-ready. Mainnet activation: block 6,466,500. |
| Normative spec | [spec.md](spec.md) |
| Carrier byte | `OP_RETURN` push `0xD1`, version `0x01` |
| Deploy | Doginals inscription carrying WASM (raw, gzip, or `\0ALK\x01` framed) |
| Contract id | `block:tx` of the deploy transaction |
| Execution | Deterministic interpreter with fuel metering (reference: `wasmi` 1.1.0 (pinned)) |
| License | [MIT](LICENSE) |

## Prior art and credit

Dalkanes is a Dogecoin port of the ideas behind **[ALKANES](https://github.com/kungfuflex/alkanes-rs)** by kungfuflex and the SUBFROST contributors, together with **[protorunes](https://github.com/kungfuflex/protorune/wiki)** and the **[METASHREW](https://github.com/kungfuflex/metashrew)** indexer. Those projects showed that WASM contracts metered with `wasmi` fuel and replayed by indexers are a workable smart-contract layer for a UTXO chain. Opcode conventions such as `0` initialize, `77` mint, `99`/`100`/`101` name, symbol and supply, and `1000` data come from the ALKANES standard contracts.

Dalkanes is **inspired by** ALKANES. It is **not wire- or ABI-compatible**, and ALKANES contracts do not run on Dalkanes unmodified. [spec.md §14](spec.md#14-relationship-to-bitcoin-alkanes-informative) explains what changed and why. Bitcoin ALKANES rides inside a Runestone. Ðunes (`0xD0`) has no slot for that: an unknown even tag burns the token inputs. Calls use their own byte, `0xD1`, so a contract message is not a dunestone. There is no Taproot witness on Dogecoin, and `OP_RETURN` relay is about 80 bytes. Contract balances live on a host ledger. They are not Ðunes. Moving `0xD0` coins into a call is future work.

## How it works

1. **Deploy.** Inscribe a WASM module as a Doginals inscription, with content type `application/wasm`. The contract id is the reveal transaction's height and index (the exact multipart attribution still needs verification).
2. **Call.** Broadcast any transaction with one output `OP_RETURN <0xD1 0x01 cellpack>`. The cellpack is a list of LEB128 integers: target block, target tx, fuel, input count, then the inputs. By convention the first input is an opcode.
3. **Hold.** A minted alkane sits on a transaction output (version `0x02`, §16 of the spec). Spending that output with no parcel message moves it to the first output that is not an `OP_RETURN`; a malformed or doubled `0xD1` message burns it. Coins a call takes in sit on the contract's ledger until the call sends them back to an output.
4. **Execute.** Each indexer loads the contract, writes the inputs into guest memory, calls `__dalk_execute`, and commits storage only if the call returns `0`. A failed call leaves no state change but still gets a receipt.
5. **Read.** Indexers expose contract metadata, storage, receipts, output balances and dry-run simulation over HTTP. That API is informative, not part of consensus.

## Repository layout

| Path | Contents |
| --- | --- |
| [spec.md](spec.md) | Normative specification (RFC 2119 keywords) |
| [vectors/](vectors/) | Test vectors taken from the reference indexer's unit tests |
| [reference/decoder.ts](reference/decoder.ts) | Dependency-free TypeScript wire helper; scope and compatibility caveats in `reference/README.md` |
| [schemas/](schemas/) | JSON Schemas for deploy metadata, call receipts and the vector files |
| [CHANGELOG.md](CHANGELOG.md) | Spec revisions |

## Implementations

| Role | Project | Notes |
| --- | --- | --- |
| Reference indexer | dogex (Rust, `wasmi` 1.1.0 (pinned)) | Not yet public. Implements deploy, calls, host ABI, host ledger and reorg undo. |
| Wallet | Dig | Builds and broadcasts `0xD1` calls; deploys WASM through Doginals inscriptions |
| Independent indexer | [thedoginalsexplorer/indexers](https://github.com/thedoginalsexplorer/indexers) (Rust, `wasmi` 1.1.0 (pinned)) | Public, MIT. Deploys, calls, host ABI, host ledger, version `0x02` parcels, verified sender and reorg undo. Replays mainnet from block 6,466,500 and passes every vector here. Live at [thedoginalsexplorer.com/dalkanes](https://thedoginalsexplorer.com/dalkanes). |
| Explorers | dogexplorer, WatchDoge, doginals.lol | Decode `0xD1` calls and show contract pages |

Independent replay, complete reorg tests and a security audit are still needed before an interoperability claim. Negative parser vectors and a pinned interpreter/fuel profile are included in v0.2. The audited implementation repositories are currently private; publishing this specification does not make their source public.

## Origin

This spec originated in the private Doginals stack documentation, under `spec/protocols/alkanes`. This is a fresh public repository: legacy history is not exported because it mixes obsolete wording and private-stack context. The public text separates observed implementation behaviour from desired fixes rather than claiming the old draft was fully implemented. See [CHANGELOG.md](CHANGELOG.md).

## Protocol code

`0xD1` belongs to Dalkanes in the Doginals protocol-code registry, where `0xD0` is Ðunes v2 and `0xD2` is DMP compact carriers. This identifies the allocation in that registry, not a Dogecoin consensus reservation.
