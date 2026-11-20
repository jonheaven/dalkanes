# Dalkanes specification

**Version:** 0.1 (draft)
**Status:** Experimental reference profile; known implementation defects are listed in [IMPLEMENTATION.md](IMPLEMENTATION.md). No live-chain verification is claimed.
**Carrier:** `OP_RETURN` payload beginning `0xD1 0x01`
**License:** MIT

The key words MUST, MUST NOT, REQUIRED, SHALL, SHOULD, SHOULD NOT, RECOMMENDED, MAY and OPTIONAL are to be read as in RFC 2119 and RFC 8174.

Sections marked *(informative)* are guidance. Everything else is normative.

---

## 1. Overview

Dalkanes is an indexer-level metaprotocol. It adds deterministic WebAssembly contracts to Dogecoin without changing Dogecoin consensus. The design goal is state reproducible from the Dogecoin chain and a pinned execution profile. Independent implementations MUST pin the same activation and fuel schedule before comparing state. This draft is not a declaration of a production-ready consensus standard; unresolved differences are listed in IMPLEMENTATION.md.

The protocol has three on-chain actions and one off-chain action:

| Action | Carrier | Effect |
| --- | --- | --- |
| Deploy | Doginals inscription (§4) | Stores WASM code under a new contract id |
| Call | `OP_RETURN` `0xD1` message (§5) | Executes a contract and may change its storage and host ledger |
| (none) | Plain Dogecoin transactions | No Dalkanes effect |
| Simulate | Indexer API (Appendix A) | Dry-run with no state change |

Dalkanes does not attach assets to UTXOs. Contract balances live in a host ledger (§8), keyed by account bytes that each contract defines. Spending, splitting or burning a Dogecoin output never moves a Dalkanes balance.

## 2. Activation

- Indexers MUST NOT process Dalkanes deploys or calls in blocks below the **activation height** for their network.
- The reference implementation defaults mainnet and testnet to disabled (`u32::MAX`), with an operator activation-height override.
- Regtest defaults to height `0`. The protocol filter must also enable the lane.
- Reproducible replay MUST record the network, activation height, runtime version, fuel cap and source revision. Operator settings are not a network-wide activation agreement.

No launch height is published here. No inference about live deployments should be drawn from the disabled default.

## 3. Identifiers

An **AlkaneId** is the pair `(block, tx)`:

| Field | Type | Meaning |
| --- | --- | --- |
| `block` | u64 | Height of the block containing the deploy transaction |
| `tx` | u32 | Index of the deploy transaction within that block (coinbase = 0) |

- **Display form:** `"{block}:{tx}"` in decimal, for example `5123456:7`.
- **Key form (12 bytes):** `block` as 8-byte big-endian, then `tx` as 4-byte big-endian. Storage and ledger keys use this form.
- Top-level calls use `0:0` as the caller sentinel. The implementation defines no additional special deployment/clone/genesis ids.

## 4. Deploy

### 4.1 Carrier

A deploy is a Doginals inscription, using the standard Dogecoin Doginals envelope in P2SH `scriptSig` data, possibly spread across a chain of transactions. The deploy transaction is the transaction in which the inscriptions indexer recognises the inscription as revealed. Its height and index give the AlkaneId.

An inscription is a **deploy candidate** if any of these is true:

1. Its content type, compared case-insensitively as ASCII, contains `wasm` or `alkane`.
2. Its body contains the 4-byte sequence `00 41 4C 4B` (`\0ALK`).
3. Its body contains the 4-byte sequence `00 61 73 6D` (`\0asm`, the WASM magic).

Content type `application/wasm` is RECOMMENDED.

### 4.2 Body decoding

For a candidate body `B`:

