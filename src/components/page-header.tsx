import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * The one page header. Exactly one per route, rendered by page.tsx or by the
 * tab-group layout — client view components never render an <h1>.
 */
export function PageHeader({
  title,
  description,
  back,
  badge,
  meta,
  actions,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Detail pages only: "← Clients". */
  back?: { href: string; label: string };
  /** A <StatusBadge/> next to the title. */
  badge?: React.ReactNode;
  /** Muted inline facts: "acme · 3 members". */
  meta?: React.ReactNode;
  /** Right-aligned actions (client components welcome). */
  actions?: React.ReactNode;
  /** Optional <LinkTabs/> row under the title. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {back && (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-heading">{title}</h1>
            {badge}
            {meta && <span className="text-sm text-muted-foreground">{meta}</span>}
          </div>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
