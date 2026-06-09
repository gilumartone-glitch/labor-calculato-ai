// Deterministic per-user color. Same user id => same color forever.
// Returns HSL values tuned for readable badges on light backgrounds.

export function userColor(userId: string | null | undefined): { bg: string; fg: string; border: string } {
  if (!userId) {
    return { bg: "hsl(0 0% 92%)", fg: "hsl(0 0% 20%)", border: "hsl(0 0% 70%)" };
  }
  // FNV-1a 32-bit hash
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = Math.abs(h) % 360;
  return {
    bg: `hsl(${hue} 78% 88%)`,
    fg: `hsl(${hue} 65% 22%)`,
    border: `hsl(${hue} 55% 55%)`,
  };
}
