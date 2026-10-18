"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { removePartnerLinkAction, setPartnerLinkAction } from "../actions";
import type { TenantPartnerLinkDto } from "../queries";

/**
 * Client → Provisioning: which partner-app tenant this client is. Ops set it
 * to bill an existing partner tenant from Hub (the provision handshake then
 * links instead of creating). Partner-created clients arrive linked.
 */
export function PartnerLinkCard({ tenantId, links, canEdit }: { tenantId: string; links: TenantPartnerLinkDto[]; canEdit: boolean }) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (links.length === 0) return null;

  async function unlink(l: TenantPartnerLinkDto) {
    const ok = await confirm({
      title: `Unlink from ${l.displayName}?`,
      description: `${l.displayName} loses access to this client's billing through the Partner API until it's linked again.`,
      confirmLabel: "Unlink",
      destructive: true,
    });
    if (ok) await run(() => removePartnerLinkAction(tenantId, l.appId), { key: `unlink:${l.appId}`, success: "Unlinked" });
  }

  return (
    <Section title="Partner links" icon={Link2} description="The partner app's own tenant id for this client." card>
      <div className="flex flex-col divide-y">
        {links.map((l) => (
          <div key={l.appId} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="w-28 font-medium">{l.displayName}</span>
            {l.externalTenantId ? (
              <>
                <code className="rounded bg-muted px-2 py-0.5 text-xs">{l.externalTenantId}</code>
                <span className="text-xs text-muted-foreground">
                  linked by {l.linkedBy === "partner_api" ? `${l.displayName} signup` : l.linkedBy === "provision" ? "handshake" : "ops"}
                  {l.linkedAt ? ` · ${formatDate(l.linkedAt)}` : ""}
                </span>
                {canEdit && (
                  <Button size="sm" variant="ghost" className="ml-auto text-destructive" disabled={isPending(`unlink:${l.appId}`)} onClick={() => void unlink(l)}>
                    Unlink
                  </Button>
                )}
              </>
            ) : canEdit ? (
              <form
                className="flex flex-1 flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => setPartnerLinkAction(tenantId, l.appId, drafts[l.appId] ?? ""), {
                    key: `link:${l.appId}`,
                    success: `Linked to ${l.displayName}`,
                  });
                }}
              >
                <Input
                  className="max-w-xs font-mono text-xs"
                  placeholder={`${l.displayName} tenant id`}
                  value={drafts[l.appId] ?? ""}
                  onChange={(e) => setDrafts({ ...drafts, [l.appId]: e.target.value })}
                />
                <Button size="sm" type="submit" variant="outline" disabled={!drafts[l.appId]?.trim() || isPending(`link:${l.appId}`)}>
                  Link
                </Button>
              </form>
            ) : (
              <span className="text-sm text-muted-foreground">not linked</span>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
