# Dalkanes specification

**Version:** 0.4.1 (draft)
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

A Dalkane token a wallet holds sits on a Dogecoin output (§16). Spending that output with no `0xD1` parcel message moves the balance to the first output that is not an `OP_RETURN`; a malformed or doubled `0xD1` message burns it. The host ledger (§8) is the contract's own sheet: coins move there when a parcel deposits them into a call, and a call can mint or withdraw them back onto an output. An older template may still keep an account balance in that ledger; spending a Dogecoin output does not move those account balances.

## 2. Activation

- Indexers MUST NOT process Dalkanes deploys or calls in blocks below the **activation height** for their network.
- On mainnet and testnet the activation height is a constant of this spec. Indexers MUST NOT let an operator setting move it; the reference ignores its activation environment variable on these networks.
- Regtest defaults to height `0` and MAY be overridden for development.

| Network | Activation height | Notes |
| --- | --- | --- |
| Mainnet | **6,466,500** | Chosen 2026-11-20 just above the tip at the time (6,466,091). Blocks ≥ 6,466,500 are processed; 6,466,499 and below are not. |
| Testnet | not set | Disabled (the reference uses `u32::MAX`). A future version will publish it. |
| Regtest | `0` | Overridable for development only. |

Mainnet has no Dalkanes state below 6,466,500; an indexer starts empty at that block. A deploy inscribed below the activation height is an ordinary inscription forever: it never becomes a contract, and a later call to its `block:tx` has no target (§5.4). An indexer database that processed earlier blocks under an operator setting MUST drop that state before it serves mainnet.

## 3. Identifiers

An **AlkaneId** is the pair `(block, tx)`:

| Field | Type | Meaning |
| --- | --- | --- |
| `block` | u64 | Height of the block containing the deploy transaction |
| `tx` | u32 | Index of the deploy transaction within that block (coinbase = 0) |

- **Display form:** `"{block}:{tx}"` in decimal, for example `5123456:7`.
- **Key form (12 bytes):** `block` as 8-byte big-endian, then `tx` as 4-byte big-endian. Storage and ledger keys use this form.
- Top-level calls use `0:0` as the caller sentinel. No reserved genesis id is installed. A print pull assigns a new id (§20).

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

- Opcodes `0x00`–`0x4b` push that many bytes. `OP_0` (`0x00`) is a push of zero bytes and counts as a push. `OP_PUSHDATA1` (`0x4c`) and `OP_PUSHDATA2` (`0x4d`) push the length they declare.
- Parsing stops, successfully, at the first other opcode, including `OP_PUSHDATA4` (`0x4e`), `OP_1NEGATE` and `OP_1`–`OP_16`. Later bytes are ignored.
- A push that runs past the end of the script makes the output not a call.
- Form A is exactly one push and form C exactly two. `OP_RETURN <D1 01 ‖ cellpack> OP_0` has two pushes, so it is none of the forms: a `0xD1` output that does not decode. Vectors: [vectors/parcel.json](vectors/parcel.json) `messages`.

A **`0xD1` output** is an `OP_RETURN` output whose first data push is the single byte `D1` or begins with `D1`, including a first push that runs past the end of the script. A transaction carries at most one Dalkanes message:

- **No `0xD1` output:** no call. Input parcels move to the first non-`OP_RETURN` output (§16).
- **Exactly one, and it decodes** as a version `0x01` call (forms A–C above, cellpack §5.2) or a version `0x02` message (§16.1): that message applies.
- **Exactly one that does not decode** (a bad cellpack, a truncated push, an unknown version byte, a version `0x02` body that breaks §16.1), **or more than one `0xD1` output:** the transaction is ambiguous. No call runs, there is no receipt, and every input parcel burns.

The output is classified first, by its first push alone; decoding comes second. So a second `0xD1` output makes the transaction ambiguous even when it would not decode, and an `OP_RETURN` whose first push does not start with `D1` (another protocol's carrier, or `D1` in a later push) is not a `0xD1` output at all.

Coinbase transactions are processed like any other. A coinbase may carry a call; it has no verified sender (§6.5) because input 0 spends nothing. A coinbase output can receive a parcel; spending it waits for coinbase maturity like any coinbase output.

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
  - If `R` = 0, the call is not executed. Its receipt is `ok: false`, `fuel_used: 0`, with no state change (error `block fuel budget exhausted`). A pull that §20.1 refuses is decided before this test. That receipt is the §20.1 refusal even when `R` is 0, and `R` is unchanged. The budget test applies to a call that would otherwise run, including a pull the gate allowed.
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

`fuel_used` = granted fuel minus remaining fuel, at every exit once fuel has been granted: guest return, trap, and also instantiation or start-function failure, a missing `memory` or `__dalk_execute` export, and a failed calldata write. A start function's consumption is therefore always reported. Only a module that fails to decode (before instantiation) reports `fuel_used: 0`. An out-of-fuel trap is a trap: remaining fuel is 0, so `fuel_used` is the grant, not 0. A nested child's `fuel_used` is computed the same way and is deducted from its caller (§7.6).

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
| `alkane_caller_*` | `0:0`, except a call that births a print (§20): the program it is born from |
| `alkane_value` | Koinu value of the carrier output, see below |
| `alkane_sender` | Verified sender, see below |
| `incoming_*` | Empty list |

**Attached value.** `alkane_value` is the value, in koinu, of the carrier output itself: the `0xD1` `OP_RETURN` output that holds the call (§5.1). That DOGE is provably burned. No other output counts. Most calls carry 0.

> **Security note.** A contract never receives or controls DOGE. `alkane_value` proves the caller burned that much with the call, nothing more; any payout a contract makes is a host-ledger balance (§8), never DOGE. Dogecoin Core relays `OP_RETURN` outputs with a non-zero value under default policy, but wallets may refuse to build them.

**Verified sender.** If input 0 of the call transaction is a standard P2PKH spend, meaning its `scriptSig` is exactly two pushes `<sig> <pubkey>` with a 33-byte compressed or 65-byte uncompressed key, and the signature verifies under the legacy sighash for input 0 with a P2PKH script code for that key, and the signature's hash type has base type `SIGHASH_ALL` (`0x01`, optionally with `ANYONECANPAY` `0x80`), then the sender is `HASH160(pubkey)`, the 20-byte payload of that Dogecoin address. Otherwise there is no sender. `SIGHASH_ALL` commits to every output, including the carrier, so only the key holder can make a call that names them. Signature checking follows Dogecoin's (lax DER, low-S normalised before verification). The script code is exactly `76 a9 14 ‖ HASH160(pubkey) ‖ 88 ac`. Implementations MUST NOT remove `OP_CODESEPARATOR` (`0xab`) bytes from inside its 20-byte push; a pubkey hash can contain `0xab`, and deleting it changes the sighash and loses the sender. Vector: [vectors/sender.json](vectors/sender.json), a mainnet Howl claim whose hash contains `0xab`. A nested call never has a sender.

**Incoming parcels.** A version `0x01` call sees an empty list. A version `0x02` call sees the deposits routed into it (§16). Simulations may supply a list either way.

### 6.6 Determinism requirements

- The interpreter MUST be deterministic and MUST NOT expose clocks, randomness, network or filesystem access.
- Contracts SHOULD NOT use floating-point instructions. This version does not forbid them. A future version may reject modules that use them.
- Execution MUST NOT depend on a contract's code hash, with one exception: whether a call to a print program births a print (§20.1). That test compares the SHA-256 of the deployed wasm with the hashes published in §24.

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
| `ledger_transfer` | `(token_b, token_tx, from_ptr, from_len, to_ptr, to_len, lo: i64, hi: i64) -> i32` | 3,000 | Returns 0 unless `myself == token`, amount > 0, `from` balance ≥ amount, and, when `from` is 12 bytes long, `from` is the executing contract's own id (a token may debit its own sheet but never another contract's). Otherwise returns 1. If `from == to` it stages nothing (the balance is unchanged); else it stages `from_balance - amount` and `to_balance.saturating_add(amount)`. |
| `parcel_mint` | `(vout: i32, lo: i64, hi: i64) -> i32` | 3,000 | Top-level only. Creates `amount` units of the executing contract's own id on `vout`. Returns 1, or 0 when the amount is 0, `vout` is negative, or the call is nested. If `vout` does not exist or is an `OP_RETURN`, the whole call fails when it returns (§16). |
| `parcel_withdraw` | `(vout: i32, lo: i64, hi: i64) -> i32` | 3,000 | Top-level only. Debits this contract's 12-byte account of its own id and pushes those units onto `vout`. Returns 1, or 0 when the balance is short, the amount is 0, `vout` is negative, or the call is nested. If `vout` does not exist or is an `OP_RETURN`, the whole call fails when it returns (§16). |
| `parcel_send` | `(token_b: i64, token_tx: i64, vout: i32, lo: i64, hi: i64) -> i32` | 3,000 | Top-level only. Debits this contract's 12-byte account of `token` and pushes that token onto `vout`. Returns 1, or 0 when the balance is short, the id is invalid, the amount is 0, `vout` is negative, or the call is nested. If `vout` does not exist or is an `OP_RETURN`, the whole call fails when it returns (§16). |

