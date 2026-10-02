import { describe, it, expect } from "vitest";
import { isValidProcessingFee } from "@/lib/processingFee";

// Mirrors how src/app/invoice/pay/[token]/page.tsx works the fee out.
const cardFee = (amount: number) => Math.round(amount * 0.03 * 100) / 100;
const achFee = (amount: number) => Math.round(amount * 0.01 * 100) / 100;

describe("isValidProcessingFee", () => {
  it("accepts the fee the page works out for a card payment", () => {
    for (const amount of [0.01, 0.5, 1, 33.33, 99.99, 250, 1000, 1456.6, 12345.67]) {
      expect(isValidProcessingFee(amount, cardFee(amount)), `card ${amount}`).toBe(true);
    }
  });

  it("accepts the fee the page works out for a bank transfer", () => {
    for (const amount of [0.01, 0.5, 1, 33.33, 99.99, 250, 1000, 1456.6, 12345.67]) {
      expect(isValidProcessingFee(amount, achFee(amount)), `ach ${amount}`).toBe(true);
    }
  });

  it("rejects a negative fee that would charge less than the amount credited", () => {
    expect(isValidProcessingFee(1000, -999)).toBe(false);
    expect(isValidProcessingFee(1000, -0.01)).toBe(false);
  });

  it("rejects skipping the fee on a real payment", () => {
    expect(isValidProcessingFee(1000, 0)).toBe(false);
    expect(isValidProcessingFee(100, 0)).toBe(false);
  });

  it("rejects a fee above the card rate", () => {
    expect(isValidProcessingFee(1000, 100)).toBe(false);
    expect(isValidProcessingFee(1000, 1000)).toBe(false);
  });

  it("rejects values that are not usable numbers", () => {
    expect(isValidProcessingFee(1000, NaN)).toBe(false);
    expect(isValidProcessingFee(1000, Infinity)).toBe(false);
    expect(isValidProcessingFee(NaN, 30)).toBe(false);
    expect(isValidProcessingFee(0, 0)).toBe(false);
    expect(isValidProcessingFee(-100, 3)).toBe(false);
  });
});
