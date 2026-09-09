import { useState } from "react";

interface LoginScreenProps {
  onSubmit: (email: string, password: string) => Promise<void>;
}

// Field styling copied from src/app/(auth)/login/page.tsx per AGENTS.md ("copy
// the nearest existing component" — same form pattern, same classes).
export default function LoginScreen({ onSubmit }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onSubmit(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-cream">
      <div className="w-full max-w-sm rounded-xl border border-sand bg-white p-6">
        <h2 className="mb-1 text-center font-serif text-xl font-bold text-espresso">MinuteFlow</h2>
        <p className="mb-6 text-center text-xs text-stone">Sign in to clock in and see your queue.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-terracotta-soft px-3 py-2 text-sm text-terracotta">{error}</div>
          )}

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-espresso">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone outline-none focus:border-terracotta focus:ring-1 focus:ring-terracotta"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-espresso">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className="w-full rounded-md border border-sand bg-cream/50 px-3 py-2 text-sm text-ink placeholder:text-stone outline-none focus:border-terracotta focus:ring-1 focus:ring-terracotta"
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
      </div>
    </div>
  );
}
