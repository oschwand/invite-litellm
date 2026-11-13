// 8-char cryptographically random invite code — the format the invite
// redemption backend expects in {origin}/invite/{team_id}/{code}.
export function randomInviteCode(length = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => chars[value % chars.length]).join("");
}
