/**
 * The extension build the app expects VAs to be running.
 *
 * Bump this whenever extension/manifest.json gets a version that VAs must
 * actually have — anyone reporting older sees a prompt to reinstall. 1.2.0 is
 * the build that captures on a 5-minute schedule, records idle slots, and fixes
 * the duplicate-upload race; older builds keep the 1-minute alarm.
 */
export const EXTENSION_MIN_VERSION = "1.2.0";

/**
 * The newest build published to the store — keep in step with
 * extension/manifest.json.
 *
 * Separate from EXTENSION_MIN_VERSION on purpose. This one is only used to
 * report who has not picked up the latest yet, so bumping it is harmless.
 * EXTENSION_MIN_VERSION is the hard floor that makes VAs see a reinstall
 * prompt, so it should only move when a build is genuinely required.
 */
export const EXTENSION_LATEST_VERSION = "1.2.2";

/**
 * The Chrome Web Store listing. This is where VAs should install from: a store
 * install auto-updates itself, while the load-unpacked route on /install goes
 * stale the moment a new version ships and has to be redone by hand.
 *
 * Publishing a new version here is what actually moves the fleet — most VAs are
 * on the store build and will pick it up on their own.
 */
export const EXTENSION_STORE_URL =
  "https://chromewebstore.google.com/detail/minuteflow-screen-capture/lmfgamnipididbdgehimnbhmoodclack";

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
