import type { Priority } from "../schema";

export const PRIORITY_BADGES: Record<Priority, string> = {
  P0: "badge-error",
  P1: "badge-warning",
  P2: "badge-primary",
  P3: "badge-info",
  P4: "badge-ghost",
};

export const ITEM_ICONS = {
  busy: "💼",
  event: "🗓️",
  sleep: "🌙",
  todo: "🍅",
} as const;

export const ITEM_THEMES = {
  sleep: {
    badge: "badge-secondary",
    card: "bg-indigo-950/80 border-indigo-700/60 text-indigo-100 hover:bg-indigo-900",
    name: "Sleep / Nap",
  },
  event: {
    badge: "badge-success",
    card: "bg-emerald-950/70 border-emerald-700/60 text-emerald-100 hover:bg-emerald-900",
    name: "Event",
  },
  busy: {
    badge: "badge-primary",
    card: "bg-sky-950/70 border-sky-700/60 text-sky-100 hover:bg-sky-900",
    name: "Busy",
  },
} as const;
