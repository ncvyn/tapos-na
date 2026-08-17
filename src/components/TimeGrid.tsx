import { createMemo, createSignal, For, Show } from "solid-js";
import { type DayItem, type DayOfWeek } from "../schema";
import { spanForNewStart } from "../collision";
import { toIntervals } from "../occupancy";
import {
  beginDrag,
  commitDropOnDay,
  getDragPayload,
  wouldPayloadCollide,
} from "../drag";
import type { CalendarStore } from "../state";
import { minutesToTime } from "../time";
import { ITEM_ICONS, ITEM_THEMES } from "./itemStyles";

const PX_PER_MINUTE = 1.5;
const SNAP_MINUTES = 15;

interface TimeGridProps {
  store: CalendarStore;
  day: DayOfWeek;
  items: DayItem[];
  onOpenEditItem?: (item: DayItem) => void;
  onDropRefused?: (reason: string) => void;
}

interface HoverState {
  start: number;
  end: number;
  ok: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function TimeGrid(props: TimeGridProps) {
  const [hover, setHover] = createSignal<HoverState | null>(null);

  const gridHeight = 1440 * PX_PER_MINUTE;

  const segments = createMemo(() =>
    props.items.flatMap((item) =>
      toIntervals({ start: item.start, end: item.end }).map((seg) => ({
        seg,
        item,
      })),
    ),
  );

  let mainRef: HTMLDivElement | undefined;

  const computeMinute = (clientY: number): number => {
    if (!mainRef) return 0;
    const rect = mainRef.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const snapped = Math.round((ratio * 1440) / SNAP_MINUTES) * SNAP_MINUTES;
    return Math.max(0, Math.min(1440, snapped));
  };

  const handleDragStart = (e: DragEvent, item: DayItem) => {
    beginDrag(e.dataTransfer, { kind: "day-item", item });
  };

  const handleDragOver = (e: DragEvent) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    const payload = getDragPayload(dt);
    if (!payload) return;
    e.preventDefault();
    if (payload.kind === "todo") {
      dt.dropEffect = "move";
      return;
    }
    const item = payload.item;
    const startMin = computeMinute(e.clientY);
    const span = spanForNewStart(
      item._tag,
      { start: item.start, end: item.end },
      startMin,
    );
    const ok =
      span !== null &&
      !wouldPayloadCollide(
        props.store,
        payload,
        props.day,
        { start: span.start, end: span.end },
      );
    setHover(span ? { start: span.start, end: span.end, ok } : null);
    dt.dropEffect = ok ? "move" : "none";
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    const payload = getDragPayload(e.dataTransfer);
    if (!payload) return;
    setHover(null);

    if (payload.kind === "todo") {
      const result = commitDropOnDay(props.store, payload, props.day);
      if (!result.ok) props.onDropRefused?.(result.reason);
      return;
    }

    const startMin = computeMinute(e.clientY);
    const span = spanForNewStart(
      payload.item._tag,
      { start: payload.item.start, end: payload.item.end },
      startMin,
    );
    if (!span) {
      props.onDropRefused?.(
        "Can't drop here — the block would run past midnight.",
      );
      return;
    }
    const result = commitDropOnDay(
      props.store,
      payload,
      props.day,
      { start: span.start, end: span.end },
    );
    if (!result.ok) props.onDropRefused?.(result.reason);
  };

  return (
    <div class="relative">
      <div class="flex gap-1">
        {/* Hour gutter */}
        <div
          class="relative w-10 shrink-0 select-none"
          style={{ height: `${gridHeight}px` }}
        >
          <For each={HOURS}>
            {(h) => (
              <span
                class="absolute right-1 -translate-y-1/2 text-[9px] font-mono text-base-content/40"
                style={{ top: `${((h * 60) / 1440) * 100}%` }}
              >
                {minutesToTime(h * 60)}
              </span>
            )}
          </For>
        </div>

        {/* Drop area */}
        <div
          ref={mainRef}
          class="relative flex-1 overflow-hidden rounded border border-base-200/70 bg-base-100"
          style={{ height: `${gridHeight}px` }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={(e) => {
            if (!mainRef?.contains(e.relatedTarget as Node)) setHover(null);
          }}
          onDragEnd={() => setHover(null)}
        >
          {/* Hour lines */}
          <For each={HOURS}>
            {(h) => (
              <div
                class="absolute left-0 right-0 border-t border-base-200/60"
                style={{ top: `${((h * 60) / 1440) * 100}%` }}
              />
            )}
          </For>

          {/* Item blocks */}
          <For each={segments()}>
            {({ seg, item }) => {
              const theme = ITEM_THEMES[item._tag];
              const top = (seg.start / 1440) * 100;
              const height =
                ((seg.end - seg.start) / 1440) * 100;
              return (
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  class={`group absolute left-0.5 right-0.5 overflow-hidden rounded border px-1.5 py-0.5 text-[11px] leading-tight cursor-grab active:cursor-grabbing ${theme.card}`}
                  style={{
                    top: `${top}%`,
                    height: `${height}%`,
                    "min-height": "18px",
                  }}
                  title={`${item._tag === "sleep" ? ITEM_THEMES.sleep.name : item.title} — ${minutesToTime(item.start)}–${minutesToTime(item.end)}`}
                >
                  <div class="flex items-center justify-between gap-1">
                    <div class="truncate font-medium">
                      <span>{ITEM_ICONS[item._tag]}</span>{" "}
                      {item._tag === "sleep"
                        ? ITEM_THEMES.sleep.name
                        : item.title}
                    </div>
                    <div class="hidden group-hover:flex shrink-0 gap-0.5">
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs h-4 min-h-0 w-4 p-0 text-[10px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onOpenEditItem?.(item);
                        }}
                        title="Edit item"
                        aria-label={`Edit ${item._tag} item`}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs h-4 min-h-0 w-4 p-0 text-[10px] text-error"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.store.deleteDayItem(props.day, item.id);
                        }}
                        title="Delete item"
                        aria-label="Delete item"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div class="font-mono text-[9px] opacity-70">
                    {minutesToTime(item.start)}–{minutesToTime(item.end)}
                  </div>
                </div>
              );
            }}
          </For>

          {/* Drop preview band(s) — wrap-aware, so a wrapping sleep preview
              renders as two bands instead of a negative-height one */}
          <Show when={hover()}>
            {(h) => (
              <For each={toIntervals({ start: h().start, end: h().end })}>
                {(interval) => (
                  <div
                    class={`pointer-events-none absolute left-0 right-0 z-10 border-2 border-dashed ${
                      h().ok
                        ? "border-primary bg-primary/20"
                        : "border-error bg-error/20"
                    }`}
                    style={{
                      top: `${(interval.start / 1440) * 100}%`,
                      height: `${((interval.end - interval.start) / 1440) * 100}%`,
                    }}
                  >
                    <span
                      class={`absolute left-1 top-0.5 text-[10px] font-semibold uppercase tracking-wide ${h().ok ? "text-primary" : "text-error"}`}
                    >
                      {minutesToTime(h().start)}–{minutesToTime(h().end)}
                      {h().ok ? "" : " · collision"}
                    </span>
                  </div>
                )}
              </For>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
