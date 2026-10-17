// vaultproof-agent-guard/src/ledger.ts
//
// Append-only, hash-chained ProofLedger.
//
// Each appended record commits to the previous record's hash, forming a chain.
// Persisted as JSON Lines (one record per line) so it is trivially streamable,
// greppable, and diffable — and so an independent verifier can re-read it with
// no VaultProof code at all (the format is documented in PROOFRECORD.md).

import fs from "fs";
import path from "path";
import {
  ProofRecord,
  createProofRecord,
  CreateRecordParams,
} from "./proofrecord.js";
import type { Signer } from "./keys.js";
import type { Decision, ProposedTx } from "./policy.js";

export const GENESIS_PREV = ""; // prev of the first record

export interface LedgerOptions {
  /** File to persist to (JSONL). Omit for in-memory only. */
  filePath?: string;
  /** Default agent id for appended records. */
  agentId: string;
  /** Policy version string bound into every record. */
  policyVersion: string;
}

export interface AppendInput {
  profile: string;
  decision: Decision;
  reason: string;
  tx: ProposedTx;
}

export class ProofLedger {
  private _records: ProofRecord[] = [];
  private lastHash = GENESIS_PREV;
  private nextSeq = 0;

  constructor(private signer: Signer, private opts: LedgerOptions) {
    if (opts.filePath && fs.existsSync(opts.filePath)) {
      this.loadExisting(opts.filePath);
    }
  }

  /** All records currently in the ledger (chronological). */
  get records(): readonly ProofRecord[] {
    return this._records;
  }

  /** recordHash of the tip (or GENESIS_PREV if empty). */
  get head(): string {
    return this.lastHash;
  }

  get length(): number {
    return this._records.length;
  }

  /** The public key that verifies this ledger. Share it with auditors. */
  get publicKeyPem(): string {
    return this.signer.publicKeyPem;
  }

  /** Append a new signed, chained record and (optionally) persist it. */
  append(input: AppendInput): ProofRecord {
    const params: CreateRecordParams = {
      seq: this.nextSeq,
      prev: this.lastHash,
      agentId: this.opts.agentId,
      profile: input.profile,
      policyVersion: this.opts.policyVersion,
      decision: input.decision,
      reason: input.reason,
      tx: input.tx,
    };
    const rec = createProofRecord(params, this.signer);
    this._records.push(rec);
    this.lastHash = rec.recordHash;
    this.nextSeq += 1;
    if (this.opts.filePath) {
      fs.mkdirSync(path.dirname(path.resolve(this.opts.filePath)), {
        recursive: true,
      });
      fs.appendFileSync(this.opts.filePath, JSON.stringify(rec) + "\n");
    }
    return rec;
  }

  private loadExisting(filePath: string): void {
    const lines = fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    for (const line of lines) {
      const rec = JSON.parse(line) as ProofRecord;
      this._records.push(rec);
      this.lastHash = rec.recordHash;
      this.nextSeq = rec.seq + 1;
    }
  }
}

/** Read a JSONL ledger file into an array of records (no verification). */
export function loadLedgerFile(filePath: string): ProofRecord[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ProofRecord);
}