1. **Locate the start.** If `B` begins with `\0ALK` or `\0asm`, start at offset 0. Otherwise start at the first offset where either sequence occurs. If neither occurs, this is not a deploy. (This tolerates envelope parsers that leave stray prefix bytes. Encoders MUST NOT rely on it.)
2. **Framing.** Call the slice from that point `S`. If `S` begins with `\0ALK` and is at least 5 bytes long, byte 4 is the deploy version and the payload is `S[5..]`. If the version is not `0x01`, this is not a deploy. Otherwise the payload is `S`.
3. **Decompression.** If the content type contains `gzip`, or the payload begins with `1F 8B`, the payload MUST be gzip-inflated. If inflation fails, this is not a deploy.
4. **Checks.** The result is the **code**. It MUST be 4 to 524,288 bytes long (512 KiB) and MUST begin with `\0asm`. Otherwise this is not a deploy. Indexers SHOULD stop inflating after 524,289 output bytes rather than inflating unbounded input.

Encoders SHOULD emit one of these exact forms:

- the raw module (`\0asm…`)
- `\0ALK` `0x01` followed by the raw module
- `\0ALK` `0x01` followed by the gzip of the module, with content type `application/wasm+gzip` or `application/wasm`

### 4.3 Effect

On a valid deploy in transaction index `i` of block `H`:

- If AlkaneId `(H, i)` already has code, the deploy is ignored. The intended first-valid-deploy rule is not reliably enforced within an uncommitted block batch; see IMPLEMENTATION.md.
- Otherwise store the code under `(H, i)`, and record `code_hash = SHA-256(code)` in lowercase hex along with the metadata in [schemas/deploy-meta.schema.json](schemas/deploy-meta.schema.json).

v0.1 does **not** validate the module at deploy time. A body that passes §4.2 but is not a loadable module is still stored. Every call to it fails at instantiation (§6.3) and gets a failure receipt.

A deploy does not execute anything. Contracts initialise themselves on their first call, conventionally opcode `0`.

## 5. Call

### 5.1 Carrier

A call is a transaction output whose `scriptPubKey` begins with `OP_RETURN` (`0x6a`), followed by data pushes that match one of the forms below. The canonical form is form A.

| Form | Pushes after `OP_RETURN` | Cellpack bytes |
| --- | --- | --- |
| A (canonical) | one push: `D1 01 ‖ cellpack` | push[0][2..] |
| B | push `D1`, push `01`, push `cellpack` (more pushes allowed and ignored) | push[2] |
| C | push `D1`, push `01 ‖ cellpack` | push[1][1..] |

Push parsing:

- Opcodes `0x00`–`0x4b` push that many bytes. `OP_PUSHDATA1` (`0x4c`) and `OP_PUSHDATA2` (`0x4d`) push the length they declare.
- Parsing stops, successfully, at the first other opcode. Later bytes are ignored.
- A push that runs past the end of the script makes the output not a call.

Indexers MUST scan outputs in order and use the **first** output that yields a cellpack which decodes per §5.2. Other outputs are ignored. A transaction carries at most one Dalkanes call.

Encoders MUST emit form A. Dogecoin Core relays by default only one `OP_RETURN` output of at most 83 script bytes, which is an 80-byte payload. So a relayable call has a cellpack of **at most 78 bytes**. A larger call is valid Dalkanes if a miner includes it, but it will not relay through default nodes.

### 5.2 Cellpack

A cellpack is a sequence of unsigned LEB128 integers, each decoding to a value of at most 128 bits:

```
target_block  target_tx  fuel  n_inputs  input[0] … input[n_inputs-1]
```

Decoding rules:

