import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold text-heading">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: August 2026</p>
      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-heading">The service</h2>
          <p>
            Plaidware Solutions LLC provides managed software products and a
            control plane for operating them. Product scope, pricing components,
            and billing intervals are shown at purchase; prices in effect at
            purchase are locked to your subscription.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-heading">Billing</h2>
          <p>
            Subscriptions renew automatically until canceled. One-time fees are
            due at purchase. Invoices unpaid past their due date may result in
            service suspension after reminders; service resumes automatically
            when payment is received.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-heading">Your responsibilities</h2>
          <p>
            Keep your account credentials secure, ensure you have rights to
            content you provide, and use the products lawfully. You are
            responsible for activity in your workspace by members you invite.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-heading">Liability</h2>
          <p>
            Products are provided &quot;as is.&quot; To the maximum extent permitted by
            law, Plaidware&apos;s aggregate liability is limited to the amounts you
            paid in the twelve months preceding the claim.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-heading">Contact</h2>
          <p>
            Questions about these terms:{" "}
            <a className="text-primary hover:underline" href="mailto:solutions@plaidware.com">
              solutions@plaidware.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