For all three `parcel_*` imports the fuel is charged first, so a call that returns 0 still pays it, and running short is fatal (§6.4). A debit made by `parcel_withdraw` or `parcel_send` is a staged ledger write: it commits only if the call succeeds and passes the landing check (§16). Several `parcel_*` calls may name the same output; the amounts add.

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
- A 12-byte account is a contract's sheet: what was deposited into that contract (§16). `T` can debit a 12-byte account only when it is `T`'s own id. So a token cannot pull its units back out of a pool or any other contract that holds them. This matches Bitcoin Alkanes, where a contract moves what was deposited into it, not every holder's balance. Shorter and longer accounts are the token's own to define.
- **Account bytes are opaque.** The protocol does not tie them to Dogecoin addresses, keys or UTXOs. A token contract defines what an account is, and MUST enforce who can move it. A token whose `transfer` takes `from` from calldata without an authorisation check lets anyone move anyone's balance.
- *(Informative)* The reference token template (`dalkanes-token-v1`) uses the 20-byte verified sender (§6.5) as the account, so an account is a Dogecoin P2PKH address and only its key can spend it. Accounts are passed in calldata as two cells, bytes 0–15 as a u128 and bytes 16–19 as a u32, both little-endian.

## 9. Receipts

A receipt is recorded for every call whose target exists (§5.4), keyed by txid. Its fields are in [schemas/call-receipt.schema.json](schemas/call-receipt.schema.json): `txid`, `height`, `target`, `ok`, `fuel_used`, `return_hex`, `error`, `logs`, and `born` for a print pull (§20). A version `0x02` message with no call, or whose target has no code, gets no receipt.

`ok`, `fuel_used`, `return_hex` and `born` are consensus-relevant. Two indexers MUST agree on them. `error` strings and `logs` are diagnostic and MAY differ in wording.

*(Informative)* The reference also stores `tx_index`, `time`, `version`, `inputs`, `sender`, `value`, `deposits` and `outgoing` on each receipt, so explorers can show who called, what they burned, and what landed where without re-reading the transaction. These are derived from the transaction and the outcome; they are not consensus and older receipts omit them.

## 10. Invalid and no-op messages

Dalkanes has no cenotaphs for DOGE. A malformed `0xD1` message does not move DOGE. An output parcel is different: a malformed or doubled `0xD1` message burns every parcel on the inputs (§5.1, §16).

| Situation | Result |
| --- | --- |
| No `0xD1` output | Not a call; input parcels move to the first non-`OP_RETURN` output |
| One `0xD1` output that does not decode (wrong version byte, bad cellpack, truncated), or two or more `0xD1` outputs | Not a call, no receipt; input parcels burn |
| Cellpack fails §5.2 | No effect, no receipt; input parcels burn (a `0xD1` output that does not decode) |
| Target has no code | No effect, no receipt |
| Below activation height | No effect, no receipt |
| Instantiation error, trap, out of fuel, non-zero status, fatal host error | Receipt with `ok: false`, no state change |
| Block fuel budget exhausted (§6.2) | Receipt with `ok: false`, `fuel_used: 0`, not executed, no state change |
| Call returns `0` but names a parcel output that is missing or an `OP_RETURN` (§16) | Receipt with `ok: false`, no state change, deposits refunded |
| Version `0x02` message with no call | No receipt; edicts and pointer route the parcels; a deposit edict goes to the pointer (§16.3) |
| Version `0x02` call whose target has no code | No receipt; parcels routed, deposits refunded to the pointer (§16.3) |
| Version `0x02` call that fails | Receipt with `ok: false`; parcels routed, deposits refunded to the pointer (§16.3) |
| Pointer or edict names a missing or `OP_RETURN` output | That amount burns; the rest of the message applies |
| Deploy that fails §4.2 | Ordinary inscription, no contract |

The Dogecoin transaction itself is always valid or invalid by Dogecoin's own rules. DOGE moves as the transaction says, whatever happens to the Dalkanes message.

## 11. Reorgs

- Dalkanes state SHOULD be fully determined by the active chain plus the pinned replay profile.
- When a block is disconnected, an indexer MUST restore the state to exactly what it was before that block was applied. That means removing code and metadata deployed in the block, removing its receipts, and restoring every storage and ledger entry it changed, including deleting entries it created. A storage key holding an empty value is present, not absent: it MUST be restored as present and empty, and a key that was absent MUST be deleted. *(Informative: the reference records the keys that were absent before the block separately from their prior values. Undo records written by reference builds before v0.3 lack that list and fall back to treating an empty prior value as absent.)* Ledger entries are never stored as zero (§8), so for them an empty prior value means absent.
- Parcels are state too: a disconnected block's spent outputs get their parcels back, the outputs it created lose theirs, and print ids it bore (§20) are removed with their code and metadata. Any derived index an indexer keeps from that state (per-address history, a listing of print slots) MUST be restored with the block, the same as the storage and ledger keys it was built from.
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
| Edicts per parcel message | ≤ 16 (about 8 within the default relay limit) |
| Parcel amount per token per output | 2^128 − 1 (saturating) |
| Pointer / edict output sentinels | `u32::MAX` = no pointer, `u32::MAX − 1` = deposit into the call |

