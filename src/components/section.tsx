import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/** A titled block on a page: h2 row (icon · title · count · actions) + content. */
export function Section({
  title,
  description,
  icon: Icon,
  count,
  actions,
  card = false,
  id,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  count?: React.ReactNode;
  actions?: React.ReactNode;
  /** Wrap the content in a Card. */
  card?: boolean;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="size-4 text-muted-foreground" />}
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
          {count != null && <Badge variant="outline" className="text-[10px]">{count}</Badge>}
          {description && <span className="text-sm text-muted-foreground">{description}</span>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {card ? (
        <Card className="py-5">
          <CardContent className="flex flex-col gap-3">{children}</CardContent>
        </Card>
      ) : (
        children
      )}
    </section>
  );
}
