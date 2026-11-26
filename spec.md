# Dalkanes specification

**Version:** 0.3.0 (draft)
**Status:** Experimental. The reference indexer implements this version and its unit tests pass; remaining gaps are listed in [IMPLEMENTATION.md](IMPLEMENTATION.md). Mainnet activation is pinned at block 6,466,500 (§2). No live-chain replay is claimed.
**Carrier:** `OP_RETURN` payload beginning `0xD1 0x01`
**License:** MIT

The key words MUST, MUST NOT, REQUIRED, SHALL, SHOULD, SHOULD NOT, RECOMMENDED, MAY and OPTIONAL are to be read as in RFC 2119 and RFC 8174.

Sections marked *(informative)* are guidance. Everything else is normative.

---

## 1. Overview

Dalkanes is an indexer-level metaprotocol. It adds deterministic WebAssembly contracts to Dogecoin without changing Dogecoin consensus. The design goal is state reproducible from the Dogecoin chain and a pinned execution profile. The activation height, fuel caps and interpreter version are spec constants (§2, §6.2), not operator settings. This draft is not a declaration of a production-ready consensus standard; open items are listed in IMPLEMENTATION.md.

The protocol has three on-chain actions and one off-chain action:

| Action | Carrier | Effect |
| --- | --- | --- |
| Deploy | Doginals inscription (§4) | Stores WASM code under a new contract id |
| Call | `OP_RETURN` `0xD1` message (§5) | Executes a contract and may change its storage and host ledger |
| (none) | Plain Dogecoin transactions | No Dalkanes effect |
| Simulate | Indexer API (Appendix A) | Dry-run with no state change |

A Dalkane token a wallet holds sits on a Dogecoin output (§16). Spending that output without a version `0x02` parcel burns the balance. The host ledger (§8) is the contract's own sheet: coins move there when a parcel deposits them into a call, and a call can mint or withdraw them back onto an output. An older template may still keep an account balance in that ledger; spending a Dogecoin output does not move those account balances.

## 2. Activation

- Indexers MUST NOT process Dalkanes deploys or calls in blocks below the **activation height** for their network.
- On mainnet and testnet the activation height is a constant of this spec. Indexers MUST NOT let an operator setting move it; the reference ignores its activation environment variable on these networks.
- Regtest defaults to height `0` and MAY be overridden for development.

| Network | Activation height | Notes |
| --- | --- | --- |
| Mainnet | **6,466,500** | Chosen 2026-11-20 just above the tip at the time (6,466,091). Blocks ≥ 6,466,500 are processed; 6,466,499 and below are not. |
| Testnet | not set | Disabled (the reference uses `u32::MAX`). A future version will publish it. |
| Regtest | `0` | Overridable for development only. |

Mainnet has no Dalkanes state below 6,466,500; an indexer starts empty at that block.

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

1. **Locate the start.** If `B` begins with `\0ALK`, `\0asm` or the gzip magic `1F 8B`, start at offset 0. Otherwise start at the first offset where either sequence occurs. If neither occurs, this is not a deploy. (This tolerates envelope parsers that leave stray prefix bytes. Encoders MUST NOT rely on it.)
2. **Framing.** Call the slice from that point `S`. If `S` begins with `\0ALK` and is at least 5 bytes long, byte 4 is the deploy version and the payload is `S[5..]`. If the version is not `0x01`, this is not a deploy. Otherwise the payload is `S`.
3. **Decompression.** If the content type contains `gzip`, or the payload begins with `1F 8B`, the payload MUST be gzip-inflated. If inflation fails, this is not a deploy.
4. **Checks.** The result is the **code**. It MUST be 4 to 524,288 bytes long (512 KiB) and MUST begin with `\0asm`. Otherwise this is not a deploy. Indexers MUST stop inflating after 524,289 output bytes (one past the cap) and treat the body as not a deploy, rather than inflating unbounded input.

Encoders SHOULD emit one of these exact forms:

