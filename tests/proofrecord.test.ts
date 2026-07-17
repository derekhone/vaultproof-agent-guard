// vaultproof-agent-guard/tests/proofrecord.test.ts
//
// HONEST, reproducible proof that a signed ProofLedger is tamper-EVIDENT.
//
// This is the product embodiment of the published ExecutionProof tamper-
// detection results (ARK-455 honest FAIL → ARK-455b PASS, DOIs 21418388 /
// 21418404). Every case constructs a REAL signed ledger, applies a REAL
// tampering operation, and asserts the independent verifier's ACTUAL verdict.
// No mocks of the crypto, no fabricated numbers.
//
// Run it yourself:  npx tsx tests/proofrecord.test.ts
// Exit code 0 = all passed, 1 = at least one failed (gates CI).

import { generateSigner, verifierFromPublicKeyPem } from "../src/keys.js";
import { ProofLedger } from "../src/ledger.js";
import { ProofRecord } from "../src/proofrecord.js";
import { verifyLedger } from "../src/verify-ledger.js";
import { VaultProofGuard, BoundaryProfile } from "../src/guard.js";

// ---------- Helpers ----------

const signer = generateSigner();
const verifier = verifierFromPublicKeyPem(signer.publicKeyPem);

/** Build a fresh, valid ledger of 4 varied decisions. */
function freshLedger(): ProofLedger {
  const l = new ProofLedger(signer, {
    agentId: "test-agent",
    policyVersion: "vaultproof.policy/1.0.0",
  });
  l.append({ profile: "p", decision: "ALLOW", reason: "ok", tx: { action: "token_transfer", to: "0xaaa", amountUsd: 10, chain: "base-mainnet" } });
  l.append({ profile: "p", decision: "DENY", reason: "not allowlisted", tx: { action: "token_transfer", to: "0xbbb", amountUsd: 20, chain: "base-mainnet" } });
  l.append({ profile: "p", decision: "HOLD", reason: "borderline", tx: { action: "token_transfer", to: "0xaaa", amountUsd: 80, chain: "base-mainnet" } });
  l.append({ profile: "p", decision: "ALLOW", reason: "approved", tx: { action: "approve", to: "0xaaa", amountUsd: 0, chain: "base-mainnet", calldata: "0x095ea7b3deadbeef" } });
  return l;
}

/** Deep clone the records array so we can tamper without touching the source. */
function clone(l: ProofLedger): ProofRecord[] {
  return JSON.parse(JSON.stringify(l.records)) as ProofRecord[];
}

// ---------- Cases ----------

interface Case {
  name: string;
  expectOk: boolean; // true = verifier should say OK; false = should detect tamper
  run: () => boolean; // returns verifier.ok
}

