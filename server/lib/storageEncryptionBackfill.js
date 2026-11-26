// ═══════════════════════════════════════════════════════════════════════════
// Startup message-body encryption backfill — pure decision layer.
//
// `server/index.js` walks every non-empty chat_messages.body on boot and
// encrypts legacy plaintext. The decision of WHETHER a row needs encryption
// lives here, I/O-free, so it can be regression-tested: the row update that
// follows MUST address the row by its RAW id — message ids are TEXT UUIDs
// since migration 036, and one draft converted them through Number(), whose
// NaN silently matched no rows and left plaintext unencrypted on every boot.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Decide whether a chat_messages row's body needs encryption.
 *
 * @param {object} row  { id, body } — id is the RAW database value (UUID string)
 * @param {object} crypto  the storageEncryption surface
 * @param {function} crypto.isSystemMessageBody
 * @param {function} crypto.isEncryptedText
 * @param {function} crypto.decryptText
 * @param {function} crypto.encryptText
 * @returns {{ id: *, body: string } | null} null = leave the row untouched;
 *          otherwise update body WHERE id = plan.id (raw — never Number()).
 */
export function planMessageBodyEncryption(row, crypto) {
  const body = String(row?.body || "");
  if (!body || crypto.isSystemMessageBody(body)) return null;

  // Valid ciphertext must remain untouched, while legacy plaintext that
  // merely imitates the ciphertext prefix is encrypted on startup.
  const isValidCiphertext =
    crypto.isEncryptedText(body) && crypto.decryptText(body) !== body;
  if (isValidCiphertext) return null;

  const nextBody = crypto.encryptText(body);
  if (nextBody === body) return null;

  // The id travels RAW so the caller's WHERE clause matches the real row.
  // Never Number(id): Number("uuid") is NaN.
  return { id: row.id, body: nextBody };
}
