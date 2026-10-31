"use client";

import { useMemo, useSyncExternalStore } from "react";

/** Which optional fields cards show (the board's View settings), remembered per browser. */
export type CardFields = { epic: boolean; labels: boolean; dueDate: boolean; estimate: boolean; client: boolean };
export const DEFAULT_CARD_FIELDS: CardFields = { epic: true, labels: true, dueDate: true, estimate: true, client: true };
export const CARD_FIELD_LABELS: Record<keyof CardFields, string> = {
  epic: "Epic",
  labels: "Labels",
  dueDate: "Due date",
  estimate: "Story points",
  client: "Requesting client",
};

const KEY = "work.cardFields";
const EVENT = "work-card-fields";

const store = {
  subscribe(cb: () => void) {
    window.addEventListener("storage", cb);
    window.addEventListener(EVENT, cb);
    return () => {
      window.removeEventListener("storage", cb);
      window.removeEventListener(EVENT, cb);
    };
  },
  get(): string {
    try {
      return localStorage.getItem(KEY) ?? "";
    } catch {
      return "";
    }
  },
};

export function setCardFields(next: CardFields) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: not remembered */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useCardFields(): CardFields {
  const raw = useSyncExternalStore(store.subscribe, store.get, () => "");
  return useMemo(() => {
    try {
      return raw ? { ...DEFAULT_CARD_FIELDS, ...(JSON.parse(raw) as Partial<CardFields>) } : DEFAULT_CARD_FIELDS;
    } catch {
      return DEFAULT_CARD_FIELDS;
    }
  }, [raw]);
}
