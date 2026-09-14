import { unreadCount } from "@/modules/messaging/service";
import { countNewContactSubmissions } from "@/modules/contact/queries";
import { countActiveIncidents } from "@/modules/monitoring/service";
import { countDeadDeliveries } from "@/modules/webhooks_out/queries";
import { countPastDueInvoices } from "@/modules/billing/queries";
import type { OpsNavCounts } from "@/components/ops-nav";

/** The attention pills in the ops sidebar. Refreshed on hard loads and router.refresh(). */
export async function getOpsNavCounts(): Promise<OpsNavCounts> {
  const [unread, leads, incidents, dead, pastDue] = await Promise.all([
    unreadCount("ops"),
    countNewContactSubmissions(),
    countActiveIncidents(),
    countDeadDeliveries(),
    countPastDueInvoices(),
  ]);
  return { inbox: unread + leads, monitoring: incidents, system: dead, billing: pastDue };
}
