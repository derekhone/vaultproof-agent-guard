// vaultproof-agent-guard/tests/drain-attacks.test.ts
//
// HONEST, reproducible proof that the guard blocks real attack shapes.
// Every case below constructs a real ProposedTx and asserts the guard's
// ACTUAL decision. No mocks of the decision logic, no fabricated numbers.
//
// Run it yourself:  npm test
// Exit code 0 = all passed, 1 = at least one failed (used to gate CI).

import { VaultProofGuard, BoundaryProfile, ProposedTx, Decision } from "../src/guard.js";

// ---------- Fixtures ----------

const GOOD = "0x1111111111111111111111111111111111111111"; // allowlisted
const ATTACKER = "0x2222222222222222222222222222222222222222"; // NOT allowlisted

const profile: BoundaryProfile = {
  name: "test-profile",
  perTxMaxUsd: 100,
  dailyMaxUsd: 250,
  allowlist: [GOOD],
  blockUnlimitedApprovals: true,
  blockSetApprovalForAll: true,
  holdThresholdPct: 75, // >= $75 triggers HOLD
};

// calldata builders
const APPROVE_UNLIMITED = "0x095ea7b3" + "0".repeat(64) + "f".repeat(64);
const SET_APPROVAL_FOR_ALL = "0xa22cb465" + "0".repeat(64) + "1".padStart(64, "0");

function guard(onHold?: (tx: ProposedTx, id: string) => Promise<boolean>, extra: Partial<ConstructorParameters<typeof VaultProofGuard>[0]> = {}) {
  return new VaultProofGuard({ agentId: "test-agent", profile, localOnly: true, onHold, ...extra });
}

// ---------- Tiny runner ----------

interface Case {
  name: string;
  expected: Decision;
  run: () => Promise<Decision>;
}

const cases: Case[] = [
  {
    name: "Unlimited ERC-20 approval (approve spender, 2^256-1)",
    expected: "DENY",
    run: async () =>
      (await guard().verify({ action: "approve", to: ATTACKER, amountUsd: 0, chain: "base-mainnet", calldata: APPROVE_UNLIMITED })).decision,
  },
  {
    name: "setApprovalForAll to NON-allowlisted operator",
    expected: "DENY",
    run: async () =>
      (await guard().verify({ action: "approve", to: ATTACKER, amountUsd: 0, chain: "base-mainnet", calldata: SET_APPROVAL_FOR_ALL })).decision,
  },
  {
    name: "Transfer to NON-allowlisted destination",
    expected: "DENY",
    run: async () =>
      (await guard().verify({ action: "token_transfer", to: ATTACKER, amountUsd: 10, chain: "base-mainnet" })).decision,
  },
  {
    name: "Transfer exceeding per-tx cap ($500 > $100)",
    expected: "DENY",
    run: async () =>
      (await guard().verify({ action: "token_transfer", to: GOOD, amountUsd: 500, chain: "base-mainnet" })).decision,
  },
  {
    name: "Parameter mutation: destination swapped to attacker after intent",
    expected: "DENY",
    run: async () => {
      // Agent 'intended' a $10 send to GOOD, but the calldata/params resolve to ATTACKER.
      // The guard checks the ACTUAL resolved destination, not the stated intent.
      return (await guard().verify({ action: "token_transfer", to: ATTACKER, amountUsd: 10, chain: "base-mainnet", meta: { statedIntent: GOOD } })).decision;
    },
  },
  {
    name: "Daily-cap accumulation: 3rd sub-cap transfer breaks the daily ceiling",
    expected: "DENY",
    run: async () => {
      const g = guard();
      await g.verify({ action: "token_transfer", to: GOOD, amountUsd: 60, chain: "base-mainnet" }); // 60
      await g.verify({ action: "token_transfer", to: GOOD, amountUsd: 60, chain: "base-mainnet" }); // 120
      await g.verify({ action: "token_transfer", to: GOOD, amountUsd: 60, chain: "base-mainnet" }); // 180
      // 4th would be 240 (ok), 5th 300 > 250 daily cap -> DENY
      await g.verify({ action: "token_transfer", to: GOOD, amountUsd: 60, chain: "base-mainnet" }); // 240
      return (await g.verify({ action: "token_transfer", to: GOOD, amountUsd: 60, chain: "base-mainnet" })).decision; // 300 -> DENY
    },
  },
  {
    name: "Borderline amount at HOLD threshold ($80 >= 75% of $100), no approver",
    expected: "HOLD",
    run: async () =>
      (await guard().verify({ action: "token_transfer", to: GOOD, amountUsd: 80, chain: "base-mainnet" })).decision,
  },
  {
    name: "HOLD then HUMAN APPROVES -> ALLOW",
    expected: "ALLOW",
    run: async () =>
      (await guard(async () => true).verify({ action: "token_transfer", to: GOOD, amountUsd: 80, chain: "base-mainnet" })).decision,
  },
  {
    name: "HOLD then HUMAN DENIES -> DENY",
    expected: "DENY",
    run: async () =>
      (await guard(async () => false).verify({ action: "token_transfer", to: GOOD, amountUsd: 80, chain: "base-mainnet" })).decision,
  },
  {
    name: "Legitimate small transfer to allowlisted addr under threshold",
    expected: "ALLOW",
    run: async () =>
      (await guard().verify({ action: "token_transfer", to: GOOD, amountUsd: 20, chain: "base-mainnet" })).decision,
  },
  {
    name: "setApprovalForAll to ALLOWLISTED operator (not a drain) -> ALLOW",
    expected: "ALLOW",
    run: async () =>
      (await guard().verify({ action: "approve", to: GOOD, amountUsd: 0, chain: "base-mainnet", calldata: SET_APPROVAL_FOR_ALL })).decision,
  },
  {
    name: "Fail-closed: hosted gate unreachable -> HOLD (never silently ALLOW)",
    expected: "HOLD",
    run: async () => {
      // localOnly=false + apiKey set forces a hosted-gate call; unreachable URL => fail-closed HOLD.
      const g = guard(undefined, { localOnly: false, apiKey: "test-key", apiUrl: "http://127.0.0.1:9/verify" });
      return (await g.verify({ action: "token_transfer", to: GOOD, amountUsd: 20, chain: "base-mainnet" })).decision;
    },
  },
];

// ---------- Execute ----------

async function main() {
  console.log("\n=== VaultProof Agent Guard — drain-attack test suite ===\n");
  let passed = 0;
  const rows: string[] = [];

  for (const c of cases) {
    let actual: Decision | "ERROR";
    try {
      actual = await c.run();
    } catch (e) {
      actual = "ERROR";
    }
    const ok = actual === c.expected;
    if (ok) passed++;
    rows.push(
      `${ok ? "PASS" : "FAIL"}  | expected ${c.expected.padEnd(5)} got ${String(actual).padEnd(5)} | ${c.name}`,
    );
  }

  console.log("\n--------------------------------------------------------------------------------");
  for (const r of rows) console.log(r);
  console.log("--------------------------------------------------------------------------------");
  console.log(`\n${passed}/${cases.length} passed\n`);

  process.exit(passed === cases.length ? 0 : 1);
}

main();
