import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { listContactSubmissions } from "@/modules/contact/queries";
import { ContactInbox } from "@/modules/contact/components/contact-inbox";

export const metadata = { title: "Contact Inbox" };

export default async function ContactInboxPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

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
