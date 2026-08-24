"use client";

import { createAuthClient } from "better-auth/react";
import {
  inferAdditionalFields,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import type { Auth } from "./auth";
import { ac, orgRoles } from "./org-roles";

export const authClient = createAuthClient({
  plugins: [
    organizationClient({ ac, roles: orgRoles }),
    magicLinkClient(),
    inferAdditionalFields<Auth>(),
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;
