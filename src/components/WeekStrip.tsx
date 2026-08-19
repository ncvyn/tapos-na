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

  const blocksFor = (day: DayOfWeek) =>
    getWeekDayOccupancy(
      props.store.doc.days[day],
      day === "monday" ? props.store.doc.boundaryOccupancy : [],
    ).effectiveBlocks;

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

  const handleBlockClick = (day: DayOfWeek, block: EffectiveBlock) => {
    if (block.source === "one-off") {
      const item = props.store.doc.days[day].items.find((candidate) => candidate.id === block.id);
      if (item) props.onOpenEditItem(item);
    } else if (block.source === "template" || block.source === "override") {
      props.onOpenTemplate?.(day);
    }
  };

  return (
    <section aria-labelledby="week-strip-heading" class="space-y-2">
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
                      {(block) => (
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
                              style={timelineBlockStyle(span)}
                              disabled={block.source === "boundary"}
                              draggable={block.source === "one-off"}
                              onDragStart={(event) => {
                                const item = props.store.doc.days[day].items.find((candidate) => candidate.id === block.id);
                                if (item) beginDrag(event.dataTransfer, { kind: "day-item", item });
                              }}
                              onClick={() => handleBlockClick(day, block)}
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
                      )}
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
