"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { contactSubmissions } from "./schema";
import { requireOps } from "../../policy";
import { sendEmail, emailShell } from "../../lib/email";
import { env } from "../../env";

type ActionResult = { ok: true } | { ok: false; error: string };

const submitSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  company: z.string().max(120).optional(),
  role: z.string().max(60).optional(),
  teamSize: z.string().max(30).optional(),
  message: z.string().min(10).max(2000),
  sourcePage: z.enum(["landing", "platform", "contact", "pricing"]).default("contact"),
  /** Honeypot — real users never fill this. */
  website: z.string().max(0).optional().or(z.literal("")),
});

export async function submitContactAction(
  input: z.infer<typeof submitSchema>,
): Promise<ActionResult> {
  try {
    const parsed = submitSchema.parse(input);
    if (parsed.website) return { ok: true }; // silently drop bots
    await db.insert(contactSubmissions).values({
      name: parsed.name,
      email: parsed.email,
      company: parsed.company,
      role: parsed.role,
      teamSize: parsed.teamSize,
      message: parsed.message,
      sourcePage: parsed.sourcePage,
    });
    if (env.OPS_EMAIL) {
      void sendEmail({
        to: env.OPS_EMAIL,
        subject: `[Plaidware] Demo request from ${parsed.name}`,
        html: emailShell(
          "New contact request",
          `<p><strong>${parsed.name}</strong> (${parsed.email}${parsed.company ? `, ${parsed.company}` : ""})</p><p>${parsed.message}</p><p style="color:#8b93b2">Source: ${parsed.sourcePage}</p>`,
        ),
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Submission failed" };
  }
}

export async function setContactStatusAction(
  id: string,
  status: "new" | "contacted" | "archived",
): Promise<ActionResult> {
  try {
    const { user } = await requireOps();
    await db
      .update(contactSubmissions)
      .set({
        status,
        handledByUserId: status === "new" ? null : user.id,
        handledAt: status === "new" ? null : new Date(),
      })
      .where(eq(contactSubmissions.id, id));
    revalidatePath("/ops/contact-inbox");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}
