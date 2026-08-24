/**
 * What the bot says to a VA at the start and end of their day.
 *
 * Two rules shaped both lists. Nothing praises output — being told to smash
 * targets is pressure rather than encouragement, and the person reading it may
 * be having a hard day. And nothing references being watched: the same bot
 * carries the idle and screenshot notices, so a cheerful line about tracking
 * would land badly right beside them.
 *
 * Clock-in thanks them for showing up. Clock-out thanks them for the day's
 * work. Both are picked at random each time, so the same person clocking in
 * twice does not get the same words twice, and long enough that a repeat is
 * unlikely within a week.
 */

const ARRIVAL = [
  "Thank you for being here today.",
  "Grateful to have you on the team.",
  "Thanks for showing up — it matters more than you know.",
  "Glad you are here. Today is better for it.",
  "Thank you for giving today your time.",
  "It means a lot that you are here.",
  "Thanks for starting another day with us.",
  "Grateful for you and the work you do.",
  "Thank you for choosing to be here today.",
  "Good to have you back. Genuinely.",
  "Thanks for turning up — that is the hard part.",
  "Appreciate you being here today.",
  "Thank you for the care you bring to this.",
  "Glad to see you. Take today at your own pace.",
  "Thanks for being part of this team.",
  "Grateful you are here, whatever kind of day it turns out to be.",
];

const FAREWELL = [
  "Thank you for today's hard and honest work.",
  "That is a day's work done. Thank you.",
  "Thanks for everything you put in today.",
  "Honest work, honestly done. Thank you.",
  "Thank you for showing up and seeing it through.",
  "Today's effort is appreciated. Rest well.",
  "Thanks for the care you gave today's work.",
  "You gave today what it needed. Thank you.",
  "Grateful for your work today. Enjoy your evening.",
  "Thank you — that was a real day's work.",
  "Appreciate everything you did today. Go rest.",
  "Thanks for another honest day. It counts.",
  "Work well done today. Thank you for it.",
  "Thank you for your time and effort today.",
  "That is enough for today. Thank you.",
  "Grateful for the day you put in. Take care of yourself.",
];

function pick(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)];
}

/** A thank-you for arriving. */
export function clockInGreeting(): string {
  return pick(ARRIVAL);
}

/** A thank-you for the day's work. */
export function clockOutGreeting(): string {
  return pick(FAREWELL);
}

/** Morning, afternoon or evening in the org's timezone — not the server's. */
export function timeOfDayGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
