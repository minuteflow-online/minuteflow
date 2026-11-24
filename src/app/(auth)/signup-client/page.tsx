"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signUpClient } from "@/app/actions/auth";

export default function SignUpClientPage() {
  return (
    <Suspense>
      <SignUpClientForm />
    </Suspense>
  );
}

function SignUpClientForm() {
  const [state, formAction, pending] = useActionState(signUpClient, null);
  // A co-admin invite link (?code=…) joins an existing team instead of
  // creating a new organization.
  const code = useSearchParams().get("code");

  return (
    <>
      <h2 className="mb-6 text-center font-serif text-xl font-bold text-espresso">
        {code ? "Join Your Team" : "Create Your Client Account"}
      </h2>

      <form action={formAction} className="space-y-4">
        {state?.error && (
          <div className="rounded-md bg-terracotta-soft px-3 py-2 text-sm text-terracotta">
            {state.error}
          </div>
        )}

        {code ? (
          <>
            <input type="hidden" name="code" value={code} />
            <p className="rounded-md bg-parchment px-3 py-2 text-sm text-bark">
              You were invited to help run a team as a co-admin. Use the email address the invite was sent to.
            </p>
          </>
        ) : (
        <div>
          <label
            htmlFor="org_name"
            className="mb-1 block text-sm font-medium text-espresso"
          >
            Organization Name
          </label>
          <input
            id="org_name"
            name="org_name"
            type="text"
            required
            placeholder="Your company or team name"
            className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
          />
        </div>
        )}

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
