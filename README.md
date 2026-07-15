# VaultProof Agent Guard

> Your agent can think freely. It can't spend freely.

Non-custodial, pre-execution wallet guard for AI agents. Before your agent
signs **anything**, the transaction hits a verification gate: spend caps,
allowlists, drain-vector blocking, and a Telegram ping for anything unusual —
**ALLOW / HOLD / DENY**, with a ProofRecord either way.

Built by [Remnant Fieldworks Inc.](https://remnantfieldworks.com) on the
[ExecutionProof](https://executionproof.io) gate. Verification Before Execution™.

<!-- DOI badge — add after Zenodo archives v0.1.0 -->
<!-- [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.XXXXXXX.svg)](https://doi.org/10.5281/zenodo.XXXXXXX) -->

## Why

The #1 unsolved problem for AI agents with wallets is: **how do I stop my
agent from draining itself?** Prompt injection, hallucinated destinations,
unlimited approvals, `setApprovalForAll` to unknown contracts — one bad
decision and the wallet is gone.

VaultProof Agent Guard is a policy gate that sits *in front of your signer*:

- **Spend caps** — per-transaction and daily USD ceilings
- **Allowlist-only** — approved contracts and addresses, everything else DENIED
- **Drain-vector blocking** — unlimited approvals and `setApprovalForAll` blocked by default
- **Human HOLD approval** — borderline transactions ping you on Telegram; no reply in 5 minutes = DENY
- **Fail-closed** — if the gate is unreachable, nothing signs. Ever.
- **Non-custodial** — we never hold your keys

## Quickstart

```ts
import { VaultProofGuard } from "./src/guard";
import { askTelegram } from "./src/telegram";
import profile from "./profiles/conservative-trader.json";

const guard = new VaultProofGuard({
  agentId: "trading-agent-01",
  profile,
  localOnly: true, // free tier — local rules, unsigned records
  onHold: async (tx, holdId) =>
    askTelegram(`${tx.action} — $${tx.amountUsd ?? 0} → ${tx.to} (${holdId})`),
});

const result = await guard.verify({
  action: "token_transfer",
  to: "0x...allowlisted".toLowerCase(),
  amountUsd: 85,
  chain: "base-mainnet",
});

if (result.decision !== "ALLOW") throw new Error(result.reason);
// proceed to sign & send
