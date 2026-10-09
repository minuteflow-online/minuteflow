import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { checkResendWebhook, verifyResendSignature } from "@/lib/resendWebhook";

// A made-up secret in the same shape Resend gives out: "whsec_" + base64.
const SECRET = "whsec_" + Buffer.from("test-signing-secret-bytes").toString("base64");
const NOW = 1_800_000_000;

function sign(body: string, id: string, ts: string, secret = SECRET) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
}

function headers(h: Record<string, string>) {
  return { get: (name: string) => h[name.toLowerCase()] ?? null };
}

const body = JSON.stringify({ type: "email.opened", data: { email_id: "abc", to: "a@b.test" } });

function request(overrides: Partial<Record<string, string>> = {}, rawBody = body) {
  const id = "msg_1";
  const ts = String(NOW);
  return {
    rawBody,
    headers: headers({
      "svix-id": id,
      "svix-timestamp": ts,
      "svix-signature": sign(body, id, ts),
      ...overrides,
    }),
    nowSeconds: NOW,
  };
}

describe("checkResendWebhook", () => {
  it("accepts a correctly signed request", () => {
    expect(checkResendWebhook({ ...request(), secret: SECRET })).toEqual({ ok: true });
  });

  it("accepts it when the header lists several signatures and one matches", () => {
    const good = sign(body, "msg_1", String(NOW));
    const h = request({ "svix-signature": `v1,bm9wZQ== ${good}` });
    expect(checkResendWebhook({ ...h, secret: SECRET })).toEqual({ ok: true });
  });

  it("rejects every request when the secret is not set", () => {
    for (const secret of [undefined, ""]) {
      const result = checkResendWebhook({ ...request(), secret });
      expect(result).toEqual({ ok: false, error: "Webhook secret is not configured" });
    }
  });

  it("rejects a request with no signature headers", () => {
    const result = checkResendWebhook({
      rawBody: "{}",
      headers: headers({}),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, error: "Missing webhook signature headers" });
  });

  it("rejects a request missing any one of the three headers", () => {
    for (const name of ["svix-id", "svix-timestamp", "svix-signature"]) {
      const result = checkResendWebhook({ ...request({ [name]: "" }), secret: SECRET });
      expect(result.ok, name).toBe(false);
    }
  });

  it("rejects a wrong signature, and a signature made with another secret", () => {
    const wrong = request({ "svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" });
    expect(checkResendWebhook({ ...wrong, secret: SECRET })).toEqual({
      ok: false,
      error: "Invalid webhook signature",
    });
    const otherSecret = "whsec_" + Buffer.from("someone-elses-secret").toString("base64");
    const forged = request({ "svix-signature": sign(body, "msg_1", String(NOW), otherSecret) });
    expect(checkResendWebhook({ ...forged, secret: SECRET }).ok).toBe(false);
  });

  it("rejects a body that was changed after signing", () => {
    const tampered = request({}, body.replace("email.opened", "email.clicked"));
    expect(checkResendWebhook({ ...tampered, secret: SECRET }).ok).toBe(false);
  });

  it("rejects a signature version other than v1", () => {
    const sig = sign(body, "msg_1", String(NOW)).replace("v1,", "v2,");
    expect(checkResendWebhook({ ...request({ "svix-signature": sig }), secret: SECRET }).ok).toBe(false);
  });

  it("rejects a timestamp more than five minutes away, either direction", () => {
    for (const offset of [-301, 301]) {
      const ts = String(NOW + offset);
      const h = request({ "svix-timestamp": ts, "svix-signature": sign(body, "msg_1", ts) });
      expect(checkResendWebhook({ ...h, secret: SECRET }), String(offset)).toEqual({
        ok: false,
        error: "Webhook timestamp too old",
      });
    }
  });

  it("accepts a timestamp just inside the window", () => {
    const ts = String(NOW - 299);
    const h = request({ "svix-timestamp": ts, "svix-signature": sign(body, "msg_1", ts) });
    expect(checkResendWebhook({ ...h, secret: SECRET }).ok).toBe(true);
  });

  it("rejects a timestamp that is not a number", () => {
    const h = request({ "svix-timestamp": "yesterday", "svix-signature": sign(body, "msg_1", "yesterday") });
    expect(checkResendWebhook({ ...h, secret: SECRET }).ok).toBe(false);
  });
});

describe("verifyResendSignature", () => {
  it("returns false instead of throwing on a malformed signature", () => {
    expect(verifyResendSignature(body, "id", "1", "not-a-signature", SECRET)).toBe(false);
    expect(verifyResendSignature(body, "id", "1", "v1,", SECRET)).toBe(false);
  });
});
