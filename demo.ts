#!/usr/bin/env tsx
/**
 * VaultProof Agent Guard — Quick Demo
 * 
 * Run: npm ci && npx tsx demo.ts
 * 
 * Shows 6 scenarios: ALLOW, HOLD, DENY (3 types), plus a signed, independently
 * verifiable ProofRecord ledger with live tamper detection.
 * No API keys or Telegram setup required — pure local evaluation.
 */

import { VaultProofGuard } from "./src/guard.js";
import type { ProposedTx } from "./src/guard.js";
import { generateSigner } from "./src/keys.js";
import { verifyLedgerWithPublicKey } from "./src/verify-ledger.js";
import { coreOf } from "./src/proofrecord.js";

async function main() {
  // Use the conservative profile (low caps, strict allowlist)
  const profile = {
    perTxMaxUsd: 100,
    dailyMaxUsd: 250,
    allowlist: ["0xAllowedAddress1".toLowerCase()],
    blockUnlimitedApprovals: true,
    blockSetApprovalForAll: true,
    holdThresholdPct: 80,
  };

  const guard = new VaultProofGuard({
    agentId: "demo-agent",
    profile,
    localOnly: true,
    onHold: async (tx, holdId) => {
      console.log(`  ⏸️  HOLD triggered (${holdId}) — auto-denying for demo`);
      return false; // Auto-deny for this demo (no real Telegram)
    },
  });

  console.log("🛡️  VaultProof Agent Guard — Quick Demo\n");
  console.log("Profile: conservative-trader (max $100/tx, $250/day, strict allowlist)\n");

  // Scenario 1: ALLOW — small transfer to allowlisted address
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Scenario 1: Small transfer to allowlisted address");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const tx1: ProposedTx = {
    action: "token_transfer",
    to: "0xAllowedAddress1".toLowerCase(),
    amountUsd: 50,
    chain: "base-mainnet",
  };
  const r1 = await guard.verify(tx1);
  console.log(`✅ Decision: ${r1.decision}`);
  console.log(`   Reason: ${r1.reason}\n`);

  // Scenario 2: HOLD — large transfer (>80% of cap) to allowlisted address
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Scenario 2: Large transfer (>80% of cap) to allowlisted address");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const tx2: ProposedTx = {
    action: "token_transfer",
    to: "0xAllowedAddress1".toLowerCase(),
    amountUsd: 90, // 90% of $100 cap
    chain: "base-mainnet",
  };
  const r2 = await guard.verify(tx2);
  console.log(`⏸️  Decision: ${r2.decision}`);
  console.log(`   Reason: ${r2.reason}\n`);

  // Scenario 3: DENY — transfer to NON-allowlisted address
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Scenario 3: Transfer to NON-allowlisted address");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const tx3: ProposedTx = {
    action: "token_transfer",
    to: "0xUNKNOWNaddress".toLowerCase(),
    amountUsd: 30,
    chain: "base-mainnet",
  };
  const r3 = await guard.verify(tx3);
  console.log(`❌ Decision: ${r3.decision}`);
  console.log(`   Reason: ${r3.reason}\n`);

  // Scenario 4: DENY — over per-tx cap
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Scenario 4: Transfer exceeds per-tx cap ($100)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const tx4: ProposedTx = {
    action: "token_transfer",
    to: "0xAllowedAddress1".toLowerCase(),
    amountUsd: 150,
    chain: "base-mainnet",
  };
  const r4 = await guard.verify(tx4);
  console.log(`❌ Decision: ${r4.decision}`);
  console.log(`   Reason: ${r4.reason}\n`);

  // Scenario 5: DENY — setApprovalForAll (drain vector)
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Scenario 5: setApprovalForAll call (drain vector)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const tx5: ProposedTx = {
    action: "contract_call",
    to: "0xSomeNFTContract".toLowerCase(),
    chain: "base-mainnet",
    calldata: "0xa22cb465", // setApprovalForAll selector
  };
  const r5 = await guard.verify(tx5);
  console.log(`❌ Decision: ${r5.decision}`);
  console.log(`   Reason: ${r5.reason}\n`);

  // Scenario 6: Verifiable ProofRecords — signed, hash-chained, independently checkable
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Scenario 6: Verifiable ProofRecords (signed decision ledger)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Operator generates their own signing key (local tier = you hold the key).
  const signer = generateSigner();
  const provenGuard = new VaultProofGuard({
    agentId: "demo-agent-signed",
    profile,
    localOnly: true,
    signer, // <-- turning this on makes every decision a signed, chained record
    onHold: async () => false,
  });

  // Run a few decisions; each appends a signed record to the in-memory ledger.
  await provenGuard.verify({ action: "token_transfer", to: "0xAllowedAddress1".toLowerCase(), amountUsd: 40, chain: "base-mainnet" });
  await provenGuard.verify({ action: "token_transfer", to: "0xUNKNOWNaddress".toLowerCase(), amountUsd: 30, chain: "base-mainnet" });
  await provenGuard.verify({ action: "token_transfer", to: "0xAllowedAddress1".toLowerCase(), amountUsd: 60, chain: "base-mainnet" });

  const records = provenGuard.proofRecords;
  console.log(`   Produced ${records.length} signed, hash-chained ProofRecords.`);

  // A third party verifies OFFLINE using only the public key — zero trust in RF.
  const publicKeyPem = provenGuard.proofPublicKeyPem!;
  const clean = verifyLedgerWithPublicKey(records, publicKeyPem);
  console.log(`   Independent offline verification: ${clean.ok ? "✅ OK" : "❌ FAILED"} (${records.length} records)`);

  // Now tamper: flip a DENY into an ALLOW in the stored record and re-verify.
  const tampered = records.map((r) => JSON.parse(JSON.stringify(r)));
  const denyIdx = tampered.findIndex((r) => coreOf(r).decision === "DENY");
  if (denyIdx >= 0) {
    tampered[denyIdx].decision = "ALLOW";
    const check = verifyLedgerWithPublicKey(tampered, publicKeyPem);
    console.log(`   After flipping a DENY→ALLOW: ${check.ok ? "not caught ⚠️" : "❌ tamper DETECTED"} — ${check.summary}`);
  }
  console.log(`   Verify any saved ledger from the CLI:  npm run verify -- <ledger.jsonl> <publicKey.pem>\n`);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Demo complete. Scenarios 1–5 evaluated locally; Scenario 6 produced");
  console.log("and independently verified a tamper-evident ProofRecord ledger.");
  console.log("Full test suite (25 cases): npm test   |   Spec: PROOFRECORD.md");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(console.error);
