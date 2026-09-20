"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TENANT } from "@/lib/routes";

const ERRORS: Record<string, string> = {
  TOKEN_EXPIRED: "That confirmation link expired — request a new one.",
  INVALID_TOKEN: "That confirmation link isn't valid.",
  USER_NOT_FOUND: "That confirmation link isn't valid.",
  INVALID_USER: "You're signed in as a different account — sign out, then open the link again.",
};

/** Turns the ?email=changed / ?error= the verification callback lands with into toasts, then strips the query. */
export function SettingsNotices({ email, error }: { email?: string; error?: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!email && !error) return;
    if (email === "changed") toast.success("Email updated — use the new address to sign in");
    if (error) toast.error(ERRORS[error] ?? "That confirmation link didn't work.");
    router.replace(TENANT.settings);
  }, [email, error, router]);
  return null;
}
