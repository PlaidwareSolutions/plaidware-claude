"use client";

import { Inbox, UserPlus } from "lucide-react";
import type { ProductDto } from "@/modules/catalog/queries";
import { OnboardClientWizard } from "@/modules/onboarding/components/onboard-client-wizard";
import { setContactStatusAction } from "../actions";
import { formatDateTime } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export type LeadRow = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  message: string;
  sourcePage: string;
  status: "new" | "contacted" | "archived";
  createdAt: string;
};

export function ContactInbox({ submissions, products }: { submissions: LeadRow[]; products: ProductDto[] }) {
  const { run, isPending } = useAction();

  function setStatus(s: LeadRow, status: LeadRow["status"]) {
    void run(() => setContactStatusAction(s.id, status), {
      key: `${s.id}:${status}`,
      success: `Marked as ${status}`,
    });
  }

  if (submissions.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No leads yet"
        description="Submissions from the marketing site's contact form land here."
      />
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {submissions.map((s) => (
        <Card key={s.id} className={s.status === "archived" ? "opacity-60" : undefined}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium text-heading">
                {s.name}
                {s.company ? ` · ${s.company}` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                <a href={`mailto:${s.email}`} className="hover:text-primary">{s.email}</a> ·{" "}
                {formatDateTime(s.createdAt)} · via {s.sourcePage}
              </div>
            </div>
            <StatusBadge kind="contact" status={s.status} />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="whitespace-pre-wrap text-sm">{s.message}</p>
            <div className="flex flex-wrap gap-2">
              {s.status !== "archived" && (
                <OnboardClientWizard
                  products={products}
                  initial={{ clientName: s.name, clientEmail: s.email, tenantName: s.company ?? "" }}
                  trigger={(open) => (
                    <Button size="sm" className="gap-1.5" onClick={open}>
                      <UserPlus className="size-4" /> Onboard…
                    </Button>
                  )}
                  onCreated={() => {
                    if (s.status === "new") setStatus(s, "contacted");
                  }}
                />
              )}
              {s.status !== "contacted" && (
                <Button size="sm" variant="outline" disabled={isPending(`${s.id}:contacted`)} onClick={() => setStatus(s, "contacted")}>
                  Mark contacted
                </Button>
              )}
              {s.status !== "archived" && (
                <Button size="sm" variant="ghost" disabled={isPending(`${s.id}:archived`)} onClick={() => setStatus(s, "archived")}>
                  Archive
                </Button>
              )}
              {s.status !== "new" && (
                <Button size="sm" variant="ghost" disabled={isPending(`${s.id}:new`)} onClick={() => setStatus(s, "new")}>
                  Reopen
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
