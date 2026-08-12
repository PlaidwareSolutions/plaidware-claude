"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Inbox } from "lucide-react";
import { setContactStatusAction } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Submission = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  message: string;
  sourcePage: string;
  status: "new" | "contacted" | "archived";
  createdAt: string;
};

export function ContactInbox({ submissions }: { submissions: Submission[] }) {
  const [, startTransition] = useTransition();

  function setStatus(s: Submission, status: Submission["status"]) {
    startTransition(async () => {
      const res = await setContactStatusAction(s.id, status);
      if (res.ok) toast.success(`Marked as ${status}`);
      else toast.error(res.error ?? "Update failed");
    });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-heading">Contact Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Demo requests and messages from the marketing site.
        </p>
      </div>

      {submissions.length === 0 && (
        <div className="rounded-lg border bg-card py-16 text-center text-muted-foreground">
          <Inbox className="mx-auto mb-2 size-8 opacity-40" />
          No submissions yet.
        </div>
      )}

      {submissions.map((s) => (
        <Card key={s.id}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium text-heading">
                {s.name}
                {s.company ? ` · ${s.company}` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                {s.email} · {new Date(s.createdAt).toLocaleString()} · via {s.sourcePage}
              </div>
            </div>
            <Badge
              variant={
                s.status === "new" ? "default" : s.status === "contacted" ? "secondary" : "outline"
              }
            >
              {s.status}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm">{s.message}</p>
            <div className="flex gap-2">
              {s.status !== "contacted" && (
                <Button size="sm" variant="outline" onClick={() => setStatus(s, "contacted")}>
                  Mark contacted
                </Button>
              )}
              {s.status !== "archived" && (
                <Button size="sm" variant="ghost" onClick={() => setStatus(s, "archived")}>
                  Archive
                </Button>
              )}
              {s.status !== "new" && (
                <Button size="sm" variant="ghost" onClick={() => setStatus(s, "new")}>
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
