"use client";

import { createContext, useContext } from "react";
import type { WorkUserRef } from "../../dto";

/** Who can be @mentioned in the editors below (the work area's people). Without a provider, @ does nothing. */
const MentionPeopleCtx = createContext<WorkUserRef[]>([]);

export function MentionPeopleProvider({ people, children }: { people: WorkUserRef[]; children: React.ReactNode }) {
  return <MentionPeopleCtx.Provider value={people}>{children}</MentionPeopleCtx.Provider>;
}

export function useMentionPeople(): WorkUserRef[] {
  return useContext(MentionPeopleCtx);
}
