# Changelog

All notable changes to VaultProof Agent Guard are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-07-17

### Added — Verifiable ProofRecords

The headline feature: every terminal guard decision can now be written to an
**append-only, hash-chained, ed25519-signed ledger** that any third party can
verify **offline, with zero trust in RF servers**.

- `src/keys.ts` — ed25519 operator-key management. `generateSigner()`,
  `loadOrCreateSigner(path)` (writes a `0600` private key + `.pub`),
  `signerFromPrivateKeyPem()`, `verifierFromPublicKeyPem()`,
  `keyIdFromPublicKey()` (stable key id = first 16 bytes of SHA-256 over the
  SPKI DER, hex). Uses **only** Node's built-in `crypto` — zero new dependencies.
- `src/proofrecord.ts` — the `vaultproof.proofrecord/v1` record schema,
  deterministic canonicalization (sorted-key JSON), content-hash and
  record-hash derivation, and `createProofRecord()`. Embeds a `PROTOCOL_REFERENCE`
  pointing at the published ARK series concept DOI (10.5281/zenodo.21398675).
- `src/ledger.ts` — `ProofLedger`, an append-only JSONL-backed hash chain that
  loads an existing file to continue the chain across restarts.
- `src/verify-ledger.ts` — `verifyLedger()` / `verifyLedgerWithPublicKey()`.
  Checks sequence position, prev-hash linkage, content-hash re-derivation,
  record-hash re-derivation, key-id match, and signature validity.
- `bin/vaultproof-verify.mjs` — standalone offline verifier CLI. Exit `0` = OK,
  `1` = tamper detected, `2` = usage error. Exposed as the `vaultproof-verify`
  bin and the `npm run verify` script.
- `tests/proofrecord.test.ts` — 13-case tamper-evidence suite (untampered OK,
  altered decision/amount/reason/calldata, delete/reorder/duplicate, forged
  signature, tamper-and-recompute-without-resign, wrong key, tampered genesis,
  and a full end-to-end guard run). **13/13 pass.**
- `PROOFRECORD.md` — full specification: trust model, v1 record format,
  canonicalization rules, verifier checks, quickstart, and honest limitations.

### Changed

- `src/guard.ts` — `GuardConfig` accepts an optional `signer` (+ `ledgerFile`,
  `policyVersion`). When a signer is present, `record()` appends a signed record
  to the ledger and attaches the `ProofRecord` to the `VerifyResult`. New getters
  `proofPublicKeyPem` and `proofRecords`. **Fully backward compatible** — with no
  signer, behavior is unchanged.
- `src/policy.ts` — exported `POLICY_VERSION` (`vaultproof.policy/1.0.0`).
- `README.md` — new "Verifiable ProofRecords" section; tier table reframed so the
  free/local vs hosted difference is the **trust anchor** (self-signed vs
  RF-anchored identity + transparency log), not the cryptography, which is
  identical in both tiers.
- `THREAT_MODEL.md` — item 8 rewritten: signed records prove integrity relative
  to the operator's key; key-to-identity binding is the hosted-tier value-add.
- `package.json` — `0.2.0` → `0.3.0`; added `bin`, `exports` for the new modules,
  and `test:proof` / `test:drain` / `verify` scripts. `npm test` now runs both
  suites (25 cases total).

### Notes

- Local tier = operator-sovereign signing (your key, your ledger, no RF
  involvement). Hosted tier = RF-anchored independent trust anchor + transparency
  log so a counterparty need not take the operator's word for identity.
- Operationalizes the published tamper-detection results from ARK-455 / ARK-455b.

## [0.2.0]

- Hosted gate integration, fail-closed HOLD behavior, Telegram HOLD channel.

## [0.1.2]

- Initial public reference implementation: pre-execution policy gate with
  drain-vector detection, allowlist, per-tx and daily spend caps, HOLD threshold,
  and the reproducible 12-case drain-attack suite.
