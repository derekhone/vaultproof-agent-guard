# Benchmark — Reproducible Proof

This benchmark is **fully reproducible**. Clone the repo and run it yourself:

```bash
npm install
npm test
```

Exit code is `0` only if every case passes (it gates CI). No results below are
hand-written — they are the verbatim console output of the test runner acting on
the real `VaultProofGuard`.

**What this proves:** the guard reaches the stated ALLOW / HOLD / DENY decision
for each attack shape in the suite. **What it does not prove:** safety against
attacks not in the suite, on-chain correctness, or fitness for production funds.
See [THREAT_MODEL.md](./THREAT_MODEL.md) for known limitations.

- Captured: 2026-07-16 01:12 UTC
- Runtime: Node v22.14.0, tsx
- Source of truth for decisions: [`src/policy.ts`](./src/policy.ts)

## Verbatim output

```

> vaultproof-agent-guard@0.1.2 test
> tsx tests/drain-attacks.test.ts


=== VaultProof Agent Guard — drain-attack test suite ===

[VaultProof] DENY | approve → 0x2222222222222222222222222222222222222222 | $0 | Unlimited token approval (drain vector) | PR-E3DFC667DC1A946E
[VaultProof] DENY | approve → 0x2222222222222222222222222222222222222222 | $0 | setApprovalForAll to non-allowlisted address (drain vector) | PR-8737A19E4EAC52EC
[VaultProof] DENY | token_transfer → 0x2222222222222222222222222222222222222222 | $10 | Destination 0x2222222222222222222222222222222222222222 not on allowlist | PR-A9317F32070C3EE1
[VaultProof] DENY | token_transfer → 0x1111111111111111111111111111111111111111 | $500 | $500 exceeds per-tx cap $100 | PR-89504383C5EEC725
[VaultProof] DENY | token_transfer → 0x2222222222222222222222222222222222222222 | $10 | Destination 0x2222222222222222222222222222222222222222 not on allowlist | PR-48E0575E272DC80B
[VaultProof] ALLOW | token_transfer → 0x1111111111111111111111111111111111111111 | $60 | All local checks passed | PR-045815D004748835
[VaultProof] ALLOW | token_transfer → 0x1111111111111111111111111111111111111111 | $60 | All local checks passed | PR-9420EE6E259E76A9
[VaultProof] ALLOW | token_transfer → 0x1111111111111111111111111111111111111111 | $60 | All local checks passed | PR-C9D793B7E009415E
[VaultProof] ALLOW | token_transfer → 0x1111111111111111111111111111111111111111 | $60 | All local checks passed | PR-418204CD5D394335
[VaultProof] DENY | token_transfer → 0x1111111111111111111111111111111111111111 | $60 | Daily cap $250 would be exceeded | PR-08385D900C1703BA
[VaultProof] HOLD | token_transfer → 0x1111111111111111111111111111111111111111 | $80 | $80 ≥ 75% of per-tx cap — human review | PR-BC2C2B0B73063D80
[VaultProof] ALLOW | token_transfer → 0x1111111111111111111111111111111111111111 | $80 | $80 ≥ 75% of per-tx cap — human review → human approved | PR-1FE1BB6149DDF5D6
[VaultProof] DENY | token_transfer → 0x1111111111111111111111111111111111111111 | $80 | $80 ≥ 75% of per-tx cap — human review → human denied | PR-4B7A020DBE1C07BF
[VaultProof] ALLOW | token_transfer → 0x1111111111111111111111111111111111111111 | $20 | All local checks passed | PR-170F4B164738E315
[VaultProof] ALLOW | approve → 0x1111111111111111111111111111111111111111 | $0 | All local checks passed | PR-82D0877C933C41CE
[VaultProof] HOLD | token_transfer → 0x1111111111111111111111111111111111111111 | $20 | Gate unreachable — fail-closed | PR-E7F8645E491587F4

--------------------------------------------------------------------------------
PASS  | expected DENY  got DENY  | Unlimited ERC-20 approval (approve spender, 2^256-1)
PASS  | expected DENY  got DENY  | setApprovalForAll to NON-allowlisted operator
PASS  | expected DENY  got DENY  | Transfer to NON-allowlisted destination
PASS  | expected DENY  got DENY  | Transfer exceeding per-tx cap ($500 > $100)
PASS  | expected DENY  got DENY  | Parameter mutation: destination swapped to attacker after intent
PASS  | expected DENY  got DENY  | Daily-cap accumulation: 3rd sub-cap transfer breaks the daily ceiling
PASS  | expected HOLD  got HOLD  | Borderline amount at HOLD threshold ($80 >= 75% of $100), no approver
PASS  | expected ALLOW got ALLOW | HOLD then HUMAN APPROVES -> ALLOW
PASS  | expected DENY  got DENY  | HOLD then HUMAN DENIES -> DENY
PASS  | expected ALLOW got ALLOW | Legitimate small transfer to allowlisted addr under threshold
PASS  | expected ALLOW got ALLOW | setApprovalForAll to ALLOWLISTED operator (not a drain) -> ALLOW
PASS  | expected HOLD  got HOLD  | Fail-closed: hosted gate unreachable -> HOLD (never silently ALLOW)
--------------------------------------------------------------------------------

12/12 passed
```
