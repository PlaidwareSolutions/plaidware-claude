import {
  Activity,
  Building2,
  CreditCard,
  LayoutDashboard,
  MessageSquare,
  Package,
  Settings2,
} from "lucide-react";
import { OPS } from "@/lib/routes";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Active only on an exact match (the section index). */
  exact?: boolean;
  /** Which nav count renders as a pill on this item. */
  countKey?: keyof OpsNavCounts;
};

/** Attention counts shown as pills in the ops sidebar. */
export type OpsNavCounts = {
  /** Unread client messages + new contact leads. */
  inbox: number;
  /** Open incidents. */
  monitoring: number;
  /** Past-due / failed invoices. */
  billing: number;
  /** Dead-letter webhook deliveries. */
  system: number;
};

/** Ops navigation, in workflow order: home → clients → money → catalog → health → comms → plumbing. */
export const OPS_NAV: NavItem[] = [
  { href: OPS.home, label: "Home", icon: LayoutDashboard, exact: true },
  { href: OPS.clients, label: "Clients", icon: Building2 },
  { href: OPS.billing, label: "Billing", icon: CreditCard, countKey: "billing" },
  { href: OPS.products, label: "Products", icon: Package },
  { href: OPS.monitoring, label: "Monitoring", icon: Activity, countKey: "monitoring" },
  { href: OPS.inbox, label: "Inbox", icon: MessageSquare, countKey: "inbox" },
  { href: OPS.system, label: "System", icon: Settings2, countKey: "system" },
];

export function isNavActive(href: string, pathname: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}
