"use client";

import { useSyncExternalStore } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

/**
 * Sensors shared by the kanban board and the backlog list: a small pointer
 * distance so card links still click, a long-press on touch so the page
 * still scrolls, and full keyboard operation.
 */
export function useBoardSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/** True when the dragged card's centre is past the over-card's centre. */
export function pointerBelow(e: DragEndEvent): boolean {
  const a = e.active.rect.current.translated;
  const o = e.over?.rect;
  if (!a || !o) return false;
  return a.top + a.height / 2 > o.top + o.height / 2;
}

export function boardAnnouncements(describe: (id: string) => string, columnOf: (id: string) => string): Announcements {
  return {
    onDragStart: ({ active }) => `Picked up ${describe(String(active.id))}.`,
    onDragOver: ({ active, over }) => (over ? `${describe(String(active.id))} is over ${columnOf(String(over.id))}.` : `${describe(String(active.id))} is no longer over a column.`),
    onDragEnd: ({ active, over }) => (over ? `${describe(String(active.id))} dropped in ${columnOf(String(over.id))}.` : `${describe(String(active.id))} dropped back.`),
    onDragCancel: ({ active }) => `Move cancelled; ${describe(String(active.id))} returned.`,
  };
}

export const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "To pick up a card, press space or enter. Use the arrow keys to move it to another position or column, press space or enter to drop it, or escape to cancel.",
};

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(cb: () => void) {
  const m = window.matchMedia(REDUCED_MOTION);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

/** Skip dnd-kit's transforms when the user prefers reduced motion (false on the server). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);
}
