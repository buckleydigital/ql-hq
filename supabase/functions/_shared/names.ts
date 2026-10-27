// Is this account plainly theirs? Matching an Instagram account or a Facebook
// Page to a client by name, the same rule everywhere: equal once tidied up, or
// a typo or two apart.

// "Smith's Solar Pty Ltd", "@smithssolar" and "smithssolar.au" all become
// "smithssolar".
export const squash = (s: string) => s.toLowerCase().replace(/\b(pty|ltd|limited|co|inc|au|official)\b/g, "")
  .replace(/[^a-z0-9]/g, "").replace(/(official|aus|au)$/, "");

/** The same name, or one a typo or two away (at least 85% alike). Both squashed. */
export function sameName(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - d[b.length] / Math.max(a.length, b.length) >= 0.85;
}

/** Whether any of the names matches any of the wanted ones. */
export const anyNameMatches = (names: unknown[], wanted: unknown[]) => {
  const want = wanted.map((w) => squash(String(w ?? ""))).filter((w) => w.length >= 3);
  return names.some((n) => want.some((w) => sameName(squash(String(n ?? "")), w)));
};
