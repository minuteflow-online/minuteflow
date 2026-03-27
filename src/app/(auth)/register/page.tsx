"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp } from "@/app/actions/auth";

const roles = [
  "CEO",
  "VA",
  "Social Media Manager",
  "Design",
  "Engineering",
];

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(signUp, null);

  return (
    <>
      <h2 className="mb-6 text-center font-serif text-xl font-bold text-espresso">
        Create Account
      </h2>

      <form action={formAction} className="space-y-4">
        {state?.error && (
          <div className="rounded-md bg-terracotta-soft px-3 py-2 text-sm text-terracotta">
            {state.error}
          </div>
        )}

        <div>
          <label
            htmlFor="username"
            className="mb-1 block text-sm font-medium text-espresso"
          >
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            placeholder="Choose a username"
            className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
          />
        </div>

        <div>
          <label
            htmlFor="full_name"
            className="mb-1 block text-sm font-medium text-espresso"
          >
            Full Name
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            placeholder="Your full name"
            className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
          />
        </div>

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
            placeholder="Create a password"
            className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
          />
        </div>

        <div>
          <label
            htmlFor="role"
            className="mb-1 block text-sm font-medium text-espresso"
          >
            Role / Department
          </label>
          <select
            id="role"
            name="role"
            required
            className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
          >
            <option value="">Select your role</option>
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90 disabled:opacity-50"
        >
          {pending ? "Creating account..." : "Create Account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-bark">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-terracotta hover:underline"
        >
          Sign In
        </Link>
      </p>
    </>
  );
}
