/**
 * The extension build the app expects VAs to be running.
 *
 * Bump this whenever extension/manifest.json gets a version that VAs must
 * actually have — anyone reporting older sees a prompt to reinstall. 1.2.0 is
 * the build that captures on a 5-minute schedule, records idle slots, and fixes
 * the duplicate-upload race; older builds keep the 1-minute alarm.
 */
export const EXTENSION_MIN_VERSION = "1.2.0";

/** True when semver string `version` is strictly older than `target`. */
export function isVersionOlder(version: string, target: string): boolean {
  const a = version.split(".").map((n) => parseInt(n, 10) || 0);
  const b = target.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai < bi) return true;
    if (ai > bi) return false;
  }
  return false;
}
