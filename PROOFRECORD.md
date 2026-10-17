# The Verifiable ProofRecord

> Every decision your agent's guard makes can produce a signed, hash-chained,
> **independently verifiable** attestation — provable by anyone holding the
> public key, with **zero trust in Remnant Fieldworks**.

This is the piece that makes VaultProof more than a spend-limit library. A
policy gate that only *you* can inspect is a log. A policy gate that a hostile
counterparty can verify *against you* is **evidence**. ProofRecords are
evidence.

The decision model attested here is the same one validated by the preregistered
ExecutionProof **ARK** experimental corpus — including the published
tamper-detection results (ARK-455 honest FAIL → ARK-455b PASS). This document is
the product embodiment of that research.

- Series concept DOI: **10.5281/zenodo.21398675**
- Tamper-detection experiments: **10.5281/zenodo.21418388** (ARK-455 v1.1), **10.5281/zenodo.21418404** (ARK-455b PASS)

---

## Trust model: operator-signed vs. RF-anchored

| | **Local / operator-signed (this repo)** | **Hosted / RF-anchored (Pro)** |
| --- | --- | --- |
| Signing key | **held by you**, generated locally | RF-anchored attestation key + transparency log |
| Records | ed25519-signed, hash-chained, independently verifiable | additionally counter-signed & timestamped by RF |
| Trust anchor | **your** published public key | RF's public, cross-org-verifiable anchor |
| Runs offline | ✅ | ❌ (calls hosted gate) |
| Third-party can verify | ✅ (they trust *your* key) | ✅ (they trust the *RF* anchor, not you) |

The open-source tier gives you **real, cryptographically verifiable** records
signed with **your own** key. The hosted tier adds an **independent trust
anchor** so a counterparty who does *not* trust you can still rely on the
record. Both use the identical record format defined below.

> This supersedes the earlier statement that signed ProofRecords were
> hosted-only. Operator-sovereign signing is now part of the open reference
> implementation; the hosted tier's distinct value is the **independent
> anchor**, not the signature itself.

---

## Record format (`vaultproof.proofrecord/v1`)

Each record is one line of JSON (JSON Lines / `.jsonl`). It has a signed **core**
plus a signature envelope.

### Signed core (covered by `contentHash`, and therefore by the signature)

| field | type | meaning |
| --- | --- | --- |
| `schema` | string | always `"vaultproof.proofrecord/v1"` |
| `seq` | number | 0-based position; strictly +1 per record |
| `id` | string | human-facing record id, e.g. `PR-AB12...` |
| `ts` | string | ISO-8601 UTC timestamp |
| `agentId` | string | the agent this decision was made for |
| `profile` | string | boundary profile name in force |
| `policyVersion` | string | version of the decision logic (`vaultproof.policy/1.0.0`) |
| `decision` | string | `ALLOW` / `HOLD` / `DENY` |
| `reason` | string | human-readable explanation |
| `action.action` | string | tx type (`token_transfer`, `approve`, …) |
| `action.to` | string | destination address/contract |
| `action.amountUsd` | number | resolved USD value (0 for non-value calls) |
| `action.chain` | string | chain id, e.g. `base-mainnet` |
| `action.calldataSha256` | string \| null | SHA-256 of calldata (privacy-preserving) or `null` |
| `prev` | string | `recordHash` of the previous record (`""` iff `seq === 0`) |
| `protocol` | object | reference to the published ExecutionProof corpus |

### Signature envelope

| field | type | meaning |
| --- | --- | --- |
| `contentHash` | string | `SHA-256(canonical(core))`, hex |
| `keyId` | string | first 16 bytes of `SHA-256(SPKI(pubkey))`, hex |
| `sig` | string | ed25519 signature over `contentHash` (base64) |
| `recordHash` | string | `SHA-256(contentHash + ":" + sig)`, hex — chained by the next record's `prev` |

### Canonicalization

