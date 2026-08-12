import type { Metadata } from "next";
import { ContactForm } from "@/modules/contact/components/contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Request a demo or ask the Plaidware team anything.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-12 px-4 py-16 md:grid-cols-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-coral">Contact</p>
        <h1 className="mt-2 text-3xl font-bold text-heading">Talk to us</h1>
        <p className="mt-3 max-w-md text-muted-foreground">
          Tell us about your business and we&apos;ll show you how the portfolio
          and the control plane fit it. A real person replies — usually the same
          day.
        </p>
        <div className="mt-8 text-sm text-muted-foreground">
          Prefer email?{" "}
          <a href="mailto:solutions@plaidware.com" className="text-primary hover:underline">
            solutions@plaidware.com
          </a>
        </div>
      </div>
      <ContactForm sourcePage="contact" />
    </div>
  );
}
