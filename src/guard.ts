// vaultproof-agent-guard/src/guard.ts
// VaultProof Agent Guard — pre-execution gate for AgentKit wallets.
// Non-custodial: we never hold keys. Fail-closed: no verify, no sign.

import crypto from "crypto";
import {
  Decision,
  ProposedTx,
  BoundaryProfile,
  evaluatePolicy,
  POLICY_VERSION,
} from "./policy.js";
import type { Signer } from "./keys.js";
import type { ProofRecord } from "./proofrecord.js";
import { ProofLedger } from "./ledger.js";

// ---------- Types ----------
// Core decision types now live in ./policy (single source of truth) and are
// re-exported here so existing imports from "vaultproof-agent-guard" keep working.

export type { Decision, ProposedTx, BoundaryProfile } from "./policy.js";

export interface VerifyResult {
  decision: Decision;
  reason: string;
  proofRecordId: string;
  holdId?: string;            // present when decision === "HOLD"
  proofRecord?: ProofRecord;  // present when a signer is configured (verifiable)
}

export interface GuardConfig {
  apiKey?: string;                       // ExecutionProof hosted gate (Pro tier)
  apiUrl?: string;                       // default: https://api.executionproof.io/v2/verify
  profile: BoundaryProfile;              // local policy (free tier / fallback)
  agentId: string;
  onHold?: (tx: ProposedTx, holdId: string) => Promise<boolean>; // human approval hook (Telegram etc.)
  localOnly?: boolean;                   // true = free tier, local rules only

  // ----- Verifiable ProofRecords (operator-sovereign, optional) -----
  // Provide an operator-held signer to emit ed25519-signed, hash-chained
  // ProofRecords for every decision. Records are verifiable by anyone holding
  // the PUBLIC key, with no trust in Remnant Fieldworks. See PROOFRECORD.md.
  signer?: Signer;                       // operator key (see src/keys.ts)
  ledgerFile?: string;                   // optional JSONL path to persist the chain
  policyVersion?: string;                // override policy version tag in records
}

// ---------- Guard ----------

export class VaultProofGuard {
  private spentTodayUsd = 0;
  private dayStamp = new Date().toDateString();
  private ledger?: ProofLedger;

  constructor(private cfg: GuardConfig) {
    if (cfg.signer) {
      this.ledger = new ProofLedger(cfg.signer, {
        filePath: cfg.ledgerFile,
        agentId: cfg.agentId,
        policyVersion: cfg.policyVersion ?? POLICY_VERSION,
      });
    }
  }

  /** PEM public key that verifies this guard's ProofLedger (if signing). */
  get proofPublicKeyPem(): string | undefined {
    return this.ledger?.publicKeyPem;
  }

  /** The signed, hash-chained records emitted so far (if signing). */
  get proofRecords(): readonly ProofRecord[] {
    return this.ledger ? this.ledger.records : [];
  }

  /** Call this before signing ANY transaction. */
  async verify(tx: ProposedTx): Promise<VerifyResult> {
    this.rollDailyWindow();

    // 1. Local hard rules — always enforced, even with hosted gate up.
    const local = this.checkLocal(tx);
    if (local.decision === "DENY") return this.record(tx, local);

    // 2. Hosted gate (signed ProofRecords) — fail-closed on error.
    let result = local;
    if (!this.cfg.localOnly && this.cfg.apiKey) {
      try {
        result = await this.callHostedGate(tx);
      } catch {
        result = { decision: "HOLD", reason: "Gate unreachable — fail-closed", proofRecordId: this.prId() };
      }
    }

    // 3. HOLD resolution via human approval hook.
    if (result.decision === "HOLD" && this.cfg.onHold) {
      const approved = await this.cfg.onHold(tx, result.holdId ?? this.prId());
      result = approved
        ? { ...result, decision: "ALLOW", reason: result.reason + " → human approved" }
        : { ...result, decision: "DENY", reason: result.reason + " → human denied" };
    }

    if (result.decision === "ALLOW") this.spentTodayUsd += tx.amountUsd ?? 0;
    return this.record(tx, result);
  }

  // ---------- Local policy ----------
  // Delegates to the shared, pure evaluatePolicy() in ./policy so the SDK
  // (free tier) and the hosted gate (Pro tier) enforce identical rules.

  private checkLocal(tx: ProposedTx): VerifyResult {
    const verdict = evaluatePolicy(tx, this.cfg.profile, this.spentTodayUsd);
    const proofRecordId = this.prId();
    return verdict.decision === "HOLD"
      ? { ...verdict, proofRecordId, holdId: this.prId() }
      : { ...verdict, proofRecordId };
  }

  // ---------- Hosted gate ----------

  private async callHostedGate(tx: ProposedTx): Promise<VerifyResult> {
    const res = await fetch(this.cfg.apiUrl ?? "https://api.executionproof.io/v2/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: "agent_wallet_spend",
        proposed_action: tx.action,
        actor: { id: this.cfg.agentId, roles: ["ai_agent"] },
        context: { ...tx, spent_today_usd: this.spentTodayUsd, profile: this.cfg.profile.name },
      }),
    });
    if (!res.ok) throw new Error(`Gate error ${res.status}`);
    const body = await res.json() as { decision: Decision; reason: string; proofrecord?: { id: string }; hold_id?: string };
    return {
      decision: body.decision,
      reason: body.reason,
      proofRecordId: body.proofrecord?.id ?? this.prId(),
      holdId: body.hold_id,
    };
  }

  // ---------- Helpers ----------

  private rollDailyWindow() {
    const today = new Date().toDateString();
    if (today !== this.dayStamp) { this.dayStamp = today; this.spentTodayUsd = 0; }
  }

  private prId(): string {
    return "PR-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  }

  private record(tx: ProposedTx, r: VerifyResult): VerifyResult {
    // When an operator signer is configured, emit a signed, hash-chained
    // ProofRecord for the TERMINAL decision and make its id authoritative.
    if (this.ledger) {
      const rec = this.ledger.append({
        profile: this.cfg.profile.name,
        decision: r.decision,
        reason: r.reason,
        tx,
      });
      r = { ...r, proofRecordId: rec.id, proofRecord: rec };
    }
    console.log(`[VaultProof] ${r.decision} | ${tx.action} → ${tx.to} | $${tx.amountUsd ?? 0} | ${r.reason} | ${r.proofRecordId}`);
    return r;
  }
}
