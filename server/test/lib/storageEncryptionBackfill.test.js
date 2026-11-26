import { describe, expect, test } from "vitest";
import { planMessageBodyEncryption } from "../../lib/storageEncryptionBackfill.js";

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — migration 036 made chat_messages ids TEXT UUIDs. The startup
// encryption backfill once addressed its UPDATE with Number(row.id), i.e.
// NaN for every real message, so legacy plaintext bodies silently stayed
// unencrypted forever. These tests pin the planner contract: a row that
// needs encryption yields a plan carrying the RAW (never Number-coerced) id.
// ─────────────────────────────────────────────────────────────────────────────

const UUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function makeCrypto({ ciphertextWorks = true } = {}) {
  return {
    isSystemMessageBody: (body) => body.startsWith("[system]"),
    isEncryptedText: (body) => body.startsWith("enc:v1:"),
    decryptText: (body) => (ciphertextWorks && body.startsWith("enc:v1:") ? "decrypted" : body),
    encryptText: (body) => `enc:v1:${body}`,
  };
}

describe("planMessageBodyEncryption", () => {
  test("plans encryption for plaintext with the RAW UUID id (never Number-coerced)", () => {
    const plan = planMessageBodyEncryption(
      { id: UUID, body: "hello world" },
      makeCrypto(),
    );
    expect(plan).not.toBeNull();
    expect(plan.id).toBe(UUID); // raw string — Number() would make this NaN
    expect(typeof plan.id).toBe("string");
    expect(plan.body).toBe(`enc:v1:hello world`);
  });

  test("keeps valid ciphertext untouched", () => {
    const plan = planMessageBodyEncryption(
      { id: UUID, body: "enc:v1:already-secret" },
      makeCrypto(),
    );
    expect(plan).toBeNull();
  });

  test("encrypts fake ciphertext that does not decrypt (legacy plaintext imitation)", () => {
    const plan = planMessageBodyEncryption(
      { id: UUID, body: "enc:v1:not-really-encrypted" },
      makeCrypto({ ciphertextWorks: false }),
    );
    expect(plan).not.toBeNull();
    expect(plan.id).toBe(UUID);
    expect(plan.body).toBe("enc:v1:enc:v1:not-really-encrypted");
  });

  test("skips system messages and empty bodies", () => {
    expect(planMessageBodyEncryption({ id: UUID, body: "[system] ping" }, makeCrypto())).toBeNull();
    expect(planMessageBodyEncryption({ id: UUID, body: "" }, makeCrypto())).toBeNull();
    expect(planMessageBodyEncryption({ id: UUID, body: null }, makeCrypto())).toBeNull();
    expect(planMessageBodyEncryption(null, makeCrypto())).toBeNull();
  });

  test("plans nothing when encryption is a no-op for the body", () => {
    const crypto = makeCrypto();
    crypto.encryptText = (body) => body; // no-op encryption
    expect(planMessageBodyEncryption({ id: UUID, body: "same" }, crypto)).toBeNull();
  });
});