Host fuel: storage op 1,000 + 1 per byte, `sha256` 2,000, `verify_schnorr` 25,000, `alkane_sender` 1,000, ledger op 3,000, nested-call base 10,000.

## 13. Conventions *(informative)*

These come from the ALKANES standard contracts. They make explorers and wallets work across contracts:

| Opcode (`input[0]`) | Meaning |
| --- | --- |
| `0` | initialize (once) |
| `77` | mint |
| `99` / `100` / `101` | name / symbol / total supply (views) |
| `102`–`104` | cap / minted / value per mint (free-mint views) |
| `1000` | data / attributes. On Bitcoin this returns the bytes stored at initialize. A contract already inscribed on Dogecoin names its picture with a project card (§22) |

Fair launch (§17) and Kibble follow that numbering. Howl, Ash, Quiet, Ember, Vigil, Collar, and Bone list theirs in §18.

The `__dalk_execute` status codes other than `0` are contract-defined. A receipt records a non-zero status as `error: "status N"`. The canonical builds (§17–§21) use these:

| Status | Fair launch (§17) | Pack and beside it (§18) | Pool (§19) | Proof, Shibkane (§20, §21) |
| --- | --- | --- | --- | --- |
| 1 | — | — | empty calldata | empty calldata |
| 2 | bad calldata | bad calldata | a vout or slippage cell out of range | output index not 0–255 |
| 3 | no verified sender | no verified sender | — | no verified sender |
| 4 | could not place the coins on that output | could not place the coins on that output | — | could not place the print |
| 5 | this sender already minted | this sender already claimed | deposit does not match the op | already pulled |
| 6 | cap reached | supply is gone | amounts refused (too small, empty pool, past 63 bits) | — |
| 7 | storage read failed | this block already claimed | result below the caller's minimum | — |
| 8 | — | a deposit was attached; send a bare call | the pool could not pay out | — |
| 9 | unknown opcode | — | unknown opcode | unknown opcode |
| 10 / 11 | — | still locked / nothing is locked (den, Bone) | — | — |
| 12 / 13 | — | ledger move failed / burn short of the claim price | — | — |

The receipt errors `block fuel budget exhausted` (§6.2) and `parcel sent to a missing or OP_RETURN output` (§16.3) come from the indexer, not the contract.

## 14. Relationship to Bitcoin ALKANES *(informative)*

| Topic | ALKANES (Bitcoin) | Dalkanes (Dogecoin) | Why |
| --- | --- | --- | --- |
| Host for messages | Protostones inside a Runestone (protorunes, protocol tag `1`) | Standalone `OP_RETURN` with `0xD1` | Ðunes (`0xD0`) has no protostone slot. An unknown even tag burns the token inputs. A call on its own byte cannot be parsed as a dunestone. |
| Deploy carrier | Gzipped WASM in a Taproot witness envelope, plus a `[1,0]` / `[3,n]` cellpack | Doginals inscription (P2SH `scriptSig`) | No Taproot or witness on Dogecoin. Doginals is the established data carrier. |
| Contract ids | `[2, n]` by sequence, `[4, n]` reserved, `[5,n]` / `[6,n]` clone | `block:tx` of a deploy. A print pull also uses `block:tx`, of the pull, and runs the inscribed program (§20). | A create transaction cannot carry WASM: Segwit is disabled, and the relayed data carrier is 83 bytes. The clone that fits is a new id whose code is an inscription already on chain. |
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
- Sequence ids `[2, n]` and reserved ids `[4, n]`. A print clone is specified in §20. Bitcoin's factory path that carries new WASM in the create transaction does not fit this chain.
- Module validation at deploy, and a float-free instruction subset.
- Publishing the testnet activation height (§2).

## 16. Output parcels (version `0x02`)

Version `0x01` remains a contract call and is not a parcel message. Version `0x02` is a parcel message. It is its own `OP_RETURN` payload, not a tag inside a dunestone. Ðunes keep their own rules. An unknown even tag in a dunestone still burns that dune's inputs.

A **parcel** is an amount of one Dalkane bound to one transaction output. An output can hold parcels of several tokens; per token the amounts add, saturating at 2^128 − 1. An `OP_RETURN` output (one whose `scriptPubKey` begins with `0x6a`) never holds a parcel. Every other output can, including an empty or non-standard script. A parcel moves only when its output is spent.

### 16.1 Message format

The message is the `0xD1` output of §5.1 in one of two push forms:

| Form | Pushes after `OP_RETURN` | Body |
| --- | --- | --- |
| A′ (canonical) | one push `D1 02 ‖ rest`, then any further pushes, which are ignored | push[0][1..] |
| C′ | push `D1`, push `02 ‖ rest`, then any further pushes, which are ignored | push[1] |

Encoders MUST emit form A′. Unlike call form A, form A′ tolerates trailing pushes. The version byte must begin the push that carries the rest: `D1`, `02`, `rest` as three pushes does not decode. Push parsing is §5.1.

The body is the version byte and then these LEB128 fields, each read with the varint rules of §5.2:

1. Version byte `0x02`.
2. **Pointer.** `u32::MAX` (4,294,967,295) means no pointer. `u32::MAX − 1` (4,294,967,294) means the call's deposit (§16.3). Any other value is an output index. A value above `u32::MAX` does not decode.
3. **Edict count**, at most 16. A larger count does not decode.
4. **Each edict:** token block (≤ 2^64 − 1), token tx (≤ 2^32 − 1), amount (u128), output (≤ 2^32 − 1). A value out of range does not decode. Amount `0` means the rest of that token. Output `u32::MAX − 1` deposits into the call.
5. **Has call:** `0` or `1`. Any other value does not decode. If `1`, a cellpack (§5.2) follows and must decode.

Every field must be present. Bytes after the last field (after the cellpack, or after a has-call of `0`) are ignored. A body that does not decode makes the transaction ambiguous (§5.1): no call runs and every input parcel burns.

At the default 80-byte relay limit a message carries roughly eight edicts at current block heights; sixteen fit only in a larger, non-relayed carrier.

Vectors: [vectors/parcel.json](vectors/parcel.json) (`messages`, `scripts`).

### 16.2 Routing

An indexer gathers every parcel on the inputs, in input order, merging amounts of the same token, and removes them from the spent outputs. It then assigns them by the transaction's message (§5.1):

- **No parcel message** (no `0xD1` output, or a version `0x01` call): everything goes to the first output that is not an `OP_RETURN`. If every output is an `OP_RETURN`, it burns. This is the Runes rule: an ordinary wallet can consolidate without destroying the asset. The cost is that a plain payment from a parcel output hands the parcel to that output, often the payee. Wallets SHOULD guard parcel outputs as they guard inscription postage.
- **Ambiguous** (§5.1): everything burns.
- **A version `0x02` message:**
  1. Edicts run in order. An edict for a token the inputs do not carry, or one already used up by earlier edicts, does nothing. Otherwise it takes `amount`, or what is left if `amount` is 0 or larger than what is left.
  2. What an edict takes goes to its output. Output `u32::MAX − 1` deposits it into the call (§16.3). An output that does not exist or is an `OP_RETURN` (any `OP_RETURN`, not only the carrier) burns it.
  3. Whatever the edicts did not take goes to the pointer, by the same rule. No pointer burns it.

