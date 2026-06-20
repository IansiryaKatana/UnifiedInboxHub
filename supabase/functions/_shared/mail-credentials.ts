/** Gmail/Apple app passwords are often pasted with spaces — IMAP/SMTP auth needs them removed. */
export function normalizeMailboxPassword(plain: string): string {
  return plain.trim().replace(/\s+/g, "");
}
