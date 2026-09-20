"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquare, Plus, Send } from "lucide-react";
import type { ThreadMessage, ThreadRow } from "../service";
import { closeThreadAction, createThreadAction, replyAction } from "../actions";
import { OPS, TENANT, withQuery } from "@/lib/routes";
import { formatDateTime } from "@/lib/dates";
import { FilterChip } from "@/components/filter-chip";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type MessageDto = ThreadMessage;

export function InboxView({
  scope,
  tenantId,
  filter = null,
  threads,
  activeThread,
  activeMessages,
}: {
  scope: "tenant" | "ops";
  tenantId: string | null;
  /** Ops only: the list is scoped to one client (?tenant=). */
  filter?: { tenantId: string; tenantName: string } | null;
  threads: ThreadRow[];
  activeThread: ThreadRow | null;
  activeMessages: MessageDto[];
}) {
  const router = useRouter();
  const base = scope === "ops" ? OPS.inbox : TENANT.inbox;
  const threadHref = (id: string) => withQuery(base, { thread: id, tenant: filter?.tenantId });
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ subject: "", body: "" });

  async function send() {
    if (!activeThread || !reply.trim()) return;
    setBusy(true);
    const res = await replyAction(activeThread.id, reply.trim());
    setBusy(false);
    if (res.ok) {
      setReply("");
      router.refresh();
    } else toast.error(res.error ?? "Send failed");
  }

  async function createNew() {
    if (!tenantId) return;
    setBusy(true);
    const res = await createThreadAction({ tenantId, subject: form.subject, body: form.body });
    setBusy(false);
    if (res.ok) {
      toast.success("Conversation started");
      setNewOpen(false);
      setForm({ subject: "", body: "" });
      router.refresh();
    } else toast.error(res.error ?? "Failed");
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-2">
        {scope === "tenant" && tenantId && (
          <div className="flex justify-end">
            <Button size="sm" className="gap-1" onClick={() => setNewOpen(true)}>
              <Plus className="size-4" /> New
            </Button>
          </div>
        )}
        {filter && (
          <div>
            <FilterChip label={`Client: ${filter.tenantName}`} clearHref={base} />
          </div>
        )}
        <div className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto">
          {threads.length === 0 && (
            <EmptyState
              icon={MessageSquare}
              title="No conversations yet"
              description={
                scope === "ops"
                  ? filter
                    ? "This client hasn't started a conversation."
                    : "Client messages land here."
                  : "Start a conversation and Plaidware support replies here."
              }
            />
          )}
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => router.push(threadHref(t.id))}
              className={`rounded-md border p-3 text-left transition-colors hover:bg-accent/50 ${activeThread?.id === t.id ? "border-primary/50 bg-accent/40" : "bg-card"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-heading">{t.subject}</span>
                {t.unread > 0 && <Badge className="text-[10px]">{t.unread}</Badge>}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {scope === "ops" && <span className="font-medium">{t.tenantName} · </span>}
                {t.preview}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {t.status === "closed" && "closed · "}
                {formatDateTime(t.lastMessageAt)}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-[50vh] flex-col rounded-lg border bg-card">
        {!activeThread ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b p-3">
              <div>
                <div className="text-sm font-semibold text-heading">{activeThread.subject}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {scope === "ops" ? (
                    <Link href={OPS.client(activeThread.tenantId)} className="font-medium text-heading hover:text-primary">
                      {activeThread.tenantName}
                    </Link>
                  ) : (
                    "Plaidware support"
                  )}
                  <StatusBadge kind="thread" status={activeThread.status} className="text-[10px]" />
                </div>
              </div>
              {scope === "ops" && activeThread.status === "open" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const res = await closeThreadAction(activeThread.id);
                    if (res.ok) router.refresh();
                    else toast.error(res.error ?? "Failed");
                  }}
                >
                  Close thread
                </Button>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              {activeMessages.map((m) => {
                const mine = (scope === "tenant") === (m.senderRole === "tenant");
                return (
                  <div key={m.id} className={`max-w-[80%] rounded-lg border p-3 text-sm ${mine ? "self-end bg-primary/10" : "self-start bg-secondary/50"}`}>
                    <div className="mb-1 text-[10px] text-muted-foreground">
                      {m.senderName ?? (m.senderRole === "ops" ? "Plaidware ops" : "Customer")} ·{" "}
                      {formatDateTime(m.createdAt)}
                    </div>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 border-t p-3">
              <Input
                placeholder="Write a reply…"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              />
              <Button onClick={send} disabled={busy || !reply.trim()} className="gap-1">
                <Send className="size-4" /> Send
              </Button>
            </div>
          </>
        )}
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New conversation</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Input placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <Textarea rows={4} placeholder="How can we help?" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>
          <DialogFooter>
            <Button onClick={createNew} disabled={busy || !form.subject || !form.body}>
              {busy ? "Sending…" : "Start conversation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
