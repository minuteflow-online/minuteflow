/**
 * The message a VA gets from the bot when they clock in.
 *
 * Two rules shaped this list. Nothing praises output — being told "smash your
 * targets" at 8am is pressure, not encouragement, and the person reading it may
 * be having a hard morning. And nothing references being watched: the same bot
 * carries the idle and screenshot notices, so a cheerful line about tracking
 * would land badly right next to them.
 *
 * What is left is short, warm and about the day rather than the work.
 */
const LINES = [
  "Hope today treats you well.",
  "Good to see you — take it at your own pace.",
  "One thing at a time. That is enough.",
  "Whatever today holds, you have handled harder.",
  "Start where you are. That is always the right place.",
  "A steady day beats a frantic one.",
  "You do not have to do everything at once.",
  "Small steps still get you there.",
  "Be kind to yourself today.",
  "Progress counts, however it looks.",
  "Take the breaks you need — they are part of the work.",
  "Glad you are here.",
  "Today does not have to be perfect to be good.",
  "Trust yourself. You know what you are doing.",
];

/**
 * Picks a line for one person on one day.
 *
 * Deterministic rather than random so a clock-out and clock-in a few minutes
 * apart do not produce a different message and make the whole thing feel
 * mechanical. Seeded with the person and the date, so two people on the same
 * morning see different lines and nobody sees the same one two days running.
 */
export function clockInGreeting(name: string, dateKey: string): string {
  const seed = `${name}:${dateKey}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return LINES[Math.abs(hash) % LINES.length];
}

/** Morning, afternoon or evening in the org's timezone — not the server's. */
export function timeOfDayGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