- A truncated varint, or one whose value does not fit in u128, makes the cellpack invalid.
- `n_inputs` MUST be ≤ 256. Otherwise the cellpack is invalid.
- Bytes after the last input are ignored.
- After reading u128 varints the reference decoder narrows `target_block` to u64, `target_tx` to u32, `fuel` to u64, and `n_inputs` to native `usize`, using truncating Rust casts. The input-count cap is checked **after** this conversion. Independent decoders reproducing this profile MUST use the same conversions (64-bit `usize` on the audited host). Writers SHOULD NOT exceed the destination ranges. This is a compatibility description, not recommended new-protocol validation.
- The shared varint helper accepts non-minimal encodings. Its final-group high-bit overflow handling is not a complete u128 range check; see IMPLEMENTATION.md. Restrict writers to canonical u128 encodings.
- `fuel` is the caller's requested fuel. See §6.2.

If the cellpack is invalid, the transaction has no Dalkanes effect and gets no receipt.

### 5.3 Calldata

The **calldata** passed to the guest is the inputs, each as a 16-byte little-endian u128, concatenated. Its length is `16 × n_inputs`. By convention `input[0]` is an opcode (§13).

### 5.4 Target resolution

If no code exists for `(target_block, target_tx)` when the call is processed (§6.1), the call is ignored and gets no receipt.

## 6. Execution

### 6.1 Ordering and state visibility

Within a block, indexers MUST apply effects in this order:

1. Deploys, in the order the inscriptions indexer reveals them.
2. Calls, in transaction-index order.

**Current reference visibility:** all reads use the pre-block database, while writes are queued in a single block `WriteBatch`. Calls therefore do **not** see same-block deploys or previous calls' staged writes. Conflicting writes to a key in that batch are last-write-wins. A compatible replay MUST preserve that visibility until a versioned correction is agreed. Sequential visibility is the desired fix, not an implemented feature.

### 6.2 Fuel

- Default `MAX_FUEL` = **5,000,000**, overridable by the operator in the reference implementation. Indexers comparing results MUST agree on the override.
- Fuel granted = `max(1, min(fuel, MAX_FUEL))`, after `fuel` is narrowed by truncation to u64.
- Instruction fuel uses `wasmi` with `consume_fuel` enabled. “1.x” alone does not pin a fuel schedule. The exact dependency version and instruction costs MUST be fixed in a future reproducibility profile; no cross-version conformance is claimed here.
- Host functions charge the extra fuel listed in §7. If a host charge exceeds the remaining fuel, that is a fatal host error (§6.4).
- There is no per-block fuel budget in v0.1.

### 6.3 Steps

For each call, an indexer MUST:

1. Load the target's storage map. If it has more than **8,192** keys, the call fails with no execution.
2. Instantiate the module with only the `env` imports in §7. Importing anything else, failing validation, or lacking an exported `memory` or `__dalk_execute (i32, i32) -> i32` export makes the call fail. A start function, if present, runs under the same fuel.
3. Write the calldata into exported `memory` at offset **`0x1000`** (4096). If memory is too small, the call fails.
4. Invoke `__dalk_execute(0x1000, calldata_len)`.
5. The call **succeeds** if and only if the export returns `0`, did not trap, and no fatal host error occurred. Then commit the staged storage writes into the target's storage and the staged ledger writes into the host ledger, atomically.
6. Otherwise, including a non-zero return, a trap or running out of fuel, discard every staged write.
7. Record a receipt (§9) on both success and failure.

After guest return or a guest trap, `fuel_used` = granted fuel minus remaining fuel. Early exits during loading/instantiation/export/memory setup currently report the default zero; this can under-report start-function consumption.

### 6.4 Fatal host errors

These make the call fail even if `__dalk_execute` later returns `0`:

- running out of fuel inside a host charge
- staging more than **512** distinct storage keys in one frame
- running out of fuel on a nested-call base charge

### 6.5 Context values

| Value | Top-level call |
| --- | --- |
| `alkane_block` | Height of the block being indexed |
| `alkane_tx` | Index of the call transaction |
| `alkane_time` | Block header `nTime` (unix seconds) |
| `alkane_myself_*` | Target AlkaneId |
| `alkane_caller_*` | `0:0` |
| `alkane_value` | Attached value, see below |
| `incoming_*` | Empty list |

