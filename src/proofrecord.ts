// vaultproof-agent-guard/src/proofrecord.ts
//
// The Verifiable ProofRecord.
//
// Every guard decision can emit a ProofRecord: a machine-readable, ed25519-
// signed, hash-chained attestation of exactly what was proposed, what was
// decided, and under which policy. Records chain to their predecessor, so an
// independent party — holding only the PUBLIC key — can prove that:
//
//   1. no record was altered after signing        (content-hash + signature)
//   2. no record was inserted, deleted, or reordered (prev-hash chain + seq)
//   3. every decision was produced by the key holder (signature verifies)
//
// This operationalizes the published ExecutionProof tamper-detection results
// (ARK-455 / ARK-455b) as a shippable product feature. The record format is a
// stable, documented schema (see PROOFRECORD.md) so third parties can write
// their own verifiers.

import crypto from "crypto";
import type { Decision, ProposedTx } from "./policy.js";
import type { Signer } from "./keys.js";

export const PROOFRECORD_SCHEMA = "vaultproof.proofrecord/v1";

/** Published protocol this record's decision model derives from. */
export const PROTOCOL_REFERENCE = {
  program: "ExecutionProof — Verification Before Execution",
  series_concept_doi: "10.5281/zenodo.21398675",
  note: "Decision model validated by the preregistered ARK experimental corpus.",
} as const;

/**
 * The signed-over CORE of a ProofRecord. Everything here is covered by the
 * content hash and therefore by the signature. Changing any field invalidates
 * the record.
 */
export interface ProofRecordCore {
  schema: string;
  seq: number; // 0 = genesis, strictly +1 each record
  id: string; // human-facing record id, e.g. "PR-AB12..."
  ts: string; // ISO-8601 UTC timestamp
  agentId: string;
  profile: string; // boundary profile name
  policyVersion: string; // policy source hash / semver, ties record to logic
  decision: Decision;
  reason: string;
  action: {
    action: ProposedTx["action"];
    to: string;
    amountUsd: number;
    chain: string;
    calldataSha256: string | null; // hash of calldata (privacy-preserving), or null
  };
  prev: string; // recordHash of previous record ("" iff seq === 0)
  protocol: typeof PROTOCOL_REFERENCE;
}

/** A complete, signed, chainable ProofRecord. */
export interface ProofRecord extends ProofRecordCore {
  contentHash: string; // sha256(canonical(core)) hex
  keyId: string; // signer key id
  sig: string; // base64 ed25519 signature over contentHash
  recordHash: string; // sha256(contentHash + ":" + sig) hex — chained by next record
}

// ---------- Canonical serialization ----------

/**
 * Deterministic JSON: object keys sorted recursively, no incidental
 * whitespace. Two structurally-equal values always produce identical bytes,
 * so hashes are stable across machines and runtimes.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") +
    "}"
  );
}

const sha256hex = (data: Buffer | string): string =>
  crypto.createHash("sha256").update(data).digest("hex");

/** sha256 of raw calldata, or null when there is no calldata. */
export function calldataDigest(calldata?: string): string | null {
  if (!calldata) return null;
  return sha256hex(Buffer.from(calldata, "utf8"));
}

export function computeContentHash(core: ProofRecordCore): string {
  return sha256hex(canonicalize(core));
}

export function computeRecordHash(contentHash: string, sig: string): string {
  return sha256hex(contentHash + ":" + sig);
}

function shortId(): string {
  return "PR-" + crypto.randomBytes(8).toString("hex").toUpperCase();
}

export interface CreateRecordParams {
  seq: number;
  prev: string;
  agentId: string;
  profile: string;
  policyVersion: string;
  decision: Decision;
  reason: string;
  tx: ProposedTx;
  id?: string;
  ts?: string;
}

/** Build and sign a ProofRecord. Pure except for the id/timestamp defaults. */
export function createProofRecord(p: CreateRecordParams, signer: Signer): ProofRecord {
  const core: ProofRecordCore = {
    schema: PROOFRECORD_SCHEMA,
    seq: p.seq,
    id: p.id ?? shortId(),
    ts: p.ts ?? new Date().toISOString(),
    agentId: p.agentId,
    profile: p.profile,
    policyVersion: p.policyVersion,
    decision: p.decision,
    reason: p.reason,
    action: {
      action: p.tx.action,
      to: p.tx.to,
      amountUsd: p.tx.amountUsd ?? 0,
      chain: p.tx.chain,
      calldataSha256: calldataDigest(p.tx.calldata),
    },
    prev: p.prev,
    protocol: PROTOCOL_REFERENCE,
  };
  const contentHash = computeContentHash(core);
  const sig = signer.sign(contentHash);
  const recordHash = computeRecordHash(contentHash, sig);
  return { ...core, contentHash, keyId: signer.keyId, sig, recordHash };
}

/** Split a full record back into its signed-over core. */
export function coreOf(rec: ProofRecord): ProofRecordCore {
  const {
    contentHash: _c,
    keyId: _k,
    sig: _s,
    recordHash: _r,
    ...core
  } = rec;
  return core;
}
