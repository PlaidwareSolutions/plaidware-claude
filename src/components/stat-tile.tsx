import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TONE = {
  default: "",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

/** A KPI tile: label · big number · optional sub-line; links when `href` is set. */
export function StatTile({
  label,
  value,
  sub,
  href,
  tone = "default",
  icon: Icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: keyof typeof TONE;
  icon?: LucideIcon;
  className?: string;
}) {
  const body = (
    <Card className={cn("h-full gap-2 py-5", href && "transition-colors hover:border-primary/50", className)}>
      <CardHeader className="gap-1">
        <CardDescription className="flex items-center gap-1.5">
          {Icon && <Icon className="size-3.5" />}
          {label}
        </CardDescription>
        <CardTitle className={cn("text-2xl tabular-nums", TONE[tone])}>{value}</CardTitle>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardHeader>
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}