**Attached value.** Take the values, in koinu, of the call transaction's outputs that are not `OP_RETURN` and are greater than zero. If there are two or more, `alkane_value` is the sum of all of them except one output with the largest value. If there is exactly one, it is that value. If there are none, it is `0`.

> **Security note.** Attached value is a heuristic, not custody. The DOGE stays wherever the transaction sent it, and nothing binds it to the contract. Contracts MUST NOT treat `alkane_value` as funds they control.

**Incoming parcels.** Normally empty on chain; simulations can supply them. The reference updater has one code-hash exception: for its exact dice template, a positive attached value is converted to the synthetic parcel `(0,0,value)`. It is not evidence of an actual asset deposit. Reproducibility requires pinning that template hash; the general parcel layer remains unimplemented.

### 6.6 Determinism requirements

- The interpreter MUST be deterministic and MUST NOT expose clocks, randomness, network or filesystem access.
- Contracts SHOULD NOT use floating-point instructions. v0.1 does not forbid them. A future version may reject modules that use them.
- The existing dice code-hash exception above is implementation-specific and SHOULD be removed or versioned before interoperability is claimed.

## 7. Host ABI (`env` module)

Pointers and lengths are `i32`. A negative length is treated as 0. Out-of-bounds guest memory access returns the function error value (or silently returns for void imports); a preceding fuel charge can still take effect. Nested-call write merging currently precedes return-buffer validation, as noted in IMPLEMENTATION.md. Ids passed as `i64` are clamped below at 0. `tx` values are then truncated to u32.

### 7.1 Storage

| Import | Signature | Fuel | Behavior |
| --- | --- | --- | --- |
| `storage_get` | `(key_ptr, key_len, out_ptr, out_max) -> i32` | 1,000 + key_len | `key_len` > 256: returns −1, no charge. Reads the frame's staged value for the key, else the stored value. A missing key reads as empty. Writes `min(len, out_max)` bytes and returns that count. So a missing or empty key returns `0`. |
| `storage_set` | `(key_ptr, key_len, val_ptr, val_len)` | 1,000 + key_len + val_len | `key_len` > 256 or `val_len` > 4,096: silent no-op, no charge. Otherwise stages the write. A 513th distinct key is fatal. A zero-length value is stored as present-but-empty, and counts toward the 8,192-key cap. |

Storage is per contract. The persistent key is `AlkaneId (12 bytes) ‖ key`.

### 7.2 Output

| Import | Signature | Fuel | Behavior |
| --- | --- | --- | --- |
| `return_data` | `(ptr, len)` | 0 | Sets the frame's return data to `min(len, 16384)` bytes. The last call wins. |
| `log` | `(ptr, len)` | 0 | Appends `min(len, 256)` bytes, decoded as lossy UTF-8, to the receipt logs |

### 7.3 Context

| Import | Signature | Fuel |
| --- | --- | --- |
| `alkane_block` | `() -> i64` | 0 |
| `alkane_tx` | `() -> i64` | 0 |
| `alkane_time` | `() -> i64` | 0 |
| `alkane_value` | `() -> i64` | 0 |
| `alkane_myself_block`, `alkane_myself_tx` | `() -> i64` | 0 |
| `alkane_caller_block`, `alkane_caller_tx` | `() -> i64` | 0 |
| `incoming_count` | `() -> i32` | 0 |
| `incoming_get` | `(i, out_ptr) -> i32` | 0 |

`incoming_get` writes 32 bytes: `token_block` (u64 LE), `token_tx` (u64 LE, zero-extended), `amount` (u128 LE). It returns 32, or −1 if `i` is out of range.

### 7.4 Crypto

