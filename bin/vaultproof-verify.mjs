#!/usr/bin/env node
// vaultproof-agent-guard/bin/vaultproof-verify.mjs
//
// Standalone CLI to independently verify a ProofLedger.
//
//   vaultproof-verify <ledger.jsonl> <publicKey.pem> [--expect-key <keyId>]
//
// Exit code 0 = chain intact & every signature valid. Non-zero = tamper.
// Requires NOTHING from Remnant Fieldworks — just the public ledger + key.
//
// Shipped as ESM (.mjs) and imports the compiled dist/, so it runs after a
// plain `npm install -g vaultproof-agent-guard` with no TypeScript runtime.

import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { loadLedgerFile } = await import(path.join(here, "../dist/ledger.js"));
const { verifyLedgerWithPublicKey } = await import(
  path.join(here, "../dist/verify-ledger.js")
);

function usage() {
  console.error(
    "Usage: vaultproof-verify <ledger.jsonl> <publicKey.pem> [--expect-key <keyId>]",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length < 2) usage();

const [ledgerPath, pubKeyPath] = args;
let expectKey;
const ek = args.indexOf("--expect-key");
if (ek !== -1) expectKey = args[ek + 1];

for (const p of [ledgerPath, pubKeyPath]) {
  if (!fs.existsSync(p)) {
    console.error(`File not found: ${p}`);
    process.exit(2);
  }
}

const records = loadLedgerFile(ledgerPath);
const publicKeyPem = fs.readFileSync(pubKeyPath, "utf8");
const result = verifyLedgerWithPublicKey(records, publicKeyPem, expectKey);

console.log("\n=== VaultProof — Independent ProofLedger Verification ===\n");
console.log(`Ledger : ${ledgerPath}`);
console.log(`Key    : ${pubKeyPath} (keyId ${result.verifiedBy})`);
console.log(`Records: ${result.count}\n`);
console.log(
  "--------------------------------------------------------------------------------",
);
for (const f of result.findings) {
  const tag = f.ok ? "OK  " : "FAIL";
  console.log(`${tag} | #${String(f.index).padStart(4, "0")} | ${f.id}`);
  for (const msg of f.failures) console.log(`       \u21b3 ${msg}`);
}
console.log(
  "--------------------------------------------------------------------------------\n",
);
console.log(result.summary + "\n");
process.exit(result.ok ? 0 : 1);
