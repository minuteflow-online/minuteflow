import { esc } from "@/lib/telegram";

/**
 * What the team chat says when someone hands work in.
 *
 * The counterweight to everything else the bot does. Idle checks, screenshot
 * warnings and clock-outs all only speak when something is wrong; without this
 * the bot is purely a thing that tells people off, and people stop wanting it
 * around. Work landing is the most common good thing that happens all day and
 * it was going unremarked.
 *
 * Shape: a bold headline, then who and what. One thin sentence — "X came
 * through. Submission is in!" — scrolled past like any other line of chat, and
 * it never said what had actually been handed in, which is the part worth
 * being pleased about. Naming the work is what makes it a moment rather than a
 * notification.
 *
 * Rules the lines follow:
 *   - Name the person. "A submission was received" celebrates nobody.
 *   - Praise the act of submitting, not the quality of the work. Nobody has
 *     looked at it yet, and "great job on that" before review is hollow the
 *     moment a revision comes back.
 *   - No superlatives and no comparisons. This fires several times a day, and
 *     anything that reads as a ranking turns the chat into a scoreboard.
 */

/** Headline and body are drawn separately, so repeats are rare in practice. */
const HEADLINES = [
  "🎉 <b>Submission in!</b>",
  "🙌 <b>That's in!</b>",
  "🚀 <b>Work just landed!</b>",
  "⚡ <b>Another one in!</b>",
  "✨ <b>Handed in!</b>",
  "🔥 <b>That's submitted!</b>",
  "🎯 <b>One more over the line!</b>",
  "💪 <b>Wrapped and sent!</b>",
  "📬 <b>Fresh submission!</b>",
  "🏁 <b>Done and in!</b>",
  "⭐ <b>Work's in!</b>",
  "🥳 <b>Submission landed!</b>",
];

const BODIES = [
  "{name} just sent through {task}.",
  "{name} handed in {task}.",
  "{name} got {task} over the line.",
  "{name} just submitted {task}.",
  "{task} is in, from {name}.",
  "{name} wrapped up {task} and sent it.",
  "{name} put {task} through.",
  "That's {task}, submitted by {name}.",
];

/** Used when the task has no name to show — the moment still gets marked. */
const TASKLESS_BODIES = [
  "{name} just sent work through.",
  "{name} handed something in.",
  "{name} got another one over the line.",
  "{name} just submitted.",
  "Work's in from {name}.",
];

function pick(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * A cheer for one submission, named and picked at random.
 *
 * `name` arrives already escaped or already a mention, so it is interpolated
 * rather than escaped again. `taskName` is raw free text and is escaped here.
 */
export function submissionCheer(name: string, taskName?: string | null): string {
  const trimmed = taskName?.trim();
  const body = trimmed
    ? pick(BODIES).replace("{task}", `“${esc(trimmed)}”`)
    : pick(TASKLESS_BODIES);
  return `${pick(HEADLINES)}\n${body.replace("{name}", name)}`;
}

/**
 * What the team chat says when work is approved.
 *
 * Separate pool from the submission cheer, and warmer. Submitting is showing
 * up; approved means it was looked at and it was right — the difference is
 * worth hearing, and reusing the same lines for both would flatten it. It gets
 * the same bold shape so it does not read as the smaller of the two events.
 *
 * Still no comparisons and no "finally". A congratulation that carries a note
 * of surprise is not one.
 */
const APPROVED_HEADLINES = [
  "🎊 <b>Approved!</b>",
  "✅ <b>Approved!</b>",
  "🌟 <b>That's a yes!</b>",
  "🎉 <b>Signed off!</b>",
  "💫 <b>Approved and done!</b>",
  "🏆 <b>That one's a keeper!</b>",
];

const APPROVED_BODIES = [
  "Congratulations {name} — beautifully done.",
  "{name}, that's how it's done. 👏",
  "Lovely work, {name}.",
  "{name} delivered, and it shows.",
  "Congratulations {name}. Thank you for the care you put in.",
  "Really well done, {name}.",
  "{name} nailed it.",
  "Excellent work, {name}.",
];

/** A congratulation for approved work, named and picked at random. */
export function approvalCheer(name: string): string {
  return `${pick(APPROVED_HEADLINES)}\n${pick(APPROVED_BODIES).replace("{name}", name)}`;
}