| Import | Signature | Fuel | Behavior |
| --- | --- | --- | --- |
| `sha256` | `(ptr, len, out_ptr) -> i32` | 2,000 | Hashes `min(len, 65536)` bytes and writes the 32-byte digest. Returns 32 or −1. |
| `verify_schnorr` | `(msg32_ptr, pk32_ptr, sig64_ptr) -> i32` | 25,000 | BIP-340 verification of a 64-byte signature over a 32-byte message with an x-only key. Returns 1 if valid, else 0. |

Top-level calls are **anonymous**: nothing tells a contract which key or address sent the transaction. A contract that needs authorisation MUST check it itself, for example by having the caller sign a domain-separated message and calling `verify_schnorr`.

### 7.5 Host ledger

See §8 for the data model. Amounts are passed as two `i64` halves, `amount = (u64)lo | ((u64)hi << 64)`. Account buffers MUST be 1–32 bytes, or the call fails with the error value.

| Import | Signature | Fuel | Behavior |
| --- | --- | --- | --- |
| `ledger_get` | `(token_b: i64, token_tx: i64, acct_ptr, acct_len, out_ptr) -> i32` | 3,000 | Writes the 16-byte LE balance and returns 16, or −1 |
| `ledger_mint` | `(token_b, token_tx, to_ptr, to_len, lo: i64, hi: i64) -> i32` | 3,000 | Returns 0 unless `myself == token` and amount > 0. Adds to the balance, saturating, and returns 1. |
| `ledger_transfer` | `(token_b, token_tx, from_ptr, from_len, to_ptr, to_len, lo: i64, hi: i64) -> i32` | 3,000 | Returns 0 unless `myself == token`, amount > 0, and `from` balance ≥ amount. Stages `from_balance - amount` and then `to_balance.saturating_add(amount)`, returning 1. If `from == to`, the second write overwrites the debit and increases the balance; this is a known defect, not a safe transfer primitive. |

### 7.6 Nested calls

| Import | Signature | Behavior |
| --- | --- | --- |
| `staticcall` | `(tgt_b: i64, tgt_tx: i64, cd_ptr, cd_len, out_ptr, out_max, fuel: i64) -> i32` | Runs the target. Its writes are discarded. |
| `call` | same | Runs the target. On success, its writes merge into the calling frame. |

Rules for both:

- Depth: a top-level call is depth 0. A nested call from depth ≥ 8 returns −1.
- The base charge is 10,000 fuel, and running short is fatal. After it, the child gets `max(1, min(remaining, fuel))`, and the fuel the child uses is deducted from the caller.
- Calldata is the `min(cd_len, 16384)` bytes at `cd_ptr`. They are passed raw, not re-encoded.
- Child context: `myself` = target, `caller` = the calling contract, `alkane_block` and `alkane_time` inherited, `alkane_tx` = 0, `alkane_value` = 0, `incoming` empty.
- The child sees the caller frame's staged ledger writes. Its storage, however, is resolved from a pre-block database catalog, not an overlay of earlier staged writes.
- If the target does not exist, or the child fails, the nested call returns −1 and the child has no effect.
- On success it writes `min(len, out_max)` bytes of the child's return data to `out_ptr` and returns that count. The caller frame's pending return data is replaced by the child's, until the caller sets its own.
- `call` only: the reference runtime merges child storage writes as unqualified keys into the parent's write map. The updater prefixes all of them with the **top-level target** id. This is a namespace-isolation defect, not safe child-state semantics. Child ledger writes keep their full keys. All staged changes commit only if the top-level call succeeds. Production mutating cross-contract calls SHOULD NOT be used before this is corrected.

## 8. Host ledger

The host ledger is one global map:

```
key   = token AlkaneId (12 bytes) ‖ account (1–32 bytes)
value = balance, u128 little-endian (16 bytes)
```

- A zero balance is the same as an absent key. Indexers SHOULD delete zero entries.
- Only contract `T` can mint or transfer balances under token `T`. Contracts can read any balance.
- **Account bytes are opaque.** The protocol does not tie them to Dogecoin addresses, keys or UTXOs. A token contract defines what an account is, and MUST enforce who can move it. A token whose `transfer` takes `from` from calldata without a signature check lets anyone move anyone's balance. The current token demonstration template does exactly that and is not safe for value-bearing use.

