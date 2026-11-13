"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signIn } from "@/app/actions/auth";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, null);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      <h2 className="mb-6 text-center font-serif text-xl font-bold text-espresso">
        Sign In
      </h2>

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

        <div>
          <label
            htmlFor="password"
            className="mb-1 block text-sm font-medium text-espresso"
          >
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              placeholder="Your password"
              className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 pr-10 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-bark hover:text-espresso"
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <path d="M1 1l22 22" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90 disabled:opacity-50"
        >
          {pending ? "Signing in..." : "Sign In"}
        </button>
      </form>

      <div className="mt-4 text-center">
        <Link
          href="/forgot-password"
          className="text-sm text-bark hover:text-terracotta hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <p className="mt-6 text-center text-sm text-bark">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="font-medium text-terracotta hover:underline"
        >
          Register
        </Link>
      </p>
    </>
  );
}
