"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/app/actions/auth";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, null);

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
          <input
            id="password"
            name="password"
            type="password"
            required
            placeholder="Your password"
            className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
          />
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
