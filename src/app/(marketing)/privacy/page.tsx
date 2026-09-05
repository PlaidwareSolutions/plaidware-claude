import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <div className="prose-sm mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold text-heading">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: September 2026</p>
      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-heading">What we collect</h2>
          <p>
            Plaidware Solutions LLC (&quot;Plaidware&quot;) collects the information you
            provide when creating an account (name, email, phone), when
            purchasing products (billing details, processed by Stripe — card
            numbers never touch our servers), and when using our products
            (operational metrics your deployed products report to the control
            plane).
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-heading">How we use it</h2>
          <p>
            To operate your products and workspaces, bill you accurately, monitor
            service health on your behalf, and communicate with you about your
            account. We do not sell personal information to anyone.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-heading">Third parties</h2>
          <p>
            We rely on Stripe (payments), Resend (email delivery), Railway
            (hosting), Cloudflare (network), and Google PageSpeed Insights
            (website performance audits). Each receives only the data needed to
            perform its function.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-heading">SMS / Text Messaging</h2>
          <p>
            Where you provide a phone number to us or to a business we serve
            (for example by calling, booking an appointment, or corresponding),
            we may send transactional text messages such as missed-call
            notifications and post-appointment follow-ups. Consent to receive
            text messages is not a condition of any purchase.{" "}
            <strong>
              We do not sell mobile phone numbers, and text messaging
              originator opt-in data and consent are not shared with third
              parties or affiliates for marketing or promotional purposes.
            </strong>{" "}
            Questions:{" "}
            <a className="text-primary hover:underline" href="mailto:solutions@plaidware.com">
              solutions@plaidware.com
            </a>
            .
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-heading">Your choices</h2>
          <p>
            You can update your profile in Settings, and request account
            deletion or a copy of your data by emailing{" "}
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
