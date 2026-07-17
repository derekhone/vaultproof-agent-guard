// vaultproof-agent-guard/src/keys.ts
//
// Operator-sovereign key management for signed ProofRecords.
//
// Uses Node's BUILT-IN ed25519 (crypto.generateKeyPairSync('ed25519')) — no
// external dependencies, matching the zero-dependency ethos of the local tier.
//
// The key is held BY THE OPERATOR. VaultProof (Remnant Fieldworks) never sees
// it. That is the whole point: records signed with this key are verifiable by
// anyone who has the corresponding PUBLIC key, WITHOUT trusting RF's servers.
//
// Local (operator-signed) vs. hosted (RF-anchored) is a trust-anchor
// distinction, not a capability one — see PROOFRECORD.md.

import crypto from "crypto";
import fs from "fs";
import path from "path";

/** Something that can sign ProofRecord digests. */
export interface Signer {
  /** Short, stable identifier for the signing key (hex, derived from the public key). */
  readonly keyId: string;
  /** PEM-encoded SPKI public key, safe to publish/share for verification. */
  readonly publicKeyPem: string;
  /** ed25519 signature over `data`, returned base64. */
  sign(data: Buffer | string): string;
}

/** Verifies signatures against a known public key. */
export interface Verifier {
  readonly keyId: string;
  readonly publicKeyPem: string;
  verify(data: Buffer | string, signatureB64: string): boolean;
}

const toBuf = (d: Buffer | string): Buffer =>
  Buffer.isBuffer(d) ? d : Buffer.from(d, "utf8");

/**
 * Derive a stable key id from a public key: first 16 bytes of the SHA-256 of
 * the SPKI DER encoding, hex-encoded. Same public key => same keyId, always.
 */
export function keyIdFromPublicKey(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return crypto.createHash("sha256").update(der).digest("hex").slice(0, 32);
}

/** Build a Signer from an in-memory ed25519 private KeyObject. */
export function signerFromPrivateKey(privateKey: crypto.KeyObject): Signer {
  const publicKey = crypto.createPublicKey(privateKey);
  const keyId = keyIdFromPublicKey(publicKey);
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  return {
    keyId,
    publicKeyPem,
    sign(data: Buffer | string): string {
      return crypto.sign(null, toBuf(data), privateKey).toString("base64");
    },
  };
}

/** Build a Signer from a PEM-encoded PKCS8 ed25519 private key. */
export function signerFromPrivateKeyPem(pem: string): Signer {
  return signerFromPrivateKey(crypto.createPrivateKey(pem));
}

/** Generate a brand-new operator signing key. */
export function generateSigner(): Signer & { privateKeyPem: string } {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const signer = signerFromPrivateKey(privateKey);
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return Object.assign(Object.create(Object.getPrototypeOf(signer)), signer, {
    privateKeyPem,
  });
}

/** Build a Verifier from a PEM-encoded SPKI ed25519 public key. */
export function verifierFromPublicKeyPem(pem: string): Verifier {
  const publicKey = crypto.createPublicKey(pem);
  const keyId = keyIdFromPublicKey(publicKey);
  return {
    keyId,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
    verify(data: Buffer | string, signatureB64: string): boolean {
      try {
        return crypto.verify(
          null,
          toBuf(data),
          publicKey,
          Buffer.from(signatureB64, "base64"),
        );
      } catch {
        return false;
      }
    },
  };
}

/**
 * Load an operator signing key from `keyPath` (PEM PKCS8), or generate + persist
 * one on first use. The private key is written with 0600 permissions.
 *
 * This lets an operator get signed, verifiable ProofRecords with zero setup,
 * while keeping the private key entirely on their own machine.
 */
export function loadOrCreateSigner(keyPath: string): Signer {
  if (fs.existsSync(keyPath)) {
    return signerFromPrivateKeyPem(fs.readFileSync(keyPath, "utf8"));
  }
  const gen = generateSigner();
  fs.mkdirSync(path.dirname(path.resolve(keyPath)), { recursive: true });
  fs.writeFileSync(keyPath, gen.privateKeyPem, { mode: 0o600 });
  // Persist the public key alongside for easy sharing with verifiers.
  fs.writeFileSync(keyPath + ".pub", gen.publicKeyPem, { mode: 0o644 });
  return gen;
}
