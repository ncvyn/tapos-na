/**
 * Drag & drop glue (T10, adjusted moves — #19).
 *
 * Shared serialization of the in-flight drag payload, a drag-image ghost for
 * HTML5 DnD, and the one commit seam every drop target uses. Committing a move
 * runs the shared placement resolver (`resolvePlacement`) once, at drop time,
 * so an adjusted or refused drop leaves the document untouched unless a valid
 * placement is committed.
 */

import { type DayItem, type DayOfWeek, type Todo } from "./schema";
import { refusalMessage, resolvePlacement } from "./placement";
import type { CalendarStore } from "./state";
import { ITEM_ICONS, ITEM_THEMES } from "./components/itemStyles";

export const DRAG_MIME = "application/x-tapos-item";

/** The in-flight drag. Day items carry their source day in `item.day`. */
export type DragPayload =
  | { kind: "day-item"; item: DayItem }
  | { kind: "todo"; item: Todo };

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

/**
 * Whether a drop of `payload` onto `targetDay` would be refused (no valid
 * placement exists). Used by drop targets to advertise `dropEffect` before the
 * drop happens. Todos never refuse — they only carry a due date.
 */
export function wouldDropBeRefused(
  store: CalendarStore,
  payload: DragPayload,
  targetDay: DayOfWeek,
): boolean {
  if (payload.kind === "todo") return false;
  return (
    resolvePlacement(
      store.doc.days[targetDay],
      { tag: payload.item._tag, start: payload.item.start, end: payload.item.end },
      payload.item.id,
      targetDay === "monday" ? store.doc.boundaryOccupancy : [],
    ) === null
  );
}

export type MoveResult = { ok: true } | { ok: false; reason: string };

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