There is no "split across all outputs" edict. Runes treats an edict output equal to the number of outputs as an even split; here that index is a missing output, and the amount burns.

Vectors: [vectors/parcel.json](vectors/parcel.json) (`routing`).

### 16.3 Deposits and the call

Deposits are the amounts routed to `u32::MAX − 1`, by edicts or by the pointer, merged per token.

- A deposit is credited to the called contract's host-ledger sheet (§8: account = the contract's 12-byte id) only when the call succeeds and passes the landing check below. The call sees the deposits through `incoming_count` / `incoming_get`, one entry per token.
- If there is no call, the target has no code (§5.4), the call fails, or a print birth is refused (§20), the deposit goes to the pointer when the pointer names an output that can hold it, and otherwise burns. A pointer of `u32::MAX − 1`, or no pointer, cannot hold it, so in those cases a refund burns.
- When the call runs, `alkane_value` is the koinu on this `0xD1` output (§6.5).

Routing happens before the call executes, in the same transaction. Parcels a successful call creates are added afterwards.

`env.parcel_mint(vout, amount_lo, amount_hi)` on a successful top-level call creates `amount` units of the called alkane on that output. The reference template `dalkanes-utxo-token-v1` exposes this as opcode `77` with cells `(77, vout, amount)`. `env.parcel_withdraw` does the same for units of the called alkane already on the contract's own account. `env.parcel_send` does it for any token that account holds, which is how a pool pays the other leg of a swap.

**Landing check.** A contract cannot see the transaction's outputs. So when a call returns `0`, the indexer checks every output that `parcel_mint`, `parcel_withdraw` or `parcel_send` named. If any of them does not exist or is an `OP_RETURN`, the call fails: receipt `ok: false` (error `parcel sent to a missing or OP_RETURN output`), with the fuel it used and its return data, no state change, and any deposit refunded as above. Units are never silently dropped, and a one-per-sender mint is not spent on an output that cannot hold it.

Spending an output that holds a parcel in a transaction with only a version `0x01` call moves the parcel to the first non-`OP_RETURN` output, and the call still runs. Such a call cannot deposit the parcel; that takes a version `0x02` message.

### 16.4 Sending part of a balance *(informative)*

There is no transfer inscription and no account balance to debit. A wallet's balance is the sum of the parcels on the outputs it controls, and a send is one ordinary transaction that spends some of those outputs and says where each amount goes. To send 4 of a token from a coin holding 16:

| | Inputs | Outputs |
| --- | --- | --- |
| 0 | the coin holding 16 | `OP_RETURN` parcel message: pointer `2`, edict `(token, 4, 1)` |
| 1 | DOGE for the fee, holding no parcels | recipient's address, dust value: receives 4 |
| 2 | | sender's own address, dust value: receives the other 12 by the pointer |
| 3 | | sender's DOGE change |

The edict sends 4 to output 1. The pointer sends everything the edicts did not take, here the other 12, to output 2. Any other token on the spent coins also follows the pointer, so it stays with the sender. Vector `send_four_keep_the_rest` in [vectors/parcel.json](vectors/parcel.json) is this message for token `6474082:35`: `6a0cd1020201e2928b0323040100`.

| | DRC-20 | Dalkanes |
| --- | --- | --- |
| Balance lives in | the indexer's account table | parcels on outputs |
| Send part of it | inscribe a `transfer` for the amount, then send that inscription | one transaction: an edict for the amount, the pointer for the change |
| Transactions per send | 2 (inscribe, then send) | 1 |
| Several recipients | one transfer inscription each | several edicts in one message |
| Split a coin (for example, to list part of it) | inscribe a transfer for the part | edicts to two of your own outputs |

Wallets SHOULD:

