"use client";

import { useActionState } from "react";
import { updatePassword } from "@/app/actions/auth";

export default function UpdatePasswordPage() {
  const [state, formAction, pending] = useActionState(updatePassword, null);

  return (
    <>
      <h2 className="mb-2 text-center font-serif text-xl font-bold text-espresso">
        Set New Password
      </h2>
      <p className="mb-6 text-center text-sm text-bark">
        Enter your new password below.
      </p>

      <form action={formAction} className="space-y-4">
        {state?.error && (
          <div className="rounded-md bg-terracotta-soft px-3 py-2 text-sm text-terracotta">
            {state.error}
          </div>
        )}

        <div>
          <label
            htmlFor="password"
            className="mb-1 block text-sm font-medium text-espresso"
          >
            New Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            placeholder="At least 6 characters"
            className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
          />
        </div>

        <div>
          <label
            htmlFor="confirm_password"
            className="mb-1 block text-sm font-medium text-espresso"
          >
            Confirm Password
          </label>
          <input
            id="confirm_password"
            name="confirm_password"
            type="password"
            required
            minLength={6}
            placeholder="Repeat your new password"
            className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90 disabled:opacity-50"
        >
          {pending ? "Updating..." : "Update Password"}
        </button>
      </form>
    </>
  );
}