## 9. Receipts

A receipt is recorded for every call whose target exists (§5.4), keyed by txid. Its fields are in [schemas/call-receipt.schema.json](schemas/call-receipt.schema.json): `txid`, `height`, `target`, `ok`, `fuel_used`, `return_hex`, `error`, `logs`.

`ok`, `fuel_used` and `return_hex` are consensus-relevant. Two indexers MUST agree on them. `error` strings and `logs` are diagnostic and MAY differ in wording.

## 10. Invalid and no-op messages

Dalkanes has no cenotaphs. Because it carries no UTXO-bound assets, a malformed message cannot burn anything.

| Situation | Result |
| --- | --- |
| No `0xD1` output, or wrong version byte | Not a call |
| Cellpack fails §5.2 | No effect, no receipt |
| Target has no code | No effect, no receipt |
| Below activation height | No effect, no receipt |
| Storage over cap, instantiation error, trap, out of fuel, non-zero status, fatal host error | Receipt with `ok: false`, no state change |
| Deploy that fails §4.2 | Ordinary inscription, no contract |

The Dogecoin transaction itself is always valid or invalid by Dogecoin's own rules. DOGE moves as the transaction says, whatever happens to the Dalkanes message.

## 11. Reorgs

- Dalkanes state SHOULD be fully determined by the active chain plus the pinned replay profile.
- When a block is disconnected, an indexer MUST restore the state to exactly what it was before that block was applied. That means removing code and metadata deployed in the block, removing its receipts, and restoring every storage and ledger entry it changed, including deleting entries it created. The current undo encoding conflates absent values with stored empty storage values; exact restoration is a known gap, not a passing conformance claim.
- A block's Dalkanes effects MUST be committed atomically with the indexer's record of having processed that block.

*(Informative)* Dogecoin targets a block about every 60 seconds under merged-mined AuxPoW. Applications SHOULD choose confirmation policies appropriate to reorg risk; this spec does not establish a settlement guarantee.

## 12. Limits (summary)

| Limit | Value |
| --- | --- |
| Code size after inflation | 4 B – 512 KiB |
| Cellpack inputs | ≤ 256 (≤ 78 bytes total for default relay) |
| `MAX_FUEL` per top-level call | 5,000,000 |
| Storage keys loaded per contract | ≤ 8,192 |
| Distinct storage writes per frame | ≤ 512 |
| Storage key / value | 256 B / 4,096 B |
| Return data | 16,384 B |
| Log entry | 256 B |
| `sha256` input | 65,536 B |
| Nested-call depth | 8 |
| Nested-call calldata | 16,384 B |
| Ledger account | 1–32 B |

Host fuel: storage op 1,000 + 1 per byte, `sha256` 2,000, `verify_schnorr` 25,000, ledger op 3,000, nested-call base 10,000.

## 13. Conventions *(informative)*

These come from the ALKANES standard contracts. They make explorers and wallets work across contracts:

| Opcode (`input[0]`) | Meaning |
| --- | --- |
| `0` | initialize (once) |
| `77` | mint |
| `99` / `100` / `101` | name / symbol / total supply (views) |
| `102`–`104` | cap / minted / value per mint (free-mint views) |
| `1000` | data / attributes |

The `__dalk_execute` status codes other than `0` are contract-defined.

## 14. Relationship to Bitcoin ALKANES *(informative)*

