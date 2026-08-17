/**
 * Drag & drop glue (T10).
 *
 * Shared serialization of the in-flight drag payload, a drag-image ghost for
 * HTML5 DnD, and the one commit seam every drop target uses. Committing a move
 * runs the collision check (`wouldCollide`) once, at drop time, so a refused
 * drop leaves the document untouched and the item returns to its origin.
 */

import { type DayItem, type DayOfWeek, type Todo } from "./schema";
import { wouldCollide, type Span } from "./collision";
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
 * Whether `payload` would collide if placed on `targetDay` at `span` (used by
 * drop targets to advertise `dropEffect` before the drop happens). Todos never
 * collide — they only carry a due date.
 */
export function wouldPayloadCollide(
  store: CalendarStore,
  payload: DragPayload,
  targetDay: DayOfWeek,
  span: Span,
): boolean {
  if (payload.kind === "todo") return false;
  return wouldCollide(
    store.doc.days[targetDay],
    { tag: payload.item._tag, start: span.start, end: span.end },
    payload.item.id,
  );
}

export type MoveResult = { ok: true } | { ok: false; reason: string };

/**
 * The single drop seam. Drop `payload` onto `targetDay` at `span` (explicit
 * grid drop) or at the item's current times (day-tab / column drop). Refuses
 * (no state change) when a day item would overlap an existing block there.
 */
export function commitDropOnDay(
  store: CalendarStore,
  payload: DragPayload,
  targetDay: DayOfWeek,
  span?: Span,
): MoveResult {
  if (payload.kind === "todo") {
    if (payload.item.dueDate === targetDay) return { ok: true };
    store.updateTodo({ ...payload.item, dueDate: targetDay });
    return { ok: true };
  }

  const item = payload.item;
  const target = span ?? { start: item.start, end: item.end };
  const collides = wouldCollide(
    store.doc.days[targetDay],
    { tag: item._tag, start: target.start, end: target.end },
    item.id,
  );
  if (collides) {
    return {
      ok: false,
      reason: `Overlapping drop refused — ${
        "title" in item ? `${item.title} ` : ""
      }would overlap a block on ${targetDay}.`,
    };
  }
  store.updateDayItem(item.day, {
    ...item,
    day: targetDay,
    start: target.start,
    end: target.end,
  });
  return { ok: true };
}
