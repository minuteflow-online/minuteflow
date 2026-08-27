/**
 * What the team chat says when someone hands work in.
 *
 * The counterweight to everything else the bot does. Idle checks, screenshot
 * warnings and clock-outs all only speak when something is wrong; without this
 * the bot is purely a thing that tells people off, and people stop wanting it
 * around. Work landing is the most common good thing that happens all day and
 * it was going unremarked.
 *
 * Rules the lines follow:
 *   - Name the person. "A submission was received" celebrates nobody.
 *   - Praise the act of submitting, not the quality of the work. Nobody has
 *     looked at it yet, and "great job on that" before review is hollow the
 *     moment a revision comes back.
 *   - No superlatives and no comparisons. This fires several times a day, and
 *     anything that reads as a ranking turns the chat into a scoreboard.
 */

const LINES = [
  "Way to go {name}, your submission is in!",
  "Nice one, {name} — that's submitted.",
  "{name} just sent work through. 🙌",
  "Submitted by {name}. Thank you!",
  "That's in, {name}. Well done.",
  "{name} got another one over the line.",
  "Work's in from {name}. 👏",
  "Good stuff, {name} — submission received.",
  "{name} just handed something in. Thank you!",
  "Another one done, {name}. 🎯",
  "{name} came through. Submission is in!",
  "Sent and safe, {name}. Nice work.",
  "{name} just wrapped one up. 💪",
  "That's a submission from {name}. Thank you!",
  "Job done, {name} — it's in.",
  "{name} delivered. 🚀",
];

/**
 * A cheer for one submission, named and picked at random.
 *
 * `name` is inserted already escaped or already a mention, so it is
 * interpolated rather than escaped again here.
 */
export function submissionCheer(name: string): string {
  const line = LINES[Math.floor(Math.random() * LINES.length)];
  return line.replace("{name}", name);
}

/**
 * What the team chat says when work is approved.
 *
 * Separate pool from the submission cheer, and warmer. Submitting is showing
 * up; approved means it was looked at and it was right — the difference is
 * worth hearing, and reusing the same sixteen lines for both would flatten it.
 *
 * Still no comparisons and no "finally". A congratulation that carries a note
 * of surprise is not one.
 */
const APPROVED_LINES = [
  "Approved! Congratulations {name} 🎉",
  "{name}'s work is approved. Beautifully done.",
  "That's a yes for {name} — congratulations! 🎊",
  "Approved, {name}. That's how it's done. 👏",
  "Congratulations {name}, your work is approved!",
  "{name} nailed it — approved. 🌟",
  "Signed off and approved. Well done, {name}!",
  "{name}'s submission is approved. Excellent work.",
  "Approved! Lovely work, {name}. ✨",
  "That one's a keeper, {name} — approved!",
  "Congratulations {name}. Approved and done. 🙌",
  "{name} delivered and it's approved. Brilliant.",
  "Approved, {name}! Thank you for the care you put in.",
  "That's approved, {name}. Really well done. 💫",
];

/** A congratulation for approved work, named and picked at random. */
export function approvalCheer(name: string): string {
  return APPROVED_LINES[Math.floor(Math.random() * APPROVED_LINES.length)].replace("{name}", name);
}
