// vaultproof-agent-guard/examples/agentkit-transfer.ts
// Example: guard an AgentKit token transfer with VaultProof.

import { VaultProofGuard } from "../src/guard";
import { askTelegram } from "../src/telegram";
import profile from "../profiles/conservative-trader.json";

const guard = new VaultProofGuard({
  agentId: "trading-agent-01",
  profile,
  localOnly: true, // free tier — flip to hosted with apiKey for signed ProofRecords
  onHold: async (tx, holdId) =>
    askTelegram(`${tx.action} — $${tx.amountUsd ?? 0} → ${tx.to}\nChain: ${tx.chain}\nRef: ${holdId}`),
});

async function main() {
  // Before your agent signs anything:
  const result = await guard.verify({
    action: "token_transfer",
    to: "0xyourallowlistedaddress".toLowerCase(),
    amountUsd: 85,
    chain: "base-mainnet",
  });

  if (result.decision !== "ALLOW") {
    throw new Error(`Blocked by VaultProof: ${result.reason}`);
  }
  // ...proceed to sign & send via AgentKit
  console.log("Transaction approved:", result.proofRecordId);
}

main().catch(console.error);
