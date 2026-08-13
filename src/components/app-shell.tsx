"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Activity,
  Building2,
  Check,
  ChevronsUpDown,
  Home,
  MessageSquare,
  Server,
  Siren,
  Inbox,
  LayoutDashboard,
  LogOut,
  Moon,
  Menu,
  Package,
  Receipt,
  Settings,
  Sun,
  Ticket,
  Users,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { setActiveTenantAction } from "@/modules/tenancy/actions";
import type { TenantSummary } from "@/modules/tenancy/queries";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const TENANT_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/billing", label: "Billing", icon: Receipt },
  { href: "/inbox", label: "Messages", icon: MessageSquare },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

const OPS_NAV: NavItem[] = [
  { href: "/ops", label: "Command Center", icon: LayoutDashboard },
  { href: "/ops/tenants", label: "Tenants", icon: Building2 },
  { href: "/ops/products", label: "Products", icon: Package },
  { href: "/ops/promos", label: "Promos", icon: Ticket },
  { href: "/ops/incidents", label: "Incidents", icon: Siren },
  { href: "/ops/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/ops/costs", label: "Hosting Costs", icon: Server },
  { href: "/ops/users", label: "Access", icon: Users },
  { href: "/ops/contact-inbox", label: "Contact Inbox", icon: Inbox },
];

export function AppShell({
  user,
  tenants,
  activeTenantId,
  unread,
  children,
}: {
  user: { name: string; email: string; isOps: boolean };
  tenants: TenantSummary[];
  activeTenantId: string | null;
  unread?: { tenant: number; ops: number };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [pending, startTransition] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);

  const inOps = pathname.startsWith("/ops");
  const nav = inOps ? OPS_NAV : TENANT_NAV;
  const active = tenants.find((t) => t.id === activeTenantId) ?? null;

  function switchTenant(id: string) {
    if (id === activeTenantId) return;
    startTransition(async () => {
      await setActiveTenantAction(id);
      router.refresh();
    });
  }

  async function logOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <nav className="flex flex-col gap-1 p-3">
      {nav.map((item) => {
        const current =
          item.href === "/ops" ? pathname === "/ops" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              current
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <item.icon className="size-4" />
            {item.label}
            {(item.href === "/inbox" && (unread?.tenant ?? 0) > 0) && (
              <span className="ml-auto rounded-full bg-coral px-1.5 text-[10px] font-bold text-white">{unread!.tenant}</span>
            )}
            {(item.href === "/ops/inbox" && (unread?.ops ?? 0) > 0) && (
              <span className="ml-auto rounded-full bg-coral px-1.5 text-[10px] font-bold text-white">{unread!.ops}</span>
            )}
          </Link>
        );
      })}
      {user.isOps && (
        <>
          <div className="mt-4 border-t pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3">
            {inOps ? "Tenant view" : "Operations"}
          </div>
          <Link
            href={inOps ? "/dashboard" : "/ops"}
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {inOps ? <Home className="size-4" /> : <LayoutDashboard className="size-4" />}
            {inOps ? "My workspace" : "Ops portal"}
          </Link>
        </>
      )}
    </nav>
  );

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden w-56 shrink-0 border-r bg-card lg:block">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-coral">Plaidware</span>
          {inOps && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">OPS</span>
          )}
        </div>
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b bg-card px-3 sm:px-4">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="flex h-14 items-center border-b px-4 text-xs font-bold uppercase tracking-[0.18em] text-coral">
                Plaidware
              </SheetTitle>
              {sidebar}
            </SheetContent>
          </Sheet>

          {!inOps && tenants.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" disabled={pending}>
                  <Building2 className="size-4" />
                  <span className="max-w-32 truncate">{active?.name ?? "Workspace"}</span>
                  <ChevronsUpDown className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                {tenants.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => switchTenant(t.id)}>
                    <span className="flex-1 truncate">{t.name}</span>
                    {t.id === activeTenantId && <Check className="size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            <Sun className="size-4 dark:hidden" />
            <Moon className="hidden size-4 dark:block" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account">
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs">
                    {user.name
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="truncate font-medium">{user.name}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings className="size-4" /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logOut}>
                <LogOut className="size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
