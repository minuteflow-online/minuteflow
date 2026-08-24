/**
 * What the bot says to a VA at the start and end of their day.
 *
 * Three things every line carries: that they belong on this team, that their
 * work has a purpose, and that it makes a real difference to someone.
 *
 * Two rules shaped both lists. Nothing praises output — being told to smash
 * targets is pressure rather than encouragement, and the person reading it may
 * be having a hard day. And nothing references being watched: the same bot
 * carries the idle and screenshot notices, so a cheerful line about tracking
 * would land badly right beside them.
 *
 * Impact is kept honest and unquantified. "You saved the client hours today"
 * would be a claim the bot cannot support, and a VA who knows their day was
 * slow would read it as hollow. "It reached someone" is true of the work
 * regardless of the kind of day it was.
 *
 * Clock-in thanks them for showing up. Clock-out thanks them for the day's
 * work. Both are picked at random each time, so the same person clocking in
 * twice does not get the same words twice, and long enough that a repeat is
 * unlikely within a week.
 */

const ARRIVAL = [
  "Thank you for being here today. This team is not the same without you.",
  "Grateful to have you with us. Your part in this matters.",
  "Thanks for showing up — the work you do here has a purpose.",
  "Glad you are here. There is a reason your seat is yours.",
  "Thank you for giving today your time. It goes somewhere that counts.",
  "It means a lot that you are here. You are part of what makes this work.",
  "Thanks for starting another day with us. You belong here.",
  "Grateful for you. What you do fits into something bigger than a task list.",
  "Thank you for choosing to be here today. This place needs you in it.",
  "Good to have you back. Things move better when you are here.",
  "Thanks for turning up. You are a real part of this team, not a spare one.",
  "Appreciate you being here. Your work reaches further than you see.",
  "Thank you for being here. What you do today lands on someone's desk and helps them.",
  "Glad you are here. The work you do changes how someone's day goes.",
  "Thank you for the care you bring. It shows, and it matters.",
  "Glad to see you. Take today at your own pace — you have a place here either way.",
  "Thanks for being part of this team. That is not a small thing.",
  "Grateful you are here, whatever kind of day it turns out to be. You still matter to it.",
];

const FAREWELL = [
  "Thank you for today's hard and honest work. It mattered.",
  "That is a day's work done, and it counted for something. Thank you.",
  "Thanks for everything you put in today. This team is better for it.",
  "Honest work, honestly done. That is what holds this place together.",
  "Thank you for showing up and seeing it through. Your part was needed.",
  "Today's effort went somewhere real. Rest well.",
  "Thanks for the care you gave today's work. People feel that.",
  "You gave today what it needed, and it made a difference. Thank you.",
  "Grateful for your work today. It fits into something that matters.",
  "Thank you — that was a real day's work, and a needed one.",
  "Appreciate everything you did today. It did not go unnoticed.",
  "Thanks for another honest day. This team runs on those.",
  "Work well done today. Your part in this is a real one.",
  "What you did today reaches people you will never meet. Thank you.",
  "Today's work leaves things better than it found them. Thank you for that.",
  "Thank you for your time and effort today. Both were worth something.",
  "That is enough for today. What you did was needed. Thank you.",
  "Grateful for the day you put in. Take care of yourself — you matter here.",
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
