import { createSignal, For, Show } from "solid-js";
import { DAY_LABELS, type DayItem, type DayOfWeek, WEEKDAY_NAMES } from "../schema";
import { getWeekDayOccupancy, type EffectiveBlock } from "../occupancy";
import type { CalendarStore } from "../state";
import {
  adjustedDropMessage,
  beginDrag,
  commitDropOnDayWithPreview,
  getDragPayload,
  previewDragOverDay,
} from "../drag";
import type { ResizeEdge } from "../placement";
import {
  isKeyboardResizeKey,
  keyboardMoveRequest,
  keyboardResizeValue,
  resolveKeyboardMove,
  resolveKeyboardResize,
} from "../timelineEditing";
import { minutesToTime } from "../time";
import { ITEM_ICONS, ITEM_THEMES } from "./itemStyles";
import { splitTimelineSpan, timelineBlockStyle } from "./timeline";

interface WeekStripProps {
  store: CalendarStore;
  onOpenEditItem: (item: DayItem) => void;
  onOpenTemplate?: (day: DayOfWeek) => void;
  onDropRefused?: (reason: string) => void;
  onPlacementNotice?: (message: string, kind: "adjusted" | "refused") => void;
}

export default function WeekStrip(props: WeekStripProps) {
  const [dropHighlight, setDropHighlight] = createSignal<DayOfWeek | null>(null);
  const [dropFeedback, setDropFeedback] = createSignal<{
    day: DayOfWeek;
    kind: "preview" | "refused";
    message: string;
  } | null>(null);
  const [keyboardResize, setKeyboardResize] = createSignal<{
    day: DayOfWeek;
    itemId: string;
    edge: ResizeEdge;
  } | null>(null);
  const [draggingItemKey, setDraggingItemKey] = createSignal<string | null>(null);
  let keyboardRoot: HTMLElement | undefined;

  const blocksFor = (day: DayOfWeek) =>
    getWeekDayOccupancy(
      props.store.doc.days[day],
      day === "monday" ? props.store.doc.boundaryOccupancy : [],
    ).effectiveBlocks;

  const refocusKeyboardItem = (day: DayOfWeek, itemId: string) => {
    requestAnimationFrame(() => {
      const key = `${day}:${itemId}`;
      const target = Array.from(
        keyboardRoot?.querySelectorAll<HTMLElement>(
          '[data-keyboard-item][data-keyboard-surface="strip"]',
        ) ?? [],
      ).find((element) => element.dataset.keyboardItem === key);
      target?.focus();
    });
  };

  const handleDragOver = (event: DragEvent, day: DayOfWeek) => {
    const preview = previewDragOverDay(event, props.store, day);
    if (!preview) return;
    if (!preview.accepted) {
      setDropHighlight(null);
      setDropFeedback({
        day,
        kind: "refused",
        message: `Drop refused: ${preview.reason}`,
      });
      return;
    }

    setDropHighlight(day);
    setDropFeedback({
      day,
      kind: "preview",
      message:
        preview.kind === "todo"
          ? preview.dueDateChanged
            ? `Todo due day: ${DAY_LABELS[day]}`
            : `Todo already due ${DAY_LABELS[day]}`
          : preview.kind === "day-item" && preview.accepted && preview.adjusted
            ? `Adjusted preview: ${DAY_LABELS[day]} ${minutesToTime(preview.start)}–${minutesToTime(preview.end)}`
            : preview.kind === "day-item" && preview.accepted
              ? `Drop preview: ${DAY_LABELS[day]} ${minutesToTime(preview.start)}–${minutesToTime(preview.end)}`
              : "Drop preview",
    });
  };

  const handleDrop = (event: DragEvent, day: DayOfWeek) => {
    event.preventDefault();
    setDropHighlight(null);
    setDropFeedback(null);
    const payload = getDragPayload(event.dataTransfer);
    if (!payload) return;
    const { preview, result } = commitDropOnDayWithPreview(props.store, payload, day);
    if (!result.ok) {
      props.onDropRefused?.(result.reason);
    } else {
      const message = adjustedDropMessage(preview);
      if (message) props.onPlacementNotice?.(message, "adjusted");
    }
  };

  const handleKeyboardResize = (
    event: KeyboardEvent,
    day: DayOfWeek,
    item: DayItem,
    edge: ResizeEdge,
  ): boolean => {
    if (!isKeyboardResizeKey(event.key)) return false;
    event.preventDefault();
    event.stopPropagation();
    setKeyboardResize({ day, itemId: item.id, edge });
    const value = keyboardResizeValue(item, edge, event.key);
    if (value === null) {
      setDropFeedback({
        day,
        kind: "refused",
        message: "Resize refused — the active edge cannot move beyond the Week day boundary.",
      });
      return true;
    }

    const resolved = resolveKeyboardResize(
      props.store.doc.days[day],
      item,
      edge,
      event.key,
      day === "monday" ? props.store.doc.boundaryOccupancy : [],
    );
    if (resolved === null) {
      props.onPlacementNotice?.(
        "Resize refused — keep at least 15 minutes without overlapping.",
        "refused",
      );
      return true;
    }
    const saved = props.store.resizeDayItem(day, item, {
      edge,
      value: edge === "start" ? resolved.start : resolved.end,
    });
    if (!saved) {
      props.onPlacementNotice?.(props.store.errorMessage() ?? "Resize refused.", "refused");
    } else if (resolved.adjusted) {
      props.onPlacementNotice?.(
        `Adjusted: resized at ${DAY_LABELS[day]} ${minutesToTime(resolved.start)}–${minutesToTime(resolved.end)}`,
        "adjusted",
      );
    }
    if (saved) refocusKeyboardItem(day, item.id);
    return true;
  };

  const handleKeyboardBlock = (
    event: KeyboardEvent,
    day: DayOfWeek,
    item: DayItem,
  ): boolean => {
    const activeResize = keyboardResize();
    if (activeResize?.day === day && activeResize.itemId === item.id) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setKeyboardResize(null);
        setDropFeedback(null);
        return true;
      }
      if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        event.stopPropagation();
        setKeyboardResize({ ...activeResize, edge: event.key === "[" ? "start" : "end" });
        setDropFeedback({
          day,
          kind: "preview",
          message: `Resize mode: ${event.key === "[" ? "start" : "end"} edge active.`,
        });
        return true;
      }
      if (handleKeyboardResize(event, day, item, activeResize.edge)) return true;
    }

    if (
      event.key.toLowerCase() === "r" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      const active = keyboardResize();
      const edge = active?.day === day && active.itemId === item.id && active.edge === "end"
        ? "start"
        : "end";
      setKeyboardResize({ day, itemId: item.id, edge });
      setDropFeedback({
        day,
        kind: "preview",
        message: `Resize mode: ${edge} edge active. Use R to switch edges; press Escape to exit.`,
      });
      return true;
    }

    const request = keyboardMoveRequest(day, item, event.key, event.shiftKey);
    if (request === null) {
      if (
        (!event.shiftKey &&
          (event.key === "ArrowUp" || event.key === "ArrowDown")) ||
        (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight"))
      ) {
        event.preventDefault();
        event.stopPropagation();
        props.onPlacementNotice?.(
          event.shiftKey
            ? `Move refused — ${DAY_LABELS[day]} is at the Week boundary.`
            : "Move refused — the item cannot move beyond the Week day boundary.",
          "refused",
        );
        return true;
      }
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    const resolved = resolveKeyboardMove(
      props.store.doc.days[request.targetDay],
      item,
      request,
      request.targetDay === "monday" ? props.store.doc.boundaryOccupancy : [],
    );
    if (resolved === null) {
      props.onPlacementNotice?.(
        `Move refused: no valid 15-minute placement on ${request.targetDay}.`,
        "refused",
      );
      return true;
    }
    const saved = props.store.moveDayItem(
      day,
      item,
      request.targetDay,
      resolved.start,
      resolved.end,
    );
    if (!saved) {
      props.onPlacementNotice?.(props.store.errorMessage() ?? "Move refused.", "refused");
    } else if (resolved.adjusted) {
      props.onPlacementNotice?.(
        `Adjusted: placed at ${DAY_LABELS[request.targetDay]} ${minutesToTime(resolved.start)}–${minutesToTime(resolved.end)}`,
        "adjusted",
      );
    }
    if (saved) refocusKeyboardItem(request.targetDay, item.id);
    return true;
  };

  const handleBlockClick = (day: DayOfWeek, block: EffectiveBlock) => {
    if (block.source === "one-off") {
      const item = props.store.doc.days[day].items.find((candidate) => candidate.id === block.id);
      if (item) props.onOpenEditItem(item);
    } else if (block.source === "template" || block.source === "override") {
      props.onOpenTemplate?.(day);
    }
  };

  return (
    <section ref={keyboardRoot} aria-labelledby="week-strip-heading" class="space-y-2">
      <div class="flex items-end justify-between gap-3">
        <div>
          <h2 id="week-strip-heading" class="text-sm font-bold tracking-wide">
            Week at a glance
          </h2>
          <p class="text-xs text-base-content/60">Compact wall-clock previews, Monday through Sunday.</p>
          <Show when={dropFeedback()}>
            {(feedback) => (
              <p
                class={`mt-1 text-xs ${feedback().kind === "refused" ? "text-error" : "text-info-content"}`}
                aria-live="polite"
                data-testid="week-strip-drop-feedback"
              >
                {feedback().message}
              </p>
            )}
          </Show>
        </div>
        <span class="hidden text-[10px] uppercase tracking-wider text-base-content/50 sm:inline">
          Busy days stay visible
        </span>
      </div>

      <div class="overflow-x-auto pb-1" data-testid="week-strip-scroll">
        <div class="grid min-w-[700px] grid-cols-7 gap-2" role="list" aria-label="Week day previews">
          <For each={WEEKDAY_NAMES}>
            {(day) => {
              const blocks = () => blocksFor(day);
              const oneOffBlocks = () => blocks().filter((block) => block.source === "one-off");
              const hasBlocks = () => blocks().length > 0;
              return (
                <div
                  role="listitem"
                  class={`rounded-lg border bg-base-100 p-2 transition-colors ${
                    dropHighlight() === day
                      ? "border-info ring-2 ring-info/30"
                      : "border-base-300"
                  }`}
                  onDragOver={(event) => handleDragOver(event, day)}
                  onDrop={(event) => handleDrop(event, day)}
                  onDragLeave={() => {
                    if (dropHighlight() === day) setDropHighlight(null);
                    if (dropFeedback()?.day === day) setDropFeedback(null);
                  }}
                  aria-label={`${DAY_LABELS[day]} ${hasBlocks() ? "busy" : "empty"}`}
                >
                  <div class="mb-1 flex items-center justify-between">
                    <span class="text-xs font-bold">{DAY_LABELS[day]}</span>
                    <Show when={hasBlocks()} fallback={<span class="text-[10px] text-base-content/40">Empty</span>}>
                      <span class="text-[10px] text-base-content/50">{blocks().length} blocks</span>
                    </Show>
                  </div>
                  <div class="relative h-20 overflow-hidden rounded border border-base-200 bg-base-200/30">
                    <For each={[0, 360, 720, 1080, 1440]}>
                      {(minute) => (
                        <div
                          class="pointer-events-none absolute inset-x-0 border-t border-base-300/60"
                          style={{ top: `${(minute / 1440) * 100}%` }}
                        />
                      )}
                    </For>
                    <For each={blocks()}>
                      {(block) => {
                        const item = block.source === "one-off"
                          ? props.store.doc.days[day].items.find((candidate) => candidate.id === block.id)
                          : undefined;
                        return (
                          <For each={splitTimelineSpan(block.start, block.end)}>
                            {(span) => (
                            <button
                              type="button"
                              class={`absolute inset-x-0.5 overflow-hidden rounded-sm border px-0.5 text-left text-[8px] leading-tight ${
                                block.source === "one-off"
                                  ? ITEM_THEMES[block._tag].card
                                  : block.source === "boundary"
                                    ? "border-dashed border-info bg-info/20 text-info-content"
                                    : block.source === "override"
                                      ? "border-dotted border-secondary bg-secondary/25 text-secondary-content"
                                      : "border-dashed border-base-content/40 bg-base-content/15 text-base-content/70"
                              }`}
                              classList={{
                                "select-none": draggingItemKey() === `${day}:${item?.id}`,
                              }}
                              style={timelineBlockStyle(span)}
                              disabled={block.source === "boundary"}
                              draggable={block.source === "one-off"}
                              aria-keyshortcuts={block.source === "one-off" ? "ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight R [ ]" : undefined}
                              data-keyboard-item={item ? `${day}:${item.id}` : undefined}
                              data-keyboard-surface="strip"
                              onDragStart={(event) => {
                                if (item) {
                                  setDraggingItemKey(`${day}:${item.id}`);
                                  beginDrag(event.dataTransfer, { kind: "day-item", item });
                                }
                              }}
                              onDragEnd={() => setDraggingItemKey(null)}
                              onFocus={() => {
                                const active = keyboardResize();
                                if (!item || active?.day !== day || active.itemId !== item.id) {
                                  setKeyboardResize(null);
                                }
                              }}
                              onClick={() => handleBlockClick(day, block)}
                              onKeyDown={(event) => {
                                if (item && handleKeyboardBlock(event, day, item)) return;
                                if (item && (event.key === "Enter" || event.key === " ")) {
                                  event.preventDefault();
                                  handleBlockClick(day, block);
                                } else if (!item && (event.key === "Enter" || event.key === " ")) {
                                  event.preventDefault();
                                }
                              }}
                              title={`${block.source}: ${block._tag === "sleep" ? ITEM_THEMES.sleep.name : block.title ?? block._tag} (${minutesToTime(span.start)}–${minutesToTime(span.end)})`}
                              aria-label={`${block.source} ${block._tag} ${minutesToTime(span.start)} to ${minutesToTime(span.end)}`}
                            >
                              <span>{ITEM_ICONS[block._tag]}</span>
                              <Show when={span.end - span.start >= 45}>
                                <span class="ml-0.5">{block.source === "boundary" ? "Boundary" : block._tag}</span>
                              </Show>
                            </button>
                            )}
                          </For>
                        );
                      }}
                    </For>
                    <Show when={!hasBlocks()}>
                      <span class="absolute inset-0 flex items-center justify-center text-[9px] text-base-content/30">No occupancy</span>
                    </Show>
                  </div>
                  <div class="mt-1 flex justify-between text-[9px] font-mono text-base-content/45">
                    <span>00:00</span>
                    <span>{oneOffBlocks().length > 0 ? "editable" : "read-only"}</span>
                    <span>24:00</span>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </section>
  );
}
