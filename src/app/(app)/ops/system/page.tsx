import { redirect } from "next/navigation";
import { OPS } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default function SystemIndexPage() {
  redirect(OPS.access);
}