| Topic | ALKANES (Bitcoin) | Dalkanes (Dogecoin) | Why |
| --- | --- | --- | --- |
| Host for messages | Protostones inside a Runestone (protorunes, protocol tag `1`) | Standalone `OP_RETURN` with `0xD1` | Dogecoin has no Runes, so there is no Runestone to embed in |
| Deploy carrier | Gzipped WASM in a Taproot witness envelope, plus a `[1,0]` / `[3,n]` cellpack | Doginals inscription (P2SH `scriptSig`) | No Taproot or witness on Dogecoin. Doginals is the established data carrier. |
| Contract ids | `[2, n]` by sequence, `[4, n]` reserved, `[5,n]` / `[6,n]` clone | `block:tx` of the deploy | Simple and Runes-style. Factory and clone ids were dropped in v0.1. |
| Message size | Bitcoin `OP_RETURN`, much larger since Core 30 | ≤ 80-byte payload (78-byte cellpack) by default relay | Dogecoin Core policy |
| Assets | Protorune balances bound to UTXOs, with edicts, pointer and refund pointer | Host ledger keyed by contract-defined accounts | No protorune host. A simpler model at the cost of UTXO-native transfers. |
| Caller identity | Context with incoming parcels, plus the full transaction and block (`__load_transaction`, `__load_block`) | Anonymous top-level calls. Contracts verify Schnorr signatures. | No input-bound assets yet. A tx-context import is on the roadmap (§15). |
| Runtime | `wasmi` fuel inside the METASHREW WASM indexer | `wasmi` 1.x fuel inside a native indexer | Same metering idea, no separate METASHREW process |
| Fuel budget | 100M per block, split by vsize, 90k minimum per message | 5M per call, no block budget | Simpler. A block budget is on the roadmap (§15). |
| Contract ABI | `__execute`, `__request_context` / `__load_context`, `__request_storage` / `__load_storage`, `__call` / `__staticcall` / `__delegatecall`, `__returndatacopy`, … | `__dalk_execute(ptr, len)`, plus the `env` imports in §7 | Smaller ABI. ALKANES contracts must be ported. |
| Genesis contracts | DIESEL at `[2,0]` | No hard-coded genesis installation found. Templates are ordinary deploys. | No equivalent bootstrap implementation |
| Activation | Block 880,000 | Operator configured; no network agreement claimed (§2) | |

## 15. Reserved and future work *(informative)*

- A block-level fuel budget and minimum fuel per message.
- A per-transaction caller context (inputs and outputs) for contracts.
- Asset transfer into calls, for example through Dunes or a native parcel format. This would fill the `incoming_*` imports on chain.
- Factory and clone deploys, and deterministic reserved ids.
- Module validation at deploy, and a float-free instruction subset.
- Rejecting out-of-range cellpack ids (§5.2).

---

## Appendix A. Indexer HTTP API *(informative)*

The reference indexer serves these routes. They are not part of consensus:

| Route | Purpose |
| --- | --- |
| `GET /api/alkanes` | Recent deploys |
| `GET /api/alkanes/{block}/{tx}` | Metadata, code hash and recent calls |
| `GET /api/alkanes/{block}/{tx}/storage` | Storage peek |
| `GET /api/alkanes/{block}/{tx}/inspect` | ABI-aware read methods, for known templates |
| `GET /api/alkanes/calls`, `GET /api/alkanes/calls/{txid}` | Receipts |
| `GET /api/alkanes/ledger/{block}/{tx}/{account}` | Host-ledger balance |
| `POST /api/alkanes/simulate` | Dry run. Accepts `value` and `incoming` overrides. |
| `POST /api/alkanes/build-call` | Builds a form-A `OP_RETURN` script |
| `GET /api/alkanes/templates[/{name}]` | Reference contract templates |

## Appendix B. Worked example

Call contract `100:1` with fuel 100,000 and one input, opcode `0`:

```
cellpack  = 64 01 a0 8d 06 01 00
payload   = d1 01 64 01 a0 8d 06 01 00
script    = 6a 09 d1 01 64 01 a0 8d 06 01 00
calldata  = 00000000000000000000000000000000   (one u128 LE)
```

More cases are in [vectors/](vectors/).
