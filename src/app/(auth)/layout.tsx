export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-bold text-ink">
            Minute<span className="italic text-terracotta">Flow</span>
          </h1>
          <p className="mt-1 text-sm text-bark">
            Time tracking for virtual assistants
          </p>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-sand bg-white p-8 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
