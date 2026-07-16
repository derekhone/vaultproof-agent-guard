# Security Policy

## Status

**VaultProof Agent Guard is experimental, pre-1.0 software.** It has **not** been
independently security audited. Do **not** use it as the sole control protecting
production funds. See [THREAT_MODEL.md](./THREAT_MODEL.md) for known limitations.

## Supported versions

Only the latest `0.x` release receives security fixes. Pre-1.0 minor versions may
introduce breaking changes.

| Version | Supported |
| ------- | --------- |
| latest `0.x` | ✅ |
| older `0.x`  | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately via one of:

1. **GitHub Security Advisories** — open a draft advisory at
   `Security → Advisories → Report a vulnerability` on this repository
   (preferred; keeps the report private until a fix ships).
2. **Email** — security@remnantfieldworks.com with subject
   `[VaultProof] vulnerability report`.

Please include:

- affected version / commit,
- a description and, ideally, a minimal reproduction,
- the impact you believe it has.

## What to expect

- **Acknowledgement:** within 5 business days.
- **Assessment & triage:** we will confirm the issue and share a remediation plan.
- **Fix & disclosure:** coordinated disclosure once a patch is available. We are
  happy to credit reporters who wish to be named.

Because this is a small, pre-1.0 project maintained on a best-effort basis, we
cannot commit to formal SLAs, but we take drain-vector and fail-open reports
seriously and will prioritise them.

## Handling secrets

- Never commit `.env`, private keys, bot tokens, or API keys. `.gitignore`
  excludes `.env`; only `.env.example` (placeholders) is tracked.
- If you believe a credential was exposed, **revoke and rotate it immediately**,
  then check the repository's Settings → Security log and commit history.
