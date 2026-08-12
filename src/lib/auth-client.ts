"use client";

import { createAuthClient } from "better-auth/react";
import {
  inferAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
import type { Auth } from "./auth";
import { ac, orgRoles } from "./org-roles";

export const authClient = createAuthClient({
  plugins: [
    organizationClient({ ac, roles: orgRoles }),
    inferAdditionalFields<Auth>(),
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;