- pick fee inputs that hold no parcels, and check with the indexer before signing (a fee input's parcels follow the pointer, or the first real output when there is no message);
- always set the pointer to an output the sender controls, never "no pointer", unless a burn is the intent;
- keep each parcel output above the dust limit, like inscription postage;
- refuse to broadcast when the parcel message is not the output the wallet built, or when a parcel input was dropped while signing.

## 17. Fair-launch tokens *(informative)*

A fair-launch token is a contract whose bytecode is the canonical build of a name, a symbol, a cap, and a mint size. The indexer labels it only when rebuilding those parameters produces the same code hash. A file that copies the header and changes the rules does not match.

The rules baked into that build: no premine, one mint per verified sender address, mint size fixed, cap a multiple of that size. Opcode `77` takes the output index only. Views `99`–`103` return name, symbol, minted, cap, and mint size. Units are created with `parcel_mint` on that output.

`POST /api/alkanes/launch/build` accepts those four parameters and returns the deploy body. It does not accept bytecode.

## 18. The Pack *(informative)*

Howl, Ash, and Vigil are three canonical builds. An indexer labels a deploy only when its bytecode hash matches that build. A patched copy is a different contract.

| | Howl | Ash | Vigil |
| --- | --- | --- | --- |
| Supply | 2,048, minted into the contract on the first claim | 1,000 | 1,440 |
| Claim | Opcode `77`, once per sender and once per block. Size is 16, 8, 4, 2, then 1, cutting every 1,440 blocks from the first claim. The call burns 0.01 DOGE per coin (`alkane_value`) | Opcode `77`. One coin per 1,000,000 koinu burned on the carrier, at most 10, once per sender, one mint per block | Opcode `77`, one coin, once per sender, one claim per block |
| What a Ðune cannot do | The supply is born inside the program. A den (opcode `78`) holds a deposit for 1,440 blocks. Rise (opcode `79`) returns it, plus 1 from the treasury when any remain | The mint amount is the DOGE the call destroys. That DOGE is not paid to anyone | After the first claim, the gate is open only for the first 20 blocks of each 1,440-block cycle, and only one claim lands in each of those blocks |

One claim per block is the monopoly limit that does not charge a second price for showing up. A new wallet is still a new claim. It has to wait for its own block. Howl's burn and Ember's rising burn make a pile of wallets destroy DOGE, and that DOGE is not paid to anyone.

Quiet, Ember, Collar, Bone, and Kibble are canonical builds beside the Pack. Quiet's opcode `77` mints `min(16, blocks since the previous claim)`, or 1 on the first claim, cap 1,024. Ember's opcode `77` mints one coin whose burn is `(minted + 1) × 0.01` DOGE, cap 256. Collar's opcode `77` takes exactly one Howl, one Ash, and one Vigil, keeps them, and mints one Collar. The three ids are baked into that bytecode. Bone's opcode `78` locks a Howl deposit for 1,440 blocks and opcode `79` returns it and mints one Bone. Howl's id is baked into that bytecode.

Kibble is the flagship fungible. Bitcoin Alkanes installs DIESEL at reserved id `[2,0]`, and that mint is a race for position in the block. Dogecoin has no reserved id (§14), so Kibble is an ordinary inscription of this build. Opcode `77` mints 10,000 onto the named output, once per verified sender and once per block, until the cap of 432,000,000 (43,200 claims). A missed block stays open for a later claim, so filling the cap takes at least 43,200 blocks and longer when blocks are missed. The call takes no deposit and burns no DOGE. Views `99`–`103` return the name `Kibble`, the symbol `KIBBLE`, minted, the cap, and the mint size.

Opcode `99` is the name and `100` is the symbol on every build in this section. Howl's `101` is the treasury still in the contract: 0 until the first claim mints 2,048 onto the contract, then what remains. `102` is the era since that claim, 0 before it and through the first 1,440 blocks. `103` is the claim size for that era: 16, then 8, 4, 2, then 1. `104` is the coins this sender has in a den, and `105` is the block height when that den unlocks. Both are 0 when there is no verified sender, or nothing is locked. `106` is 1 when this sender has already claimed, and 0 otherwise. Ash's `101`–`103` are minted, the cap 1,000, and 1,000,000 koinu per coin. Quiet's `101`–`102` are minted and the cap 1,024. Ember's `101`–`103` are minted, the cap 256, and the koinu the next mint burns, `(minted + 1) × 1,000,000`. Vigil's `101`–`103` are minted, the cap 1,440, and 1 while the claim window is open. Collar's `101` and Bone's `101` are minted.

`GET /api/alkanes/howl/build`, `/ash/build`, `/vigil/build`, `/quiet/build`, `/ember/build`, and `/kibble/build` return those deploy bodies. Collar and Bone take the baked ids as query parameters. `POST /api/alkanes/preview` runs one of those builds before it is inscribed. None of these routes accept bytecode.

## 19. Pool *(informative)*

A pool is one deploy and one pair. The two token ids are part of the bytecode, built like a fair-launch token from its parameters, so there is no initialisation call anyone could front-run. The legs are in canonical order, `leg0 < leg1` comparing `block` then `tx`, so a pair has exactly one canonical build. The indexer labels a deploy `pool`, with its `pair`, only when rebuilding that pair reproduces the code hash. A patched copy is a different contract.

Bitcoin Alkanes price a swap inside the call, and the protostone carries the alkanes being sold. The amounts here are the edicts. The cellpack carries only the opcode, the output, and slippage limits. An 80-byte payload has no room for a reserve list, and it does not need one.

| Opcode | Cellpack | Edicts |
| --- | --- | --- |
| `3` add | `(3, vout, min_lp)`: the output that receives LP, and the least LP to accept | both legs, deposited into the call |
| `2` swap | `(2, min_out, vout)`: the least to receive, and the output that receives the other leg | one leg, deposited |
| `4` remove | `(4, vout, min0, min1)`: the output that receives both legs, and the least of each | this pool's own LP, deposited |

Views: `99` name, `100` symbol, `101` LP supply, `102` leg0 reserve, `103` leg1 reserve, `104` the pair as four little-endian u64s (`leg0.block`, `leg0.tx`, `leg1.block`, `leg1.tx`). A missing slippage cell reads as `0` (no limit). `vout` must be at most 255. Views and unknown opcodes take no deposit: a call that deposits into one fails, so the deposit goes back to the pointer (§16).

The fee is 30 basis points and stays in the reserves. The first add mints `floor(sqrt(amount0 * amount1)) - 1000` LP and locks 1,000 in the supply; it fails unless the root exceeds 1,000. Later LP is `min(amount0 * supply / reserve0, amount1 * supply / reserve1)`; the excess of the over-supplied leg stays in the reserves, so a wallet SHOULD deposit at the current ratio. A swap pays `reserve_out * f / (reserve_in + f)` with `f = amount_in * 997 / 1000`. Remove pays `reserve * lp / supply` of each leg and accepts only a deposit of the pool's own id; the 1,000 locked LP can never be removed. All divisions floor. Every amount and reserve must fit in an unsigned 63-bit integer; products are taken in 128 bits, and a result that would not fit fails the call.

The reserves are the contract's ledger. No key can spend them. The pointer on the parcel message is the caller's own output, so a failed add, swap, or remove returns the deposit. LP moves with an ordinary edict after it is minted.

> **Security note.** No token can debit the pool's sheet (§7.5, §8), so a leg's contract cannot pull its units back out of the reserves. It can still mint without limit and sell into the pool. Wallets SHOULD show whether each leg is a canonical build (§17, §18) and warn otherwise.

`GET /api/alkanes/pool/build?leg0={block:tx}&leg1={block:tx}` returns that deploy body, with the legs put in canonical order. It does not accept bytecode. Selling a Ðalkane for DOGE is not this pool. That sale is a PSDT: the seller signs the parcel input and the DOGE output they want, and the buyer adds a `0x02` pointer so the parcel follows the output they receive.

## 20. Proof

§20.1 is normative and applies to the three print programs: Proof (this section), Shibkane (§21) and Doge Orbital (§23). The rest of §20, §21 and §23 describes the canonical programs; their behaviour comes from their bytecode, not from extra rules.

One inscription of the canonical bytecode is the program. The indexer labels that deploy `proof` only when the SHA-256 of its wasm equals the Proof hash in §24, which is what `GET /api/alkanes/proof/build` returns. A patched copy is a different program. The route does not accept bytecode.

### 20.1 Print births

A deployed contract is a **print program** when the SHA-256 of its wasm equals the Proof, Shibkane or Doge Orbital hash in §24. Nothing else makes it one: not a label, a route, a project card (§22) or the inscription's content type. A contract born by §20.1 is a **print**, and a print is never a print program.

A **pull** is a call (§5, version `0x01` or `0x02`) whose target is a print program and whose first input is `77`. For every pull an indexer MUST do the following.

1. **Refuse before execution** when any of these holds. Let `count` be the program's key `0x10` read as a little-endian u64 (absent is 0).
   - `count` is at least the collection cap: 420 for each of the three programs.
   - This block's height is below 6,475,700 (that is, `height < 6,475,700`), and the program's key `0x14`, read the same way, equals this block's height. From height 6,475,700 on (`height >= 6,475,700`), this check is not made. Several pulls of one program may succeed in that block, in transaction order. Blocks below 6,475,700 are left as indexed. There is no replay.
   - The call has a verified sender (§6.5) and the program has key `0x15` followed by that 20-byte sender.
   - This transaction already created a contract id (a deploy, §4). One transaction has one id.

   A refused pull runs no code. Its receipt is `ok: false`, `fuel_used` 0, empty return data and no `born`. It does not use the block fuel budget (§6.2), writes nothing, and does not use up the block or the address. A deposit is handled as for a failed call (§16.3). The error text is informative; the reference uses `the collection is full`, `this block already pulled`, `this address already pulled` and `this transaction already deploys a contract`.
2. **Otherwise run the program as the print.** The print's id is this transaction's `block:tx`. The call executes the program's code with `myself` set to that id, the caller set to the program (§6.5), the print's own empty storage, and the call's inputs, fuel grant, attached value, verified sender and deposits. Deposits are credited to the print's sheet while it runs (§16.3).
3. **On success** (the call returns `0` and passes the landing check, §16.3), the print becomes a contract with the program's code, and the receipt's `born` is the print id (§9). In addition to the call's own writes, the indexer MUST write, with `index` = `count`:
   - on the program, key `0x10` = `count + 1` as a little-endian u64;
   - on the program, key `0x11` followed by `index` as a little-endian u32 = the print id, `block` then `tx`, each a little-endian u64 (16 bytes);
   - on the program, key `0x14` = this block's height as a little-endian u64;
   - on the program, when there is a verified sender, key `0x15` followed by the 20 sender bytes = the single byte `0x01`;
   - on the print, key `0x13` = `index` as a little-endian u64.

   The canonical programs do not write these keys themselves. Running as the print, they write the print's keys `0x01`, `0x02` and `0x12` (the parent id, read from the caller).
4. **On failure** no id is created and none of the keys in step 3 are written, so the block and the address are not used up.
5. A call whose target is a print, including opcode `77`, is an ordinary call (§5). The canonical programs fail a second `77` on a print.

A reorg undoes a birth with the rest of its block (§11).

"One pull per verified sender" means one per address. It limits addresses, not people: a new address can pull again.

Opcode `77` on that program, with an output index, births a print. The print's id is the pull transaction's own `block:tx`. The indexer runs the inscribed program as that id: the pull's storage and the one minted parcel belong to the print, and a second `77` on the same print fails. A later `77` on the program births another print, until the collection gate below. Two prints do not add. A transaction that deploys a contract cannot also be a print, because one transaction has one id.

The pull requires a verified sender. It stores the block height, the transaction index, the block time, and the 20-byte sender, and it mints one unit of the print onto that output. The program is not inscribed again.

A Proof collection births 420 prints. One pull per verified sender address (§20.1). Before height 6,475,700, also one pull per block. The indexer refuses the birth before execution when key `0x10` is already 420, when the height is below 6,475,700 (`height < 6,475,700`) and key `0x14` is this block's height, or when key `0x15` followed by the 20-byte sender is present. The receipt is `ok: false` and `fuel_used` is 0, with `the collection is full`, `this block already pulled`, or `this address already pulled`, and no new id. The block fuel budget is unchanged. A refused pull does not consume the block or the address. On a successful pull the indexer writes `0x14` as the height, u64 little-endian, and key `0x15` followed by the 20-byte sender, whose value is the single byte `0x01`. Opcode `106` returns 420. Shibkane uses this same gate, with the cap in §21.

Opcode `200` returns an SVG drawn only from that stored record. Opcode `201` returns the palette, the form, the cut when the form is a flower or a lattice, the plate, the caption, and the block, index, and time, from the same SHA-256. Before the pull, `200` returns a sheet marked unpulled and `201` says so. Views `99`–`102` are the name, the symbol, how many units this id has minted, and the cap of this id, which is 1.

Bitcoin's Orbital draft (not Alkanes core) puts membership on the parent. Opcode `77` there calls a template id and the parent records the new supply-1 child. The child returns one metadata document, and each attribute has a stable id beside its label. The specified picture is data the contract draws. Dogecoin has no template id and no witness, so the inscribed program is the template and the picture stays opcode `200`. The birth also records the print, because the program runs as the new id and cannot write the parent's storage.

The birth runs the program as the new id with the program as its caller (§6.5), which is how the program learns its parent.

On the parent, key `0x10` is the count as a little-endian u64. The first print is index 0. Key `0x11` followed by the index as a little-endian u32 holds the child id: block then tx, each a little-endian u64. On the print, key `0x12` is the parent id in that same sixteen bytes, written by the program from the caller, and key `0x13` is this print's index as a little-endian u64. The indexer writes `0x10`, the slot, and `0x13` when the pull succeeds. A second indexer that runs the program and skips those three keys will not see the collection.

Opcode `103` returns the count, or 0 when `0x10` is absent. Opcode `104` takes an index and returns that sixteen-byte id, or status 6 when the slot is empty. Opcode `105` returns the bytes `dalkane-orbital/1`. Opcode `202` returns one text document. A pulled print includes the standards line, `collection <block>:<tx>`, `index <n>`, then `palette`, `form`, `cut` when the form is a flower or a lattice, `plate`, `caption`, and the stored block, transaction index, and time. An unpulled sheet returns the standards line and says it is unpulled. `GET /api/alkanes/{block}/{tx}` includes `orbital` for these two programs: the standards tag, the count and the first 48 prints on a parent, and the parent id and index on a print. Opcode `104` is how a reader past 48 asks for the rest.

The picture is a sacred-geometry print. It uses integer arithmetic. The program does not roll a die. It hashes the stored block height, transaction index, time, and sender, and reads that digest. The circles sit on a six-fold lattice: the distance between two centers is the radius, so each circle passes through its neighbors.

| Byte | Below | Result |
| --- | --- | --- |
| 0 | 110, 160, 196, 224, 244 | Palette: Vellum, Lapis, Temple, Moon, Night, then Gilt |
| 1 | 64, 112, 160, 200, 232 | Form: Flower, Merkaba, Cube, Vesica, Seal, then Lattice |
| 2 | — | How many rings, and which vesica |
| 3 | — | Which circle, triangle, or star is drawn in the second ink |
| 5 | 190, 220, 244 | Plate: Plain, Crops, Frame, then Flood |
| 6 | 24 | A line is set under the plate. Otherwise the sheet has none |
| 7 | low three bits | Caption: `much wow`, `such sacred`, `very hash`, `so rare`, `wow`, `to the moon`, `much proof`, `such coin` |
| 8 | low two bits | Cut of a flower or lattice: Full, Seed, Ring, then Petal |

A later view reads the stored record. It does not read the clock again.

### Showing a print *(informative)*

A print is not a Doginal. The inscription is the program, and its content is WASM. A client that paints that file paints no picture.

A wallet reads holdings with `POST /api/alkanes/outputs`. `GET /api/alkanes/markets` includes `clone_of`: the inscribed program's id when this id was born by a pull, and empty on the factory. When `clone_of` is set and `kind` is `proof`, `shibkane`, or `doge`, the holding is one collectible. Show it with inscriptions, tagged as a Dalkane so it is not read as a Doginal, and leave the one unit out of the fungible token list. The factory stays with the tokens. Pack tokens use a project card (§22) or a picture the site ships with that build. They do not use opcode `200`.

The picture is opcode `200` on the print's own id. `POST /api/alkanes/simulate` with `inputs: [200]` returns `return_hex`. Decode those bytes as UTF-8. The document is an SVG. A client SHOULD refuse one that contains `script`, `javascript:`, or `foreignObject`. The same call on a receipt's `born` id is the thumbnail for that birth on a chart point and an activity row. Opcode `202` is the text beside the picture, not a second image.

Opcode `77` on a print, rather than on the inscribed program, does not birth another id. Shibkane (§21) uses this same birth. A call receipt includes `born` set to the new id.

## 21. Shibkanes

A Shibkane is the dog drawing that was the first Proof picture, kept as its own canonical bytecode. It is a print program (§20.1) when the SHA-256 of its wasm equals the Shibkane hash in §24, which is what `GET /api/alkanes/shibkane/build` returns. Opcode `77` births a Shibkane the same way it births a Proof, including the collection keys in §20 and the same refusal before execution. A Shibkane collection births 420 prints, under the §20.1 gate: the cap, one pull per verified sender, and one pull per block only before height 6,475,700. The receipts are the same as §20. On a successful pull the indexer writes `0x14` and `0x15` as §20 describes. The cap of each print is 1. Opcode `106` returns 420. Opcodes `99`–`102`, `103`–`105`, `200`, `201`, and `202` are the same shape. The document's attributes are `palette`, `pose`, `look`, `mark`, `gear`, `plate`, `ears`, and `caption`. The SVG is a dog. A Shibkane is not a Proof, and the two do not merge.

The picture uses integer arithmetic. The program hashes the stored block height, transaction index, time, and sender, and reads that digest. Ears are part of the drawing and of the document, so a client that lists attributes does not drop a difference the picture shows.

| Byte | Below | Result |
| --- | --- | --- |
| 0 | 140, 180, 210, 230, 248 | Palette: Paper, Blueprint, Newsprint, Solar, Void, then Gold |
| 1 | 102, 178, 224 | Pose: Front, Sit, Stand, then Poster |
| 2 | 120, 180, 220, 244 | Look: Calm, Smile, Tongue, Wide, then Laser |
| 3 | 160, 210, 240 | Mark: Plain, Spot, Ear, then Belly. Ear here is a patch, not the silhouette |
| 4 | 190, 215, 234, 248 | Gear: None, Collar, Glasses, Hat, then Crown |
| 5 | 200, 230, 246 | Plate: Plain, Crops, Sun, then Flood |
| 6 | 16 | A caption is set. Otherwise the sheet has none |
| 7 | low two bits | Caption: `wow`, `much proof`, `such coin`, `very hash` |
| 8 | low two bits | Ears: Point, Tall, Wide, then Flop |

## 22. Project card

Bitcoin Alkanes do not compile a logo into the program. The stock free-mint reads witness payload 0 during initialize, stores it, and opcode `1000` returns those bytes. Indexers call that view and publish the result as the logo. Dogecoin has no witness, and an `OP_RETURN` cannot hold a PNG. The picture is its own Doginals inscription. The card is a second inscription that points the contract at that picture.

This does not change the program, the contract id, or the activation height. Contracts already inscribed keep their ids. A new program may also implement opcode `1000` so a view returns an inscription id. When a project card is present, indexers use the card.

### 22.1 Carrier

A project card is a Doginals inscription whose content type is `application/json` (a leading match, compared case-insensitively). The body is at most 2,048 bytes of JSON:

| Field | Rule |
| --- | --- |
| `dalkane` | Required. `block:tx` of an inscribed contract. Not a print (`clone_of` is empty). |
| `image` | Required. Inscription id `txid` + `i` + index, 64 hex digits. That inscription is already indexed and its content type begins with `image/`. |
| `name` | Optional. At most 64 characters. |
| `description` | Optional. At most 280 characters. |
| `links` | Optional. At most 4 objects `{ "label", "url" }`. The label is at most 32 characters. The url is `http://` or `https://`, at most 200 characters, with no whitespace. |

The schema is [schemas/project-card.schema.json](schemas/project-card.schema.json).

### 22.2 Who may write it

The reveal redeem starts with the signer's pubkey and `OP_CHECKSIGVERIFY`. Core has already checked that signature. The indexer takes `hash160` of that pubkey.

That hash must equal the deployer recorded for `dalkane`. The deployer is the same pubkey hash from the transaction that revealed the contract. A print has no deployer. A contract indexed before this field existed is filled at startup by reading that reveal from the shadow block index, then from Core for a height the shadow does not have.

The same key may inscribe a later card. The later card replaces the stored one. A different key's card is ignored. If the picture inscription is not indexed yet, the card is ignored: inscribe the picture, wait until it is in an earlier block, then inscribe the card.

### 22.3 What an indexer stores

The card is not a field of the program and not a call. It lives beside the contract, keyed by the alkane id. A reorg restores the previous card. An alkanes replay does not delete it.

`GET /api/alkanes/markets` and `GET /api/alkanes/{block}/{tx}` include `card` (the stored object, or null) and `deployer` (the P2PKH address of the reveal key, or null). Clients show `card.image` through the inscription content route. A missing card may fall back to a picture the site shipped with the pack.

---

## 23. Doge Orbital

Doge Orbital is the site mark, kept as its own canonical bytecode. It is a print program (§20.1) when the SHA-256 of its wasm equals the Doge Orbital hash in §24, which is what `GET /api/alkanes/doge/build` returns. The build embeds the site's `doge.svg` with CRLF line ends; the published hash is of that build, whatever line ends a checkout uses. Opcode `77` births a print the same way it births a Proof, including the collection keys in §20 and the same refusal. A Doge Orbital collection births 420 prints, under the §20.1 gate: the cap, one pull per verified sender, and one pull per block only before height 6,475,700. The cap of each print is 1. Opcode `106` returns 420. Opcode `200` returns the face. The paths are the mark. The pull chooses a palette, and each coat color is that palette's tint of the original channel. Classic multiplies by 255, so the face is the mark as it ships. The darkest ink stays. Opcode `201` returns the palette. Opcode `202` returns the standards line, the collection, the index, and `palette`. A Doge Orbital is not a Shibkane and not a Proof.

| Byte | Below | Palette |
| --- | --- | --- |
| 0 | 70, 120, 170, 210, 240 | Classic, Night, Sakura, Sea, Ember, then Ghost |

## 24. Canonical code hashes

Each row is the SHA-256 of a canonical build's wasm (the deploy payload after the `\0ALK` header, §4.2). The reference recognises these builds by comparing against this table, not by rebuilding, so a compiler update cannot change what it recognises. Its tests rebuild each one and check that the bytes still hash to this table.

Only the print programs change state (§20.1). For every other row the hash only sets a label (`canon` in the API) and has no consensus effect.

| Build | Label | SHA-256 of the wasm | Bytes | On mainnet | Effect |
| --- | --- | --- | --- | --- | --- |
| Proof (§20) | `proof` | `7c9b14ca1babaf1ee229f26a49b89e8d54e7ad86af6adc228492e273ec9e1694` | 8,728 | `6475242:19` | Print births (§20.1) |
| Shibkane (§21) | `shibkane` | `b69f0aa9b8cd66335d1c08fa6c86d3af7d6b0def30c8d8688eff6ebefe9c71a4` | 7,412 | not inscribed | Print births (§20.1) |
| Doge Orbital (§23) | `doge` | `aeafccfee33779532d930b86bfbd2fbb0e5519db072dc26e29888e3c4040a4c4` | 61,486 | not inscribed | Print births (§20.1) |
| Howl (§18) | `howl` | `5b9fa2476e0e669aa3126cbdb4c172c29a0685e5bc0e831411e96d7836a5a916` | 2,433 | `6474082:35` | Label |
| Ash (§18) | `ash` | `0d48882f4c3a5a564e6a0db55d04daa5ef7c60b765e7cbe5965a4324133999f6` | 1,101 | `6474109:50` | Label |
| Vigil (§18) | `vigil` | `9fa39d1c852c1113f25fbae64cb87ca628f1e151586e3c11db88c51d15548148` | 1,065 | `6474109:48` | Label |
| Quiet (§18) | `quiet` | `6a0d1a554907a38c1505b25829aeaa6dc600bb69cbf76c793ee1019ca5494f78` | 1,043 | `6474180:51` | Label |
| Ember (§18) | `ember` | `9f0b242421ddac33991e66e6fca4242b6a356c602d7e61c40baec65b55664194` | 1,012 | `6474188:29` | Label |
| Kibble (§18) | `kibble` | `ee4c6e7ba6096c1ed5908485135a107f793f8295c2baa0c6e4734a8c9e16a3dd` | 987 | `6474606:65` | Label |
| Collar (§18), Howl `6474082:35`, Ash `6474109:50`, Vigil `6474109:48` baked in | `collar` | `66c3610d07e8f2fee6db975f52fe41c74bae826847cbc446146ae42334b315c0` | 1,230 | `6474195:85` | Label |
| Bone (§18), Howl `6474082:35` baked in | `bone` | `cbb467a319b130e53724de61aba4eb32f2d33ebe2d28b4fcf3a182f79f8d808e` | 1,132 | `6474201:39` | Label |

Builds with parameters have no single hash: a fair-launch token (§17), a pool (§19), and a Collar or Bone with other ids baked in. The reference labels those by rebuilding the parameters it reads from the header and comparing hashes. They are labels only. The reference pins its WAT compiler (`wat` 1.255.0) so those rebuilds stay stable.

A change to any build in the first three rows is a new program with a new hash. An indexer MUST NOT treat a superseded or patched Proof, Shibkane or Doge Orbital as a print program unless a later version of this table lists it. The same wasm then gets no `proof`, `shibkane` or `doge` label, and §20.1 does not apply: no cap, no one-per-block refusal, and no one-per-address refusal.

The live Proof `6475242:19` is the Proof row. These hashes are not in the table. An indexer that gates them refuses a pull the reference accepts:

| Prefix | What it is |
| --- | --- |
| `43a9ebb3` | An earlier Proof body |
| `3cba3028` | A Shibkane body from 2026-11-26 |
| `9e9bfc04` | A Shibkane body from 2026-11-26 |

`7c9b14ca` is the current Proof row, not an earlier one. The Shibkane row is the capped build (opcode `106` returns 420). The Doge Orbital row is the build that embeds `doge.svg` with CRLF line ends. [vectors/canonical-builds.json](vectors/canonical-builds.json) is this table. The build routes in Appendix A return the same bytes. dogex and doginals.lol are not the public copy of these hashes.

## Appendix A. Indexer HTTP API *(informative)*

The reference indexer serves these routes. They are not part of consensus:

| Route | Purpose |
| --- | --- |
| `GET /api/alkanes` | Recent deploys |
| `GET /api/alkanes/{block}/{tx}` | Metadata, code hash and recent calls |
| `GET /api/alkanes/{block}/{tx}/storage` | Storage peek |
| `GET /api/alkanes/{block}/{tx}/inspect` | ABI-aware read methods, for known templates |
| `GET /api/alkanes/calls[?target=block:tx]`, `GET /api/alkanes/calls/{txid}` | Receipts, newest first (by height and transaction index, not txid) |
| `GET /api/alkanes/events?limit&before=height:tx` | Every transaction that touched Dalkanes, newest first: the message kind, parcels spent, routed, burned and deposited, parcels a call issued, the receipt, and the owner address of each output |
| `GET /api/alkanes/{block}/{tx}/activity?limit&before=height:tx` | The same rows for one token: claims, mints, transfers, plain spends that moved it, burns and failed calls |
| `GET /api/alkanes/{block}/{tx}/history` | Per-block series (calls, successful calls, units issued, burned, moved, deposited, DOGE burned on carriers) and totals, for charts |
| `GET /api/alkanes/ledger/{block}/{tx}/{account}` | Host-ledger balance (contract sheet, or an account template) |
| `GET /api/alkanes/output/{txid}/{vout}` | Parcel balances on one output |
| `POST /api/alkanes/outputs` | Parcel balances on up to 500 outputs in one call (`{"outpoints": ["txid:vout", …]}`); returns only outputs that hold something. A wallet reads its holdings this way. |
| `GET /api/alkanes/{block}/{tx}/holders` | Addresses holding the token on their outputs, largest first, with holder count, output count and circulating units. A holder is the address an output pays. |
| `GET /api/alkanes/markets` | Recent deploys with kind, label, recent calls, holder count and circulating units, plus name, symbol, cap and minted for canonical builds (§17–§19). `card` and `deployer` are the project card (§22). `clone_of` is the inscribed program when this id is a print, and empty on the factory (§20) |
| `POST /api/alkanes/simulate` | Dry run against committed state. Accepts `value`, `fuel`, `incoming` and a sender override. Credits `incoming` to the contract's sheet first, as a real deposit would; for a pull (§20.1), that sheet is the would-be print's, not the program's. Rejects malformed cells rather than dropping them. Returns per-contract `contract_writes` and the `outgoing` parcels a real call would place. Fuel and a pull are specified in the paragraph after this table. |
| `GET /api/alkanes/pool/build?leg0=&leg1=` | Canonical pool deploy body for a pair (§19) |
| `GET /api/alkanes/proof/build` | Canonical Proof deploy body (§20) |
| `GET /api/alkanes/shibkane/build` | Canonical Shibkane deploy body (§21) |
| `GET /api/alkanes/doge/build` | Canonical Doge Orbital deploy body (§23) |
| `POST /api/alkanes/build-call` | Builds a form-A `OP_RETURN` script |
| `GET /api/alkanes/templates[/{name}]` | Reference contract templates |
| `POST /api/alkanes/launch/build` | Canonical fair-launch deploy body from name, symbol, cap, and mint size |

A dry run of a pull applies the same pre-run refusals as a block (§20.1), then runs the program as the new id with the program as its caller and the print's storage empty. The response includes `born`. When the request does not set a height, `born` uses one past the last indexed height and transaction index 1. That id is a placeholder. The mined pull's id is its own `block:tx`. A dry run that answers `ok` for a block or an address the gate would refuse is wrong, and a wallet must not sign from it. A refused dry run has `ok: false`, `fuel_used` 0, and no `born`. This is not consensus. A block still applies §20.1 on its own.

Dry-run fuel follows §6.2: the grant is `max(1, min(requested, MAX_FUEL))`. If the request omits `fuel`, the grant is `MAX_FUEL`. A requested fuel of 0 therefore grants 1, not the cap. The dry run is a single call with that grant, as if it were first in a new block; it does not consume, and does not apply, the residual budget of a block still being indexed. A wallet SHOULD pass the same fuel it will put in the cellpack, or a dry run at the 5,000,000 cap can look successful for a call that will be mined with less.

The reference accepts `sender_hex` (20-byte hex). An implementation MAY also accept a Dogecoin P2PKH address as `sender`; both name the same 20-byte verified-sender payload (§6.5).

## Appendix B. Worked example

Call contract `100:1` with fuel 100,000 and one input, opcode `0`:

```
cellpack  = 64 01 a0 8d 06 01 00
payload   = d1 01 64 01 a0 8d 06 01 00
script    = 6a 09 d1 01 64 01 a0 8d 06 01 00
calldata  = 00000000000000000000000000000000   (one u128 LE)
```

More cases are in [vectors/](vectors/).
