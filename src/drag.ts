/**
 * Drag & drop glue (T10, adjusted moves — #19).
 *
 * Shared serialization of the in-flight drag payload, a drag-image ghost for
 * HTML5 DnD, and the one commit seam every drop target uses. Committing a move
 * runs the shared placement resolver (`resolvePlacement`) once, at drop time,
 * so an adjusted or refused drop leaves the document untouched unless a valid
 * placement is committed.
 */

import { DAY_LABELS, type DayItem, type DayOfWeek, type Todo } from "./schema";
import { refusalMessage, resolvePlacement, type ResolvedPlacement } from "./placement";
import type { CalendarStore } from "./state";
import { ITEM_ICONS, ITEM_THEMES } from "./components/itemStyles";
import { minutesToTime } from "./time";

export const DRAG_MIME = "application/x-tapos-item";

/** The in-flight drag. Day items carry their source day in `item.day`. */
export type DragPayload =
  | { kind: "day-item"; item: DayItem }
  | { kind: "todo"; item: Todo };

export type DropPreview =
  | {
      kind: "day-item";
      targetDay: DayOfWeek;
      accepted: true;
      start: number;
      end: number;
      adjusted: boolean;
    }
  | {
      kind: "day-item";
      targetDay: DayOfWeek;
      accepted: false;
      reason: string;
    }
  | {
      kind: "todo";
      targetDay: DayOfWeek;
      accepted: true;
      dueDateChanged: boolean;
    };

function setDragPayload(dt: DataTransfer | null, payload: DragPayload): void {
  if (!dt) return;
  dt.setData(DRAG_MIME, JSON.stringify(payload));
  dt.effectAllowed = "move";
}

export function getDragPayload(dt: DataTransfer | null): DragPayload | null {
  if (!dt) return null;
  const raw = dt.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (parsed && (parsed.kind === "day-item" || parsed.kind === "todo")) {
      return parsed;
    }
  } catch {
    // Not a payload we own.
  }
  return null;
}

/** Render a small fixed-size ghost following the cursor during a drag. */
function setDragImage(
  dt: DataTransfer | null,
  label: string,
  icon = "",
): void {
  if (!dt) return;
  const ghost = document.createElement("div");
  ghost.className =
    "flex items-center gap-1.5 rounded-md border border-base-300 bg-base-100 px-2.5 py-1.5 text-xs font-medium shadow-lg";
  ghost.textContent = `${icon} ${label}`.trim();
  ghost.style.width = "200px";
  document.body.appendChild(ghost);
  dt.setDragImage(ghost, 12, 12);
  requestAnimationFrame(() => ghost.remove());
}

/** Start dragging a day item or todo: payload + ghost, from any source. */
export function beginDrag(dt: DataTransfer | null, payload: DragPayload): void {
  if (!dt) return;
  setDragPayload(dt, payload);
  const label =
    payload.kind === "todo"
      ? payload.item.title
      : payload.item._tag === "sleep"
        ? ITEM_THEMES.sleep.name
        : payload.item.title;
  const icon =
    payload.kind === "todo" ? ITEM_ICONS.todo : ITEM_ICONS[payload.item._tag];
  setDragImage(dt, label, icon);
}

/** Resolve the shared placement preview for a day-item drop target. */
export function resolveDayItemDrop(
  store: CalendarStore,
  item: DayItem,
  targetDay: DayOfWeek,
): ResolvedPlacement | null {
  return resolvePlacement(
    store.doc.days[targetDay],
    { tag: item._tag, start: item.start, end: item.end },
    item.id,
    targetDay === "monday" ? store.doc.boundaryOccupancy : [],
  );
}

/** Preview either kind of day drop without mutating the calendar. */
export function previewDropOnDay(
  store: CalendarStore,
  payload: DragPayload,
  targetDay: DayOfWeek,
): DropPreview {
  if (payload.kind === "todo") {
    return {
      kind: "todo",
      targetDay,
      accepted: true,
      dueDateChanged: payload.item.dueDate !== targetDay,
    };
  }

  const resolved = resolveDayItemDrop(store, payload.item, targetDay);
  return resolved === null
    ? {
        kind: "day-item",
        targetDay,
        accepted: false,
        reason: refusalMessage(targetDay),
      }
    : {
        kind: "day-item",
        targetDay,
        accepted: true,
        start: resolved.start,
        end: resolved.end,
        adjusted: resolved.adjusted,
      };
}

/** Prepare a native drag-over event for either Week-day drop target. */
export function previewDragOverDay(
  event: DragEvent,
  store: CalendarStore,
  targetDay: DayOfWeek,
): DropPreview | null {
  const payload = getDragPayload(event.dataTransfer);
  if (!payload) return null;
  event.preventDefault();
  const preview = previewDropOnDay(store, payload, targetDay);
  event.dataTransfer!.dropEffect = preview.accepted ? "move" : "none";
  return preview;
}

export type MoveResult = { ok: true } | { ok: false; reason: string };

export interface DropCommit {
  preview: DropPreview;
  result: MoveResult;
}

/**
 * The single drop seam. Drop `payload` onto `targetDay` at the item's current
 * wall-clock span (column drop). Resolves the least-surprising valid placement
 * via the shared resolver — exact when possible, else shortened or moved to a
 * nearby gap. Refuses (no state change) when no 15-minute placement exists.
 */
export function commitDropOnDay(
  store: CalendarStore,
  payload: DragPayload,
  targetDay: DayOfWeek,
): MoveResult {
  if (payload.kind === "todo") {
    if (payload.item.dueDate === targetDay) return { ok: true };
    store.updateTodo({ ...payload.item, dueDate: targetDay });
    return { ok: true };
  }

  const item = payload.item;
  const placed = store.moveDayItem(
    item.day,
    item,
    targetDay,
    item.start,
    item.end,
  );
  return placed
    ? { ok: true }
    : { ok: false, reason: refusalMessage(targetDay) };
}

/** Return the preview and commit result so every drop target reports the same outcome. */
export function commitDropOnDayWithPreview(
  store: CalendarStore,
  payload: DragPayload,
  targetDay: DayOfWeek,
): DropCommit {
  const preview = previewDropOnDay(store, payload, targetDay);
  return {
    preview,
    result: commitDropOnDay(store, payload, targetDay),
  };
}

/** Describe an adjusted Day item result for the shared placement notice. */
export function adjustedDropMessage(preview: DropPreview): string | null {
  if (preview.kind !== "day-item" || !preview.accepted || !preview.adjusted) {
    return null;
  }
  return `Adjusted: placed at ${DAY_LABELS[preview.targetDay]} ${minutesToTime(preview.start)}–${minutesToTime(preview.end)}`;
}