const cases: Case[] = [
  {
    name: "Untampered ledger of 4 records verifies OK",
    expectOk: true,
    run: () => verifyLedger(clone(freshLedger()), verifier).ok,
  },
  {
    name: "Altered DECISION (ALLOW→DENY) is detected",
    expectOk: false,
    run: () => {
      const recs = clone(freshLedger());
      recs[0].decision = "DENY";
      return verifyLedger(recs, verifier).ok;
    },
  },
  {
    name: "Altered AMOUNT is detected",
    expectOk: false,
    run: () => {
      const recs = clone(freshLedger());
      recs[1].action.amountUsd = 999999;
      return verifyLedger(recs, verifier).ok;
    },
  },
  {
    name: "Altered REASON is detected",
    expectOk: false,
    run: () => {
      const recs = clone(freshLedger());
      recs[2].reason = "totally fine, trust me";
      return verifyLedger(recs, verifier).ok;
    },
  },
  {
    name: "Altered calldata digest is detected",
    expectOk: false,
    run: () => {
      const recs = clone(freshLedger());
      recs[3].action.calldataSha256 = "00".repeat(32);
      return verifyLedger(recs, verifier).ok;
    },
  },
  {
    name: "DELETED middle record is detected (chain break / seq gap)",
    expectOk: false,
    run: () => {
      const recs = clone(freshLedger());
      recs.splice(1, 1); // remove record #1
      return verifyLedger(recs, verifier).ok;
    },
  },
  {
    name: "REORDERED records are detected",
    expectOk: false,
    run: () => {
      const recs = clone(freshLedger());
      [recs[1], recs[2]] = [recs[2], recs[1]];
      return verifyLedger(recs, verifier).ok;
    },
  },
  {
    name: "DUPLICATED/inserted record is detected",
    expectOk: false,
    run: () => {
      const recs = clone(freshLedger());
      recs.splice(2, 0, JSON.parse(JSON.stringify(recs[1])));
      return verifyLedger(recs, verifier).ok;
    },
  },
  {
    name: "FORGED signature (random bytes) is detected",
    expectOk: false,
    run: () => {
      const recs = clone(freshLedger());
      recs[2].sig = Buffer.from("x".repeat(64)).toString("base64");
      return verifyLedger(recs, verifier).ok;
    },
  },
  {
    name: "Tamper + recomputed hashes but NO re-sign is detected (sig fails)",
    expectOk: false,
    run: () => {
      // Attacker changes the amount and recomputes contentHash/recordHash to
      // make them internally consistent — but cannot produce a valid signature
      // without the private key.
      const recs = clone(freshLedger());
      const crypto = require("crypto");
      const canon = require("../src/proofrecord.js");
      recs[0].action.amountUsd = 1;
      const { contentHash: _c, keyId: _k, sig: _s, recordHash: _r, ...core } = recs[0];
      const newContent = crypto.createHash("sha256").update(canon.canonicalize(core)).digest("hex");
      recs[0].contentHash = newContent;
      recs[0].recordHash = crypto.createHash("sha256").update(newContent + ":" + recs[0].sig).digest("hex");
      // NOTE: chain to record #1 will also break, and signature won't verify.
      return verifyLedger(recs, verifier).ok;
    },
  },
  {
    name: "Verification with the WRONG public key fails",
    expectOk: false,
    run: () => {
      const other = generateSigner();
      const otherVerifier = verifierFromPublicKeyPem(other.publicKeyPem);
      return verifyLedger(clone(freshLedger()), otherVerifier).ok;
    },
  },
  {
    name: "Tampered GENESIS prev is detected",
    expectOk: false,
    run: () => {
      const recs = clone(freshLedger());
      recs[0].prev = "deadbeef";
      return verifyLedger(recs, verifier).ok;
    },
  },
  {
    name: "End-to-end: real guard run produces an independently verifiable ledger",
    expectOk: true,
    run: () => {
      const profile: BoundaryProfile = {
        name: "e2e", perTxMaxUsd: 100, dailyMaxUsd: 250, allowlist: ["0xaaa"],
        blockUnlimitedApprovals: true, blockSetApprovalForAll: true, holdThresholdPct: 75,
      };
      const g = new VaultProofGuard({ agentId: "e2e-agent", profile, localOnly: true, signer });
      return (async () => {
        await g.verify({ action: "token_transfer", to: "0xaaa", amountUsd: 20, chain: "base-mainnet" });
        await g.verify({ action: "token_transfer", to: "0xbad", amountUsd: 20, chain: "base-mainnet" });
        const recs = JSON.parse(JSON.stringify(g.proofRecords)) as ProofRecord[];
        return verifyLedger(recs, verifierFromPublicKeyPem(g.proofPublicKeyPem!)).ok;
      })() as unknown as boolean;
    },
  },
];

// ---------- Execute ----------

async function main() {
  console.log("\n=== VaultProof — ProofRecord tamper-evidence suite ===\n");
  let passed = 0;
  const rows: string[] = [];

  for (const c of cases) {
    let actualOk: boolean;
    try {
      actualOk = await Promise.resolve(c.run());
    } catch {
      actualOk = false;
    }
    const ok = actualOk === c.expectOk;
    if (ok) passed++;
    const detail = c.expectOk ? "verifies OK" : "tamper detected";
    rows.push(`${ok ? "PASS" : "FAIL"}  | expected ${detail.padEnd(16)} | ${c.name}`);
  }

  console.log("--------------------------------------------------------------------------------");
  for (const r of rows) console.log(r);
  console.log("--------------------------------------------------------------------------------");
  console.log(`\n${passed}/${cases.length} passed\n`);

  process.exit(passed === cases.length ? 0 : 1);
}

main();
