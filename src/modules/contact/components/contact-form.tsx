"use client";

import { useState } from "react";
import { submitContactAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ContactForm({
  sourcePage,
}: {
  sourcePage: "landing" | "platform" | "contact" | "pricing";
}) {
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "", website: "" });
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    const res = await submitContactAction({ ...form, sourcePage });
    if (res.ok) {
      setState("done");
    } else {
      setState("error");
      setError(res.error);
    }
  }

  if (state === "done") {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-10 text-center">
        <h2 className="text-lg font-semibold text-heading">Message sent</h2>
        <p className="text-sm text-muted-foreground">
          Thanks — we&apos;ll get back to you shortly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border bg-card p-6">
      <div className="grid gap-2">
        <Label htmlFor="c-name">Name</Label>
        <Input id="c-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="c-email">Email</Label>
        <Input id="c-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="c-company">Company</Label>
        <Input id="c-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="c-message">What do you need?</Label>
        <Textarea id="c-message" required minLength={10} rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
      </div>
      {/* Honeypot */}
      <input
        type="text"
        name="website"
        value={form.website}
        onChange={(e) => setForm({ ...form, website: e.target.value })}
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={state === "busy"}>
        {state === "busy" ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
