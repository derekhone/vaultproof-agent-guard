// vaultproof-agent-guard/src/policy.ts
// Pure, side-effect-free boundary policy logic.
// This is the SINGLE SOURCE OF TRUTH for ALLOW / HOLD / DENY decisions,
// imported by BOTH the SDK (src/guard.ts) and the hosted gate (server/gate.ts)
// so the local free tier and the paid hosted gate can never disagree.

// ---------- Types ----------

export type Decision = "ALLOW" | "HOLD" | "DENY";

export interface ProposedTx {
  action:
    | "token_transfer"
    | "token_swap"
    | "contract_call"
    | "nft_purchase"
    | "nft_transfer"
    | "approve";
  to: string; // destination address or contract
  amountUsd?: number; // resolved USD value (0 for non-value calls)
  chain: string; // e.g. "base-mainnet"
  calldata?: string; // raw calldata for contract calls
  meta?: Record<string, unknown>;
}

export interface BoundaryProfile {
  name: string;
  perTxMaxUsd: number;
  dailyMaxUsd: number;
  allowlist: string[]; // lowercase addresses/contracts
  blockUnlimitedApprovals: boolean;
  blockSetApprovalForAll: boolean;
  holdThresholdPct: number; // % of perTxMax that triggers HOLD
}

/** A policy verdict WITHOUT any I/O (no proofRecordId, no logging). */
export interface PolicyDecision {
  decision: Decision;
  reason: string;
}

// ---------- Known drain-vector signatures ----------

export const SIG_APPROVE = "0x095ea7b3";
export const SIG_SET_APPROVAL_FOR_ALL = "0xa22cb465";
export const UNLIMITED = "f".repeat(64);

// ---------- Pure evaluation ----------

/** True if an address/contract is on the profile allowlist (case-insensitive). */
export function isAllowed(addr: string, profile: BoundaryProfile): boolean {
  return profile.allowlist.includes(addr.toLowerCase());
}

/**
 * Evaluate a proposed transaction against a boundary profile.
 *
 * @param tx             the proposed transaction
 * @param profile        the active boundary profile
 * @param spentTodayUsd  USD already spent in the current daily window
 * @returns              an ALLOW / HOLD / DENY verdict with a human-readable reason
 */
export function evaluatePolicy(
  tx: ProposedTx,
  profile: BoundaryProfile,
  spentTodayUsd: number,
): PolicyDecision {
  const amount = tx.amountUsd ?? 0;
  const deny = (reason: string): PolicyDecision => ({ decision: "DENY", reason });
  const hold = (reason: string): PolicyDecision => ({ decision: "HOLD", reason });

  // 1. Drain vectors first — these are hard blocks.
  if (tx.calldata) {
    const sig = tx.calldata.slice(0, 10).toLowerCase();
    if (
      profile.blockSetApprovalForAll &&
      sig === SIG_SET_APPROVAL_FOR_ALL &&
      !isAllowed(tx.to, profile)
    ) {
      return deny("setApprovalForAll to non-allowlisted address (drain vector)");
    }
    if (
      profile.blockUnlimitedApprovals &&
      sig === SIG_APPROVE &&
      tx.calldata.toLowerCase().includes(UNLIMITED)
    ) {
      return deny("Unlimited token approval (drain vector)");
    }
  }

  // 2. Allowlist.
  if (!isAllowed(tx.to, profile)) {
    return deny(`Destination ${tx.to} not on allowlist`);
  }

  // 3. Spend caps.
  if (amount > profile.perTxMaxUsd) {
    return deny(`$${amount} exceeds per-tx cap $${profile.perTxMaxUsd}`);
  }
  if (spentTodayUsd + amount > profile.dailyMaxUsd) {
    return deny(`Daily cap $${profile.dailyMaxUsd} would be exceeded`);
  }

  // 4. HOLD threshold — borderline transactions need human review.
  if (amount >= profile.perTxMaxUsd * (profile.holdThresholdPct / 100)) {
    return hold(
      `$${amount} ≥ ${profile.holdThresholdPct}% of per-tx cap — human review`,
    );
  }

  return { decision: "ALLOW", reason: "All local checks passed" };
}
