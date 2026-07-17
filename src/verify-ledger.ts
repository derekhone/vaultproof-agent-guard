// vaultproof-agent-guard/src/verify-ledger.ts
//
// INDEPENDENT verifier for a ProofLedger.
//
// Given only (a) the JSONL ledger and (b) the operator's PUBLIC key, this
// re-derives every hash and checks every signature and chain link. It imports
// NO guard logic and needs NO network and NO trust in Remnant Fieldworks. That
// is the point: a ProofRecord is only worth anything if a hostile third party
// can verify it against you.
//
// Detects, per the ARK-455 / ARK-455b tamper model:
//   - any altered field            -> content-hash mismatch / signature failure
//   - a forged or wrong-key record -> signature failure
//   - a deleted or inserted record -> sequence gap / broken prev-chain
//   - reordered records            -> broken prev-chain

import {
  ProofRecord,
  computeContentHash,
  computeRecordHash,
  coreOf,
} from "./proofrecord.js";
import { GENESIS_PREV } from "./ledger.js";
import { Verifier, verifierFromPublicKeyPem } from "./keys.js";

export interface RecordFinding {
  index: number;
  id: string;
  ok: boolean;
  failures: string[];
}

export interface VerifyLedgerResult {
  ok: boolean;
  count: number;
  verifiedBy: string; // keyId of the public key used
  findings: RecordFinding[];
  summary: string;
}

/**
 * Verify an in-memory array of ProofRecords against a public-key Verifier.
 * `expectKeyId` (optional) pins the ledger to a specific key.
 */
export function verifyLedger(
  records: ProofRecord[],
  verifier: Verifier,
  expectKeyId?: string,
): VerifyLedgerResult {
  const findings: RecordFinding[] = [];
  let prevRecordHash = GENESIS_PREV;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const failures: string[] = [];

    // 1. Sequence must be exactly its position in the chain.
    if (rec.seq !== i) {
      failures.push(`seq ${rec.seq} != expected position ${i} (insert/delete/reorder)`);
    }

    // 2. prev must equal the previous record's recordHash (chain integrity).
    if (rec.prev !== prevRecordHash) {
      failures.push(
        `prev-hash break: expected ${prevRecordHash || "GENESIS"}, got ${rec.prev || "GENESIS"}`,
      );
    }

    // 3. contentHash must match a fresh hash of the core (no field tampering).
    const recomputedContent = computeContentHash(coreOf(rec));
    if (recomputedContent !== rec.contentHash) {
      failures.push("content-hash mismatch (a field was altered after signing)");
    }

    // 4. recordHash must match hash(contentHash + sig).
    const recomputedRecord = computeRecordHash(rec.contentHash, rec.sig);
    if (recomputedRecord !== rec.recordHash) {
      failures.push("record-hash mismatch (envelope altered)");
    }

    // 5. keyId pinning (optional).
    if (expectKeyId && rec.keyId !== expectKeyId) {
      failures.push(`keyId ${rec.keyId} != expected ${expectKeyId}`);
    }
    if (rec.keyId !== verifier.keyId) {
      failures.push(`keyId ${rec.keyId} does not match provided public key ${verifier.keyId}`);
    }

    // 6. Signature must verify over the (recomputed) contentHash.
    if (!verifier.verify(recomputedContent, rec.sig)) {
      failures.push("signature does not verify (forged or wrong key)");
    }

    findings.push({ index: i, id: rec.id, ok: failures.length === 0, failures });
    prevRecordHash = rec.recordHash;
  }

  const ok = findings.every((f) => f.ok);
  const badCount = findings.filter((f) => !f.ok).length;
  const summary = ok
    ? `OK — ${records.length} record(s), chain intact, all signatures valid (key ${verifier.keyId}).`
    : `TAMPER DETECTED — ${badCount}/${records.length} record(s) failed verification.`;

  return { ok, count: records.length, verifiedBy: verifier.keyId, findings, summary };
}

/** Convenience: verify against a PEM public key string. */
export function verifyLedgerWithPublicKey(
  records: ProofRecord[],
  publicKeyPem: string,
  expectKeyId?: string,
): VerifyLedgerResult {
  return verifyLedger(records, verifierFromPublicKeyPem(publicKeyPem), expectKeyId);
}