`canonical(x)` is deterministic JSON: object keys sorted recursively, no
incidental whitespace. This guarantees byte-identical serialization — and hence
identical hashes — across machines and runtimes. See `canonicalize()` in
[`src/proofrecord.ts`](./src/proofrecord.ts).

---

## What a verifier checks

Given only the ledger file and the **public** key, an independent verifier
([`src/verify-ledger.ts`](./src/verify-ledger.ts)) checks, for every record:

1. **`seq` equals its position** — detects insertion / deletion / reorder.
2. **`prev` equals the previous record's `recordHash`** — chain integrity.
3. **`contentHash` re-derives from the core** — detects any altered field.
4. **`recordHash` re-derives from `contentHash + sig`** — envelope integrity.
5. **`keyId` matches the provided public key** (optionally pinned).
6. **`sig` verifies over `contentHash`** — detects forgery / wrong key.

Any single failure ⇒ **TAMPER DETECTED** and a non-zero exit code.

This maps directly to the ARK-455/455b tamper model: alter a field, delete a
record, reorder the chain, or forge a signature — all are caught, and a valid
original still verifies.

---

## Quickstart

### 1. Emit signed records from the guard

```ts
import { VaultProofGuard } from "vaultproof-agent-guard";
import { loadOrCreateSigner } from "vaultproof-agent-guard/keys";
import profile from "./profiles/conservative-trader.json";

const signer = loadOrCreateSigner("./operator.key"); // your key, your machine

const guard = new VaultProofGuard({
  agentId: "trading-agent-01",
  profile,
  localOnly: true,
  signer,                              // ← turns on verifiable ProofRecords
  ledgerFile: "./proof-ledger.jsonl",  // ← append-only chain on disk
});

const result = await guard.verify({
  action: "token_transfer",
  to: "0x...allowlisted".toLowerCase(),
  amountUsd: 85,
  chain: "base-mainnet",
});

console.log(result.proofRecord?.recordHash); // signed, chained attestation
```

Share `./operator.key.pub` (written automatically) with anyone who needs to
verify your records.

### 2. Verify independently (no VaultProof account, no network)

```bash
npx vaultproof-verify ./proof-ledger.jsonl ./operator.key.pub
# exit 0 = chain intact & all signatures valid
# exit 1 = TAMPER DETECTED
```

Or programmatically:

```ts
import { loadLedgerFile } from "vaultproof-agent-guard/ledger";
import { verifyLedgerWithPublicKey } from "vaultproof-agent-guard/verify-ledger";
import fs from "fs";

const records = loadLedgerFile("./proof-ledger.jsonl");
const pub = fs.readFileSync("./operator.key.pub", "utf8");
const { ok, summary } = verifyLedgerWithPublicKey(records, pub);
console.log(ok, summary);
```

---

## Reproduce the tamper-evidence suite

```bash
npm run test:proof   # 13/13 — captured verbatim in BENCHMARK.md
```

Every case constructs a real signed ledger, applies a real tampering operation
(alter / delete / reorder / duplicate / forge / wrong-key), and asserts the
verifier's actual verdict. No mocks of the crypto.

---

## Honest limitations

- **Operator-signed records prove integrity relative to *your* key**, not that
  the recorded inputs were themselves accurate. Garbage in, signed garbage out —
  see [THREAT_MODEL.md](./THREAT_MODEL.md).
- The key held on disk is only as safe as the machine holding it. Use an HSM /
  KMS-backed signer for anything serious (the `Signer` interface is pluggable).
- Independent *third-party* trust (a counterparty who doesn't trust you) is what
  the **hosted RF-anchored** tier adds; the local tier's anchor is your own key.
- This is an unaudited, pre-1.0 reference implementation.

---

Built by [Remnant Fieldworks Inc.](https://remnantfieldworks.com) • Powered by
[ExecutionProof](https://executionproof.io) • Verification Before Execution™
