"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPassword } from "@/app/actions/auth";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(resetPassword, null);

  return (
    <>
      <h2 className="mb-2 text-center font-serif text-xl font-bold text-espresso">
        Reset Password
      </h2>
      <p className="mb-6 text-center text-sm text-bark">
        Enter your email and we&apos;ll send you a reset link.
      </p>

      {state?.success ? (
        <div className="space-y-4">
          <div className="rounded-md bg-sage-soft px-3 py-2 text-sm text-sage">
            Check your email for a password reset link.
          </div>
          <p className="text-center text-sm text-bark">
            <Link
              href="/login"
              className="font-medium text-terracotta hover:underline"
            >
              Back to Sign In
            </Link>
          </p>
        </div>
      ) : (
        <>
          <form action={formAction} className="space-y-4">
            {state?.error && (
              <div className="rounded-md bg-terracotta-soft px-3 py-2 text-sm text-terracotta">
                {state.error}
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-medium text-espresso"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
              />
            </div>

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90 disabled:opacity-50"
            >
              {pending ? "Sending..." : "Send Reset Link"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-bark">
            <Link
              href="/login"
              className="font-medium text-terracotta hover:underline"
            >
              Back to Sign In
            </Link>
          </p>
        </>
      )}
    </>
  );
}
