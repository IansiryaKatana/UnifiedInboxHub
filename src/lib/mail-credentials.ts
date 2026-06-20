/** Gmail/Apple app passwords are often pasted with spaces — strip before sending to the server. */
export function normalizeMailboxPassword(plain: string): string {
  return plain.trim().replace(/\s+/g, "");
}