- the raw module (`\0asm…`)
- `\0ALK` `0x01` followed by the raw module
- `\0ALK` `0x01` followed by the gzip of the module, with content type `application/wasm+gzip` or `application/wasm`

### 4.3 Effect

On a valid deploy in transaction index `i` of block `H`:

- **First valid deploy wins.** If AlkaneId `(H, i)` already has code, including code deployed earlier in the same block or by an earlier inscription in the same transaction, the deploy is ignored. A transaction creates at most one contract.
- Otherwise store the code under `(H, i)`, and record `code_hash = SHA-256(code)` in lowercase hex along with the metadata in [schemas/deploy-meta.schema.json](schemas/deploy-meta.schema.json).

This version does **not** validate the module at deploy time. A body that passes §4.2 but is not a loadable module is still stored. Every call to it fails at instantiation (§6.3) and gets a failure receipt.

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

- **Varints.** A varint is at most 19 bytes. A truncated varint, a 19th byte with the continuation bit set, or a 19th byte whose low 7 bits exceed `0x03` (a value past 2^128 − 1) makes the cellpack invalid. Non-minimal encodings that still fit are accepted; writers SHOULD emit minimal ones.
- **Ranges.** `target_block` MUST be ≤ 2^64 − 1 and `target_tx` ≤ 2^32 − 1, or the cellpack is invalid. Values are never truncated.
- `n_inputs` MUST be ≤ 256, compared on the full decoded value. Otherwise the cellpack is invalid. Every listed input MUST be present.
- `fuel` above 2^64 − 1 saturates to 2^64 − 1 (it is clamped to `MAX_FUEL` anyway, §6.2).
- Bytes after the last input are ignored.
- `fuel` is the caller's requested fuel. See §6.2.

If the cellpack is invalid, the transaction has no Dalkanes effect and gets no receipt.

### 5.3 Calldata

The **calldata** passed to the guest is the inputs, each as a 16-byte little-endian u128, concatenated. Its length is `16 × n_inputs`. By convention `input[0]` is an opcode (§13).

### 5.4 Target resolution

A call in transaction `j` of block `H` can see a contract deployed in an earlier block, or deployed in block `H` by a transaction with index ≤ `j` (so a transaction can deploy and call the same contract). If no visible code exists for `(target_block, target_tx)`, the call is ignored and gets no receipt. The same visibility rule applies to targets of nested calls (§7.6).

## 6. Execution

### 6.1 Ordering and state visibility

Within a block, indexers MUST apply effects in this order:

1. Deploys, in the order the inscriptions indexer reveals them.
2. Calls, in transaction-index order.

**Sequential visibility.** Calls execute one at a time in transaction-index order. Each call sees the state left by every earlier call in the same block: storage, ledger balances, and same-block deploys subject to §5.4. Equivalently, a block's calls produce the same state as committing each call before running the next. The reference keeps an in-block overlay in front of the database and commits the block atomically.

### 6.2 Fuel

- `MAX_FUEL` = **5,000,000** per top-level call. It is a constant; there is no operator override.
- Fuel granted = `max(1, min(fuel, MAX_FUEL))`.
- Instruction fuel is the default fuel schedule of **`wasmi` 1.1.0** with `consume_fuel` enabled. The interpreter version is part of this spec: the reference pins the exact version (`wasmi = "=1.1.0"`), and changing it is a protocol change. Another implementation MUST reproduce wasmi 1.1.0's fuel accounting exactly.
- Host functions charge the extra fuel listed in §7. If a host charge exceeds the remaining fuel, that is a fatal host error (§6.4).
- **Block budget.** `BLOCK_FUEL_BUDGET` = **100,000,000** per block. It is a constant; there is no operator override. Let `R` be the budget left before a call (100,000,000 at the first call in the block). For each call whose target exists (§5.4), in transaction-index order:
  - If `R` = 0, the call is not executed. Its receipt is `ok: false`, `fuel_used: 0`, with no state change (error `block fuel budget exhausted`).
  - Otherwise fuel granted = `min(max(1, min(fuel, MAX_FUEL)), R)`, and after the call `R` ← `R − fuel_used`.
  - Deploys, and messages that produce no receipt (§10), do not touch `R`. Nested calls draw from their top-level call's grant, not separately from `R`.
