# Threat Model & Known Limitations

> **Read this before using VaultProof Agent Guard with anything you can't afford to lose.**
> This is an experimental, unaudited, pre-1.0 reference implementation.

## What the guard is

A **pre-execution policy gate**. Before an AI agent signs a transaction, the
proposed action is evaluated against a boundary profile: spend caps, an
allowlist, drain-vector checks, and a human HOLD path. The result is one of
`ALLOW` / `HOLD` / `DENY`. The guard is **non-custodial** — it never holds keys.

## What it is designed to catch

| Vector | Control | Demonstrated in [BENCHMARK.md](./BENCHMARK.md) |
| ------ | ------- | :--: |
| Unlimited ERC-20 approval (`approve(spender, 2^256-1)`) | `blockUnlimitedApprovals` | ✅ |
| `setApprovalForAll` to a non-allowlisted operator | `blockSetApprovalForAll` | ✅ |
| Sends to unknown / attacker destinations | allowlist | ✅ |
| Oversized single transaction | `perTxMaxUsd` | ✅ |
| Slow-drain across many small transactions | `dailyMaxUsd` window | ✅ |
| Borderline transactions | HOLD → human review | ✅ |
| Gate/dependency failure | fail-closed (HOLD, never silent ALLOW) | ✅ |

## Explicit non-goals / known limitations

These are **real gaps**. Do not assume protection where it is not claimed.

1. **Not audited.** No third-party security review has been performed.
2. **Decision quality depends entirely on inputs.** The guard evaluates the
   `ProposedTx` it is *given*. If your integration passes a wrong or unresolved
   `amountUsd`, `to`, or `calldata` (e.g. a bad price oracle, an unparsed swap
   route, or a proxy that redirects funds), the guard can be misled. **Garbage in,
   garbage out.**
3. **Calldata inspection is signature-level, not full decoding.** It matches known
   drain selectors (`approve` unlimited, `setApprovalForAll`). It does **not**
   simulate execution, decode arbitrary contract calls, detect malicious logic in
   an allowlisted contract, or catch novel drain patterns.
4. **Allowlist is only as good as you make it.** An allowlisted contract that is
   itself malicious or upgradeable can still move funds.
5. **In-memory daily accounting.** The free/local tier tracks daily spend in
   process memory. Restarting the process resets the counter; running multiple
   instances does not share state. This is not a distributed rate limiter.
6. **No on-chain enforcement.** The guard is an off-chain check that runs *before*
   signing. It cannot claw back or block a transaction that bypasses it. If your
   agent can sign without calling `verify()`, the guard provides no protection.
7. **HOLD channel trust.** The Telegram HOLD path trusts the configured chat/bot.
   Compromise of that channel compromises the approval step.
8. **Signed ProofRecords prove integrity relative to the operator's key — not
   who the operator is.** When a `signer` is configured, every terminal decision is
   written to an append-only, hash-chained ledger and signed with an ed25519 operator
   key. The bundled offline verifier (`vaultproof-verify`) detects any edit, deletion,
   reorder, or forgery **without trusting RF servers**. What signing does **not** do:
   it does not attest *whose* key signed. Anyone can generate a keypair, so a
   self-signed local ledger proves "these records were produced by the holder of this
   key and have not been altered" — it does not prove the holder is a particular
   company. Binding a key to a real-world identity (independent trust anchor +
   transparency log, so a counterparty need not trust the operator's own say-so) is
   the **hosted-tier** value-add. The cryptography is identical in both tiers; only
   the trust anchor differs. See `PROOFRECORD.md`.
9. **No replay/nonce protection at the chain layer.** The guard issues a fresh
   record id per `verify()` call; it does not manage on-chain nonces or prevent a
   signed transaction from being broadcast more than once.
10. **Regulatory status is not determined by architecture alone.** "Non-custodial"
    reduces some risks but does not by itself place any deployment outside
    financial regulation. Operators are responsible for their own legal and
    compliance analysis based on their actual operations, fees, and jurisdictions.

## Correct usage assumptions

- The agent's signer **must** be wired so that **every** signing path calls
  `verify()` first and refuses to sign on `DENY` (and on unresolved `HOLD`).
- Inputs to `verify()` must be **resolved and accurate** (real USD value, real
  destination, real calldata).
- Treat this as **defence-in-depth**, not a sole safeguard. Combine with a
  hardware/threshold signer, spending limits at the wallet layer, and monitoring.

## Responsible disclosure

Found a bypass? Please report privately — see [SECURITY.md](./SECURITY.md).
