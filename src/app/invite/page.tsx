"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

type Step = "loading" | "invalid" | "account" | "payment" | "success";

function InviteForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = searchParams.get("code") || "";

  const [step, setStep] = useState<Step>("loading");
  const [lockedEmail, setLockedEmail] = useState("");
  const [invalidReason, setInvalidReason] = useState("");

  // Account step
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Payment step
  const [paymentMethod, setPaymentMethod] = useState<"gcash" | "bank" | "none">("none");
  const [gcashNumber, setGcashNumber] = useState("");
  const [gcashName, setGcashName] = useState("");
  const [gcashCity, setGcashCity] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Validate code on mount
  useEffect(() => {
    if (!code) {
      setInvalidReason("No invite code found. Please use the link from your invitation email.");
      setStep("invalid");
      return;
    }

    fetch(`/api/invitations?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
          setLockedEmail(data.email);
          setStep("account");
        } else {
          setInvalidReason(data.reason || "Invalid invite link.");
          setStep("invalid");
        }
      })
      .catch(() => {
        setInvalidReason("Unable to validate invite. Please check your connection and try again.");
        setStep("invalid");
      });
  }, [code]);

  const validateAccount = () => {
    if (!fullName.trim()) return "Full name is required.";
    if (!username.trim()) return "Username is required.";
    if (username.length < 3) return "Username must be at least 3 characters.";
    if (!/^[a-z0-9_]+$/.test(username)) return "Username can only contain lowercase letters, numbers, and underscores.";
    if (!password) return "Password is required.";
    if (password.length < 6) return "Password must be at least 6 characters.";
    if (password !== confirmPassword) return "Passwords do not match.";
    return null;
  };

  const handleAccountNext = () => {
    const err = validateAccount();
    if (err) { setError(err); return; }
    setError("");
    setStep("payment");
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          password,
          username,
          full_name: fullName,
          payment_method: paymentMethod,
          gcash_number: gcashNumber || undefined,
          gcash_name: gcashName || undefined,
          gcash_city: gcashCity || undefined,
          bank_name: bankName || undefined,
          bank_account_number: bankAccountNumber || undefined,
          bank_account_name: bankAccountName || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      setStep("success");
    } catch {
      setError("Unable to connect. Please check your connection and try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-12">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-bold text-ink">
            Minute<span className="italic text-terracotta">Flow</span>
          </h1>
          <p className="mt-1 text-sm text-bark">Time tracking for virtual assistants</p>
        </div>

        <div className="rounded-lg border border-sand bg-white p-8 shadow-sm">

          {/* ── Loading ── */}
          {step === "loading" && (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-sand border-t-terracotta" />
              <p className="text-sm text-bark">Validating your invite…</p>
            </div>
          )}

          {/* ── Invalid ── */}
          {step === "invalid" && (
            <div className="py-4 text-center">
              <div className="mb-4 text-4xl">⚠️</div>
              <h2 className="mb-2 font-serif text-lg font-bold text-espresso">Invite Not Valid</h2>
              <p className="mb-6 text-sm text-bark">{invalidReason}</p>
              <p className="text-sm text-stone">
                Please contact your team admin for a new invite link.
              </p>
            </div>
          )}

          {/* ── Step 1: Account ── */}
          {step === "account" && (
            <>
              <div className="mb-6">
                <h2 className="font-serif text-xl font-bold text-espresso">Create your account</h2>
                <p className="mt-1 text-sm text-bark">Step 1 of 2</p>
              </div>

              {/* Progress dots */}
              <StepDots current={1} total={2} />

              {error && (
                <div className="mb-4 rounded-md bg-terracotta-soft px-3 py-2 text-sm text-terracotta">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {/* Email (locked) */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-espresso">Email</label>
                  <input
                    type="email"
                    value={lockedEmail}
                    disabled
                    className="w-full rounded-md border border-sand bg-parchment px-3 py-2 text-sm text-stone cursor-not-allowed"
                  />
                  <p className="mt-1 text-[11px] text-stone">Your email is locked to this invite.</p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-espresso">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-espresso">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                    placeholder="e.g. arianne_va"
                    className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-espresso">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-espresso">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                  />
                </div>

                <button
                  onClick={handleAccountNext}
                  className="w-full rounded-md bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90"
                >
                  Continue →
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Payment ── */}
          {step === "payment" && (
            <>
              <div className="mb-6">
                <h2 className="font-serif text-xl font-bold text-espresso">Payment info</h2>
                <p className="mt-1 text-sm text-bark">Step 2 of 2 · For receiving your pay</p>
              </div>

              <StepDots current={2} total={2} />

              {error && (
                <div className="mb-4 rounded-md bg-terracotta-soft px-3 py-2 text-sm text-terracotta">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {/* Payment method selector */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-espresso">Payment Method</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["gcash", "bank", "none"] as const).map((m) => {
                      const labels = { gcash: "GCash", bank: "Bank", none: "Skip for now" };
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPaymentMethod(m)}
                          className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-all cursor-pointer ${
                            paymentMethod === m
                              ? "border-terracotta bg-terracotta-soft text-terracotta"
                              : "border-sand bg-parchment/50 text-bark hover:border-terracotta/40"
                          }`}
                        >
                          {labels[m]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* GCash fields */}
                {paymentMethod === "gcash" && (
                  <div className="space-y-3 rounded-lg border border-sand bg-parchment/20 p-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-espresso">
                        GCash Number <span className="text-terracotta">*</span>
                      </label>
                      <input
                        type="tel"
                        value={gcashNumber}
                        onChange={(e) => setGcashNumber(e.target.value)}
                        placeholder="09XXXXXXXXX"
                        className="w-full rounded-md border border-sand bg-white px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-espresso">
                        Registered Name <span className="text-terracotta">*</span>
                      </label>
                      <input
                        type="text"
                        value={gcashName}
                        onChange={(e) => setGcashName(e.target.value)}
                        placeholder="Name as registered in GCash"
                        className="w-full rounded-md border border-sand bg-white px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-espresso">City</label>
                      <input
                        type="text"
                        value={gcashCity}
                        onChange={(e) => setGcashCity(e.target.value)}
                        placeholder="Your city"
                        className="w-full rounded-md border border-sand bg-white px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                      />
                    </div>
                  </div>
                )}

                {/* Bank fields */}
                {paymentMethod === "bank" && (
                  <div className="space-y-3 rounded-lg border border-sand bg-parchment/20 p-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-espresso">Bank Name</label>
                      <input
                        type="text"
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        placeholder="e.g. BDO, BPI, Metrobank"
                        className="w-full rounded-md border border-sand bg-white px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-espresso">Account Number</label>
                      <input
                        type="text"
                        value={bankAccountNumber}
                        onChange={(e) => setBankAccountNumber(e.target.value)}
                        placeholder="Your account number"
                        className="w-full rounded-md border border-sand bg-white px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-espresso">Account Name</label>
                      <input
                        type="text"
                        value={bankAccountName}
                        onChange={(e) => setBankAccountName(e.target.value)}
                        placeholder="Name on the account"
                        className="w-full rounded-md border border-sand bg-white px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                      />
                    </div>
                  </div>
                )}

                {paymentMethod === "none" && (
                  <p className="text-[12px] text-stone">
                    You can add your payment info later from your profile settings.
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep("account")}
                    disabled={submitting}
                    className="flex-1 rounded-md border border-sand bg-parchment px-4 py-2.5 text-sm font-medium text-walnut transition-colors hover:bg-sand disabled:opacity-50"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex-1 rounded-md bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90 disabled:opacity-50"
                  >
                    {submitting ? "Creating account…" : "Create Account"}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Success ── */}
          {step === "success" && (
            <div className="py-4 text-center">
              <div className="mb-4 text-5xl">🎉</div>
              <h2 className="mb-2 font-serif text-xl font-bold text-espresso">
                Welcome to MinuteFlow!
              </h2>
              <p className="mb-6 text-sm text-bark">
                Your account has been created. You can now sign in with your email and password.
              </p>
              <button
                onClick={() => router.push("/login")}
                className="w-full rounded-md bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90"
              >
                Go to Sign In
              </button>
            </div>
          )}

        </div>

        {step !== "success" && step !== "loading" && step !== "invalid" && (
          <p className="mt-4 text-center text-sm text-stone">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-terracotta hover:underline">
              Sign In
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Step Dots ─────────────────────────────────────────────── */
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-6 flex gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            i + 1 <= current ? "bg-terracotta" : "bg-sand"
          }`}
        />
      ))}
    </div>
  );
}

/* ── Page Export with Suspense ─────────────────────────────── */
export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-cream">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-sand border-t-terracotta" />
        </div>
      }
    >
      <InviteForm />
    </Suspense>
  );
}