- Budget is first come, first served in transaction order; there is no per-message minimum and no split by transaction size. Vectors: [vectors/block-fuel.json](vectors/block-fuel.json).

### 6.3 Steps

For each call, an indexer MUST:

1. Read state lazily as the guest asks for it. There is no cap on how many keys a contract has; only the per-frame write cap (§6.4) applies.
2. Instantiate the module with only the `env` imports in §7. Importing anything else, failing validation, or lacking an exported `memory` or `__dalk_execute (i32, i32) -> i32` export makes the call fail. A start function, if present, runs under the same fuel.
3. Write the calldata into exported `memory` at offset **`0x1000`** (4096). If memory is too small, the call fails.
4. Invoke `__dalk_execute(0x1000, calldata_len)`.
5. The call **succeeds** if and only if the export returns `0`, did not trap, and no fatal host error occurred. Then commit, atomically, every contract's staged storage writes under that contract's own id (the target's and those of contracts reached through `call`, §7.6) and the staged ledger writes.
6. Otherwise, including a non-zero return, a trap or running out of fuel, discard every staged write.
7. Record a receipt (§9) on both success and failure.

`fuel_used` = granted fuel minus remaining fuel, at every exit once fuel has been granted: guest return, trap, and also instantiation or start-function failure, a missing `memory` or `__dalk_execute` export, and a failed calldata write. A start function's consumption is therefore always reported. Only a module that fails to decode (before instantiation) reports `fuel_used: 0`. A nested child's `fuel_used` is computed the same way and is deducted from its caller (§7.6).

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
| `alkane_value` | Koinu value of the carrier output, see below |
| `alkane_sender` | Verified sender, see below |
| `incoming_*` | Empty list |

**Attached value.** `alkane_value` is the value, in koinu, of the carrier output itself: the `0xD1` `OP_RETURN` output that holds the call (§5.1). That DOGE is provably burned. No other output counts. Most calls carry 0.

> **Security note.** A contract never receives or controls DOGE. `alkane_value` proves the caller burned that much with the call, nothing more; any payout a contract makes is a host-ledger balance (§8), never DOGE. Dogecoin Core relays `OP_RETURN` outputs with a non-zero value under default policy, but wallets may refuse to build them.

**Verified sender.** If input 0 of the call transaction is a standard P2PKH spend, meaning its `scriptSig` is exactly two pushes `<sig> <pubkey>` with a 33-byte compressed or 65-byte uncompressed key, and the signature verifies under the legacy sighash for input 0 with a P2PKH script code for that key, and the signature's hash type has base type `SIGHASH_ALL` (`0x01`, optionally with `ANYONECANPAY` `0x80`), then the sender is `HASH160(pubkey)`, the 20-byte payload of that Dogecoin address. Otherwise there is no sender. `SIGHASH_ALL` commits to every output, including the carrier, so only the key holder can make a call that names them. Signature checking follows Dogecoin's (lax DER, low-S normalised before verification). A nested call never has a sender.

**Incoming parcels.** A version `0x01` call sees an empty list. A version `0x02` call sees the deposits routed into it (§16). Simulations may supply a list either way.

### 6.6 Determinism requirements

- The interpreter MUST be deterministic and MUST NOT expose clocks, randomness, network or filesystem access.
- Contracts SHOULD NOT use floating-point instructions. This version does not forbid them. A future version may reject modules that use them.
- Execution MUST NOT depend on a contract's code hash.

## 7. Host ABI (`env` module)

Pointers and lengths are `i32`. A negative length is treated as 0. Out-of-bounds guest memory access returns the function error value (or silently returns for void imports); a preceding fuel charge can still take effect. For a successful `call`, the child's return data is copied out first; if that copy is out of bounds, `call` returns −1 and the child's writes are discarded as if it had failed (§7.6). Ids passed as `i64` MUST satisfy `block ≥ 0` and `0 ≤ tx ≤ 2^32 − 1`; otherwise the import returns its error value (−1 for `ledger_get`, `staticcall` and `call`; 0 for `ledger_mint` and `ledger_transfer`). Ids are never clamped or truncated.

### 7.1 Storage

| Import | Signature | Fuel | Behavior |
| --- | --- | --- | --- |
| `storage_get` | `(key_ptr, key_len, out_ptr, out_max) -> i32` | 1,000 + key_len | `key_len` > 256: returns −1, no charge. Reads, in order: the value staged for this contract earlier in the same top-level call (including by nested calls), the stored value as of the start of the call (§6.1), else empty. A missing key reads as empty. Writes `min(len, out_max)` bytes and returns that count. So a missing or empty key returns `0`. |
| `storage_set` | `(key_ptr, key_len, val_ptr, val_len)` | 1,000 + key_len + val_len | `key_len` > 256 or `val_len` > 4,096: silent no-op, no charge. Otherwise stages the write. A 513th distinct key is fatal. A zero-length value is stored as present-but-empty. |

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
| `alkane_sender` | `(out_ptr) -> i32` | 1,000 |
| `alkane_myself_block`, `alkane_myself_tx` | `() -> i64` | 0 |
| `alkane_caller_block`, `alkane_caller_tx` | `() -> i64` | 0 |
| `incoming_count` | `() -> i32` | 0 |
| `incoming_get` | `(i, out_ptr) -> i32` | 0 |

`alkane_sender` writes the 20-byte verified sender (§6.5) at `out_ptr` and returns 20. It returns −1 if there is no verified sender, in a nested call, or if the write is out of bounds.

`incoming_get` writes 32 bytes: `token_block` (u64 LE), `token_tx` (u64 LE, zero-extended), `amount` (u128 LE). It returns 32, or −1 if `i` is out of range.

### 7.4 Crypto

| Import | Signature | Fuel | Behavior |
| --- | --- | --- | --- |
| `sha256` | `(ptr, len, out_ptr) -> i32` | 2,000 | Hashes `min(len, 65536)` bytes and writes the 32-byte digest. Returns 32 or −1. |
| `verify_schnorr` | `(msg32_ptr, pk32_ptr, sig64_ptr) -> i32` | 25,000 | BIP-340 verification of a 64-byte signature over a 32-byte message with an x-only key. Returns 1 if valid, else 0. |

A contract that needs authorisation MUST check it itself. It can use `alkane_sender` (§6.5), which ties the call to a Dogecoin key, or have the caller sign a domain-separated message and call `verify_schnorr`. A call without a verified sender is anonymous.

### 7.5 Host ledger

See §8 for the data model. Amounts are passed as two `i64` halves, `amount = (u64)lo | ((u64)hi << 64)`. Account buffers MUST be 1–32 bytes, or the call fails with the error value.

| Import | Signature | Fuel | Behavior |
| --- | --- | --- | --- |
| `ledger_get` | `(token_b: i64, token_tx: i64, acct_ptr, acct_len, out_ptr) -> i32` | 3,000 | Writes the 16-byte LE balance and returns 16, or −1 |
| `ledger_mint` | `(token_b, token_tx, to_ptr, to_len, lo: i64, hi: i64) -> i32` | 3,000 | Returns 0 unless `myself == token` and amount > 0. Adds to the balance, saturating, and returns 1. |
| `ledger_transfer` | `(token_b, token_tx, from_ptr, from_len, to_ptr, to_len, lo: i64, hi: i64) -> i32` | 3,000 | Returns 0 unless `myself == token`, amount > 0, and `from` balance ≥ amount. Otherwise returns 1. If `from == to` it stages nothing (the balance is unchanged); else it stages `from_balance - amount` and `to_balance.saturating_add(amount)`. |
| `parcel_send` | `(token_b: i64, token_tx: i64, vout: i32, lo: i64, hi: i64) -> i32` | 3,000 | Top-level only. Debits this contract's 12-byte account of `token` and pushes that token onto `vout`. Returns 1, or 0 when the balance is short, the id is invalid, or `vout` is negative. The indexer drops a vout that does not exist or is an `OP_RETURN`. |

### 7.6 Nested calls

| Import | Signature | Behavior |
| --- | --- | --- |
| `staticcall` | `(tgt_b: i64, tgt_tx: i64, cd_ptr, cd_len, out_ptr, out_max, fuel: i64) -> i32` | Runs the target. Its writes are discarded. |
| `call` | same | Runs the target. On success, its staged writes become part of the caller's staged state. |

Rules for both:

- Depth: a top-level call is depth 0. A nested call from depth ≥ 8 returns −1.
- The base charge is 10,000 fuel, and running short is fatal. After it, the child gets `max(1, min(remaining, fuel))`, and the fuel the child uses is deducted from the caller.
- Calldata is the `min(cd_len, 16384)` bytes at `cd_ptr`. They are passed raw, not re-encoded.
- Child context: `myself` = target, `caller` = the calling contract, `alkane_block` and `alkane_time` inherited, `alkane_tx` = 0, `alkane_value` = 0, `incoming` empty.
- The child sees everything staged so far in the top-level call: ledger writes, and storage writes for every contract (including its own, from earlier nested calls). Below that it reads state as of the start of the call (§6.1). The target must be visible under §5.4.
- If the target does not exist, or the child fails, the nested call returns −1 and the child has no effect: every storage and ledger write it (and anything it called) staged is undone, restoring the exact staged state from before the call, and its logs are dropped. The fuel it used is still charged.
- On success it writes `min(len, out_max)` bytes of the child's return data to `out_ptr` and returns that count. If that write is out of bounds, the nested call returns −1 and the child has no effect, exactly as if it had failed. Only after a successful copy does a `call` keep the child's writes and logs. The caller frame's pending return data is replaced by the child's, until the caller sets its own.
- Storage writes are staged per contract: a child's writes always belong to the child's own id, and the caller's to the caller's. On a successful `call` the caller adopts the child's staged state; after a `staticcall`, a failed child, or a failed return-data copy, the child's writes are discarded. *(Informative: the reference shares one staged state across the call tree and keeps an undo journal per nested frame, so a nested call costs no copy of the parent's writes.)* Each frame has its own 512-distinct-key write cap (§6.4). Everything staged commits only if the top-level call succeeds (§6.3).

## 8. Host ledger

The host ledger is one global map:

```
key   = token AlkaneId (12 bytes) ‖ account (1–32 bytes)
value = balance, u128 little-endian (16 bytes)
```

- A zero balance is the same as an absent key. Indexers SHOULD delete zero entries.
- Only contract `T` can mint or transfer balances under token `T`. Contracts can read any balance.
- **Account bytes are opaque.** The protocol does not tie them to Dogecoin addresses, keys or UTXOs. A token contract defines what an account is, and MUST enforce who can move it. A token whose `transfer` takes `from` from calldata without an authorisation check lets anyone move anyone's balance.
- *(Informative)* The reference token template (`dalkanes-token-v1`) uses the 20-byte verified sender (§6.5) as the account, so an account is a Dogecoin P2PKH address and only its key can spend it. Accounts are passed in calldata as two cells, bytes 0–15 as a u128 and bytes 16–19 as a u32, both little-endian.

## 9. Receipts

A receipt is recorded for every call whose target exists (§5.4), keyed by txid. Its fields are in [schemas/call-receipt.schema.json](schemas/call-receipt.schema.json): `txid`, `height`, `target`, `ok`, `fuel_used`, `return_hex`, `error`, `logs`.

`ok`, `fuel_used` and `return_hex` are consensus-relevant. Two indexers MUST agree on them. `error` strings and `logs` are diagnostic and MAY differ in wording.

## 10. Invalid and no-op messages

Dalkanes has no cenotaphs for DOGE. A malformed `0xD1` message does not move DOGE. An output parcel is different: spending an output that holds one, without a valid version `0x02` message, burns that parcel (§16).

| Situation | Result |
| --- | --- |
| No `0xD1` output, or wrong version byte | Not a call |
| Cellpack fails §5.2 | No effect, no receipt |
| Target has no code | No effect, no receipt |
| Below activation height | No effect, no receipt |
| Instantiation error, trap, out of fuel, non-zero status, fatal host error | Receipt with `ok: false`, no state change |
| Block fuel budget exhausted (§6.2) | Receipt with `ok: false`, `fuel_used: 0`, not executed, no state change |
| Deploy that fails §4.2 | Ordinary inscription, no contract |

The Dogecoin transaction itself is always valid or invalid by Dogecoin's own rules. DOGE moves as the transaction says, whatever happens to the Dalkanes message.

## 11. Reorgs

- Dalkanes state SHOULD be fully determined by the active chain plus the pinned replay profile.
- When a block is disconnected, an indexer MUST restore the state to exactly what it was before that block was applied. That means removing code and metadata deployed in the block, removing its receipts, and restoring every storage and ledger entry it changed, including deleting entries it created. A storage key holding an empty value is present, not absent: it MUST be restored as present and empty, and a key that was absent MUST be deleted. *(Informative: the reference records the keys that were absent before the block separately from their prior values. Undo records written by reference builds before v0.3 lack that list and fall back to treating an empty prior value as absent.)* Ledger entries are never stored as zero (§8), so for them an empty prior value means absent.
- A block's Dalkanes effects MUST be committed atomically with the indexer's record of having processed that block.

*(Informative)* Dogecoin targets a block about every 60 seconds under merged-mined AuxPoW. Applications SHOULD choose confirmation policies appropriate to reorg risk; this spec does not establish a settlement guarantee.

## 12. Limits (summary)

| Limit | Value |
| --- | --- |
| Code size after inflation | 4 B – 512 KiB |
| Cellpack inputs | ≤ 256 (≤ 78 bytes total for default relay) |
| `MAX_FUEL` per top-level call | 5,000,000 |
| `BLOCK_FUEL_BUDGET` per block | 100,000,000 |
| Distinct storage writes per frame | ≤ 512 |
| Storage key / value | 256 B / 4,096 B |
| Return data | 16,384 B |
| Log entry | 256 B |
| `sha256` input | 65,536 B |
| Nested-call depth | 8 |
| Nested-call calldata | 16,384 B |
| Ledger account | 1–32 B |

Host fuel: storage op 1,000 + 1 per byte, `sha256` 2,000, `verify_schnorr` 25,000, `alkane_sender` 1,000, ledger op 3,000, nested-call base 10,000.

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
| Host for messages | Protostones inside a Runestone (protorunes, protocol tag `1`) | Standalone `OP_RETURN` with `0xD1` | Ðunes (`0xD0`) has no protostone slot. An unknown even tag burns the token inputs. A call on its own byte cannot be parsed as a dunestone. |
| Deploy carrier | Gzipped WASM in a Taproot witness envelope, plus a `[1,0]` / `[3,n]` cellpack | Doginals inscription (P2SH `scriptSig`) | No Taproot or witness on Dogecoin. Doginals is the established data carrier. |
| Contract ids | `[2, n]` by sequence, `[4, n]` reserved, `[5,n]` / `[6,n]` clone | `block:tx` of the deploy | Simple and Runes-style. Factory and clone ids are not supported. |
| Message size | Bitcoin `OP_RETURN`, much larger since Core 30 | ≤ 80-byte payload (78-byte cellpack) by default relay | Dogecoin Core policy |
| Assets | Protorune balances bound to UTXOs, with edicts, pointer and refund pointer | Version `0x02` parcels bound to outputs, plus the host ledger while a contract holds coins (§16). Not Ðunes. | Own marker and own rules, same UTXO idea. A dunestone has no protostone tag, so the parcel is a `0xD1` message. |
| Caller identity | Context with incoming parcels, plus the full transaction and block (`__load_transaction`, `__load_block`) | `alkane_sender`: the P2PKH key that signed input 0 with `SIGHASH_ALL`; contracts can also verify Schnorr signatures | A signature and key do not fit in a 78-byte cellpack, so the transaction's own signature is the authorisation |
| Runtime | `wasmi` fuel inside the METASHREW WASM indexer | `wasmi` 1.1.0 (pinned) fuel inside a native indexer | Same metering idea, no separate METASHREW process |
| Fuel budget | 100M per block, split by vsize, 90k minimum per message | 5M per call; 100M per block, first come first served in tx order, no per-message minimum (§6.2) | Same block ceiling, simpler allocation |
| Contract ABI | `__execute`, `__request_context` / `__load_context`, `__request_storage` / `__load_storage`, `__call` / `__staticcall` / `__delegatecall`, `__returndatacopy`, … | `__dalk_execute(ptr, len)`, plus the `env` imports in §7 | Smaller ABI. ALKANES contracts must be ported. |
| Genesis contracts | DIESEL at `[2,0]` | No hard-coded genesis installation found. Templates are ordinary deploys. | No equivalent bootstrap implementation |
| Activation | Block 880,000 | Mainnet block 6,466,500 (spec constant, §2); testnet not set | |

## 15. Reserved and future work *(informative)*

- A minimum fuel per message, or a size-weighted split of the block budget (§6.2).
- A per-transaction caller context (inputs and outputs) for contracts.
- Factory and clone deploys, and deterministic reserved ids.
- Module validation at deploy, and a float-free instruction subset.
- Publishing the testnet activation height (§2).

## 16. Output parcels (version `0x02`)

Version `0x01` remains a contract call and does not move output balances. Version `0x02` is a parcel message. It is its own `OP_RETURN` payload, not a tag inside a dunestone. Ðunes keep their own rules. An unknown even tag in a dunestone still burns that dune's inputs.

The payload after `0xD1` is:

1. Version byte `0x02`.
2. Pointer, LEB128. `u32::MAX` means there is no pointer.
3. Edict count, LEB128, at most 16.
4. Each edict: token block (u64), token tx (u32), amount (u128), output (u32), each LEB128. Amount `0` means the rest of that token.
5. `1` if a cellpack call follows, otherwise `0`. The cellpack is §5.2.

An indexer gathers every parcel on the inputs. With no `0x02` message, those amounts are burned and the outputs receive none. Edicts run in order. Output `u32::MAX - 1` deposits that amount into the call in this message instead of a vout. Any other output that is missing or is an `OP_RETURN` burns that edict. The pointer receives whatever edicts did not take. A missing or unusable pointer burns the remainder.

A deposit is credited to the contract's host-ledger sheet only when the call succeeds. The account bytes are the 12-byte id of the called contract. The call sees those amounts through `incoming_count` / `incoming_get`. If the call fails, or there is no call, the deposit goes to the pointer when that output can hold it, and otherwise burns.

`env.parcel_mint(vout, amount_lo, amount_hi)` on a successful top-level call creates `amount` units of the called alkane on that output. The indexer ignores a vout that does not exist or is an `OP_RETURN`. The reference template `dalkanes-utxo-token-v1` exposes this as opcode `77` with cells `(77, vout, amount)`.

`env.parcel_withdraw` does the same for units of the called alkane already on the contract's own account. `env.parcel_send` does it for any token that account holds, which is how a pool pays the other leg of a swap.

Spending an output that holds a parcel without a valid `0x02` message burns it, including when the transaction carries only a version `0x01` call.

## 17. Fair-launch tokens *(informative)*

A fair-launch token is a contract whose bytecode is the canonical build of a name, a symbol, a cap, and a mint size. The indexer labels it only when rebuilding those parameters produces the same code hash. A file that copies the header and changes the rules does not match.

The rules baked into that build: no premine, one mint per verified sender, mint size fixed, cap a multiple of that size. Opcode `77` takes the output index only. Views `99`–`103` return name, symbol, minted, cap, and mint size. Units are created with `parcel_mint` on that output.

`POST /api/alkanes/launch/build` accepts those four parameters and returns the deploy body. It does not accept bytecode.

## 18. The Pack *(informative)*

Howl, Ash, and Vigil are three canonical builds. An indexer labels a deploy only when its bytecode hash matches that build. A patched copy is a different contract.

| | Howl | Ash | Vigil |
| --- | --- | --- | --- |
| Supply | 2,048, minted into the contract on the first claim | 10,000 | 1,440 |
| Claim | Opcode `77`, once per sender. Size is 16, 8, 4, 2, then 1, cutting every 1,440 blocks from the first claim | Opcode `77`. One coin per 1,000,000 koinu burned on the carrier (`alkane_value`), at most 100, once per sender | Opcode `77`, one coin, once per sender |
| What a Ðune cannot do | The supply is born inside the program. A den (opcode `78`) holds a deposit for 1,440 blocks. Rise (opcode `79`) returns it, plus 1 from the treasury when any remain | The mint amount is the DOGE the call destroys. That DOGE is not paid to anyone | After the first claim, the gate is open only for the first 20 blocks of each 1,440-block cycle |

`GET /api/alkanes/howl/build`, `/ash/build`, and `/vigil/build` return those deploy bodies. They do not accept bytecode.

## 19. Pool *(informative)*

A pool is one deploy and one pair. The bytecode hash is the label. A patched copy is a different contract.

Bitcoin Alkanes price a swap inside the call, and the protostone carries the alkanes being sold. The amounts here are the edicts. The cellpack is only the opcode. An 80-byte payload has no room for a reserve list, and it does not need one.

| Opcode | Cellpack | Edicts |
| --- | --- | --- |
| `1` init | the two token ids | none |
| `3` add | the output that receives LP | both legs, deposited into the call |
| `2` swap | minimum out, and the output that receives the other token | the token being sold |
| `4` remove | the output that receives both legs | the LP parcel |

The fee is 30 basis points and stays in the reserves. The first add locks 1,000 LP in the supply and does not mint them. Later LP is `min(amount0 * supply / reserve0, amount1 * supply / reserve1)`. A swap pays `reserve_out * (amount_in * 997 / 1000) / (reserve_in + amount_in * 997 / 1000)`. Amounts must fit in an unsigned 63-bit integer.

The reserves are the contract's ledger. No key can spend them. The pointer on the parcel message is the caller's own output, so a failed add, swap, or remove returns the deposit. LP moves with an ordinary edict after it is minted.

`GET /api/alkanes/pool/build` returns that deploy body. It does not accept bytecode. Selling a Ðalkane for DOGE is not this pool. That sale is a PSDT: the seller signs the parcel input and the DOGE output they want, and the buyer adds a `0x02` pointer so the parcel follows the output they receive.

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
| `GET /api/alkanes/ledger/{block}/{tx}/{account}` | Host-ledger balance (contract sheet, or an account template) |
| `GET /api/alkanes/output/{txid}/{vout}` | Parcel balances on one output |
| `POST /api/alkanes/simulate` | Dry run against committed state. Accepts `value`, `incoming` and `sender_hex` (20-byte hex) overrides, and returns per-contract `contract_writes`. |
| `POST /api/alkanes/build-call` | Builds a form-A `OP_RETURN` script |
| `GET /api/alkanes/templates[/{name}]` | Reference contract templates |
| `POST /api/alkanes/launch/build` | Canonical fair-launch deploy body from name, symbol, cap, and mint size |

## Appendix B. Worked example

Call contract `100:1` with fuel 100,000 and one input, opcode `0`:

```
cellpack  = 64 01 a0 8d 06 01 00
payload   = d1 01 64 01 a0 8d 06 01 00
script    = 6a 09 d1 01 64 01 a0 8d 06 01 00
calldata  = 00000000000000000000000000000000   (one u128 LE)
```

More cases are in [vectors/](vectors/).
