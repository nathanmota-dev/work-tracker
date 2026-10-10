/**
 * Withdrawal runs through Chrome MCP in the outreach skill. The CLI has no
 * browser, so this stub returns false and callers record the result as unconfirmed.
 */
export async function withdrawInvitation(username: string): Promise<boolean> {
  void username;
  return false;
}
