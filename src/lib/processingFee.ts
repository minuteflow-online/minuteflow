// The public invoice payment page adds a processing fee on top of what the
// payer is paying toward the invoice: 3% for a card, 1% for a bank transfer
// (ACH), rounded to cents. The browser sends that fee along with the amount,
// so the server has to check it. A negative fee used to go straight through:
// the card was charged amount + fee while the invoice was credited the full
// amount, so a -$999 fee on a $1,000 payment charged $1 and marked $1,000 paid.

export const MIN_PROCESSING_FEE_RATE = 0.01; // bank transfer
export const MAX_PROCESSING_FEE_RATE = 0.03; // card

// The page rounds each fee to the nearest cent, so allow a couple of cents of
// slack either side of the exact rate.
const ROUNDING_TOLERANCE = 0.02;

/** True when `fee` is a fee the payment page could actually have produced for
 * a payment of `amount`: between the bank-transfer and card rates. */
export function isValidProcessingFee(amount: number, fee: number): boolean {
  if (!Number.isFinite(amount) || !Number.isFinite(fee)) return false;
  if (amount <= 0 || fee < 0) return false;
  const min = amount * MIN_PROCESSING_FEE_RATE - ROUNDING_TOLERANCE;
  const max = amount * MAX_PROCESSING_FEE_RATE + ROUNDING_TOLERANCE;
  return fee >= min && fee <= max;
}
