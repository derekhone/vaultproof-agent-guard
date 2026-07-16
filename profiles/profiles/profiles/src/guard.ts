// vaultproof-agent-guard/src/guard.ts
// VaultProof Agent Guard — pre-execution gate for AgentKit wallets.
// Non-custodial: we never hold keys. Fail-closed: no verify, no sign.

import crypto from "crypto";

// ---------- Types ----------

export type Decision = "ALLOW" | "HOLD" | "DENY";

export interface ProposedTx {
  action: "token_transfer" | "token_swap" | "contract_call" | "nft_purchase" | "nft_transfer" | "approve";
  to: string;                 // destination address or contract
  amountUsd?: number;         // resolved USD value (0 for non-value calls)
  chain: string;              // e.g. "base-mainnet"
  calldata?: string;          // raw calldata for contract calls
  meta?: Record<string, unknown>;
}

export interface VerifyResult {
  decision: Decision;
  reason: string;
  proofRecordId: string;
  holdId?: string;            // present when decision === "HOLD"
}

export interface GuardConfig {
  apiKey?: string;                       // ExecutionProof hosted gate (Pro tier)
  apiUrl?: string;                       // default: https://api.executionproof.io/v2/verify
  profile: BoundaryProfile;              // local policy (free tier / fallback)
  agentId: string;
  onHold?: (tx: ProposedTx, holdId: string) => Promise<boolean>; // human approval hook (Telegram etc.)
  localOnly?: boolean;                   // true = free tier, local rules only
}

export interface BoundaryProfile {
  name: string;
  perTxMaxUsd: number;
  dailyMaxUsd: number;
  allowlist: string[];                   // lowercase addresses/contracts
  blockUnlimitedApprovals: boolean;
  blockSetApprovalForAll: boolean;
  holdThresholdPct: number;              // % of perTxMax that triggers HOLD
}

// ---------- Known drain-vector signatures ----------

const SIG_APPROVE = "0x095ea7b3";
const SIG_SET_APPROVAL_FOR_ALL = "0xa22cb465";
const UNLIMITED = "f".repeat(64);

// ---------- Guard ----------

export class VaultProofGuard {
  private spentTodayUsd = 0;
  private dayStamp = new Date().toDateString();

  constructor(private cfg: GuardConfig) {}

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

  private checkLocal(tx: ProposedTx): VerifyResult {
    const p = this.cfg.profile;
    const amount = tx.amountUsd ?? 0;
    const deny = (reason: string): VerifyResult => ({ decision: "DENY", reason, proofRecordId: this.prId() });
    const hold = (reason: string): VerifyResult => ({ decision: "HOLD", reason, proofRecordId: this.prId(), holdId: this.prId() });

    // Drain vectors first.
    if (tx.calldata) {
      const sig = tx.calldata.slice(0, 10).toLowerCase();
      if (p.blockSetApprovalForAll && sig === SIG_SET_APPROVAL_FOR_ALL && !this.allowed(tx.to))
        return deny("setApprovalForAll to non-allowlisted address (drain vector)");
      if (p.blockUnlimitedApprovals && sig === SIG_APPROVE && tx.calldata.toLowerCase().includes(UNLIMITED))
        return deny("Unlimited token approval (drain vector)");
    }

    if (!this.allowed(tx.to)) return deny(`Destination ${tx.to} not on allowlist`);
    if (amount > p.perTxMaxUsd) return deny(`$${amount} exceeds per-tx cap $${p.perTxMaxUsd}`);
    if (this.spentTodayUsd + amount > p.dailyMaxUsd) return deny(`Daily cap $${p.dailyMaxUsd} would be exceeded`);
    if (amount >= p.perTxMaxUsd * (p.holdThresholdPct / 100))
      return hold(`$${amount} ≥ ${p.holdThresholdPct}% of per-tx cap — human review`);

    return { decision: "ALLOW", reason: "All local checks passed", proofRecordId: this.prId() };
  }

  private allowed(addr: string): boolean {
    return this.cfg.profile.allowlist.includes(addr.toLowerCase());
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
    const body = await res.json();
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
    console.log(`[VaultProof] ${r.decision} | ${tx.action} → ${tx.to} | $${tx.amountUsd ?? 0} | ${r.reason} | ${r.proofRecordId}`);
    return r;
  }
}
