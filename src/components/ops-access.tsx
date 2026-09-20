"use client";

import { createContext, useContext } from "react";
import type { OpsLevel } from "@/lib/roles";

/**
 * The signed-in ops account's level, provided by the ops layout so client
 * components can hide mutation controls from ops_support. The server
 * actions are the real guard (requireOps() = admin); this only keeps the
 * UI honest.
 */
type OpsAccess = { level: OpsLevel; canMutate: boolean };

const OpsAccessContext = createContext<OpsAccess>({ level: "admin", canMutate: true });

export function OpsAccessProvider({ level, children }: { level: OpsLevel; children: React.ReactNode }) {
  return (
    <OpsAccessContext.Provider value={{ level, canMutate: level === "admin" }}>{children}</OpsAccessContext.Provider>
  );
}

export function useOpsAccess(): OpsAccess {
  return useContext(OpsAccessContext);
}
