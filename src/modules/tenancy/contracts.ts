import { z } from "zod";
import { ASSIGNABLE_TENANT_ROLES } from "@/lib/roles";

const note = z.string().trim().max(500).optional();

export const requestRoleChangeSchema = z.object({
  tenantId: z.string().min(1),
  role: z.enum(ASSIGNABLE_TENANT_ROLES),
  note,
});

export const decideRoleRequestSchema = z.object({
  tenantId: z.string().min(1),
  requestId: z.string().uuid(),
  note,
});

export const cancelRoleRequestSchema = z.object({
  tenantId: z.string().min(1),
  requestId: z.string().uuid(),
});
