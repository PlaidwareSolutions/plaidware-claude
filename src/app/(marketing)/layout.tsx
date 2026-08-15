import Link from "next/link";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/products", label: "Products" },
  { href: "/platform", label: "Platform" },
  { href: "/contact", label: "Contact" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <Link href="/" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/plaidware-logo.png" alt="Plaidware" className="h-7 w-auto" />
          </Link>
          <nav className="hidden gap-5 text-sm text-muted-foreground sm:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex-1" />
          <Button asChild variant="ghost" size="sm">
            <a href="https://hub.plaidware.com/login">Sign in</a>
          </Button>
          <Button asChild size="sm">
            <a href="https://hub.plaidware.com/signup">Get started</a>
          </Button>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/plaidware-logo.png" alt="Plaidware" className="h-8 w-auto" />
            <p className="mt-2 max-w-xs text-xs text-muted-foreground">
              One control plane for every Plaidware product. Accelerating
              business throughput.
            </p>
          </div>
          <div className="flex gap-10 text-sm">
            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Company</div>
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-muted-foreground hover:text-foreground">
                  {n.label}
                </Link>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Legal</div>
              <Link href="/privacy" className="text-muted-foreground hover:text-foreground">
                Privacy
              </Link>
              <Link href="/terms" className="text-muted-foreground hover:text-foreground">
                Terms
              </Link>
            </div>
          </div>
        </div>
        <div className="border-t py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Plaidware Solutions LLC
        </div>
      </footer>
    </div>
  );
}
