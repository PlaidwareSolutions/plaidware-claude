import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link
        href="/"
        className="mb-8 text-xs font-semibold uppercase tracking-[0.22em] text-coral"
      >
        Plaidware
      </Link>
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
        {children}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Accelerating business throughput
      </p>
    </main>
  );
}
