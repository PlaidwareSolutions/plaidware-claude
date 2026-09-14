import { requireOpsPage } from "@/policy";
import { listContactSubmissions } from "@/modules/contact/queries";
import { ContactInbox } from "@/modules/contact/components/contact-inbox";

export const metadata = { title: "Leads · Inbox" };
export const dynamic = "force-dynamic";

export default async function ContactInboxPage() {
  await requireOpsPage();

  const submissions = await listContactSubmissions();
  return (
    <ContactInbox
      submissions={submissions.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        company: s.company,
        message: s.message,
        sourcePage: s.sourcePage,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      }))}
    />
  );
}
