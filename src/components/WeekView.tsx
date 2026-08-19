import { createMemo, createSignal, For, Show } from "solid-js";
import {
  DAY_LABELS,
  type DayItem,
  type DayOfWeek,
  type Todo,
  WEEKDAY_NAMES,
} from "../schema";
import { computeSchedule, type ScheduledSegment } from "../engine";
import { getWeekDayOccupancy, type EffectiveBlock } from "../occupancy";
import {
  adjustedDropMessage,
  beginDrag,
  commitDropOnDayWithPreview,
  getDragPayload,
  previewDragOverDay,
} from "../drag";
import type { ResizeEdge } from "../placement";
import { spansOverlap } from "../occupancy";
import type { CalendarStore } from "../state";
import {
  pointerMoveSpan,
  resolvePointerMove,
  resolvePointerResize,
} from "../timelineEditing";
import { formatTimeSpan, getTodayWeekday, minutesToTime } from "../time";
import { ITEM_ICONS, ITEM_THEMES, PRIORITY_BADGES } from "./itemStyles";
import WeekStrip from "./WeekStrip";
import {
  emptyTimelinePlacement,
  splitTimelineSpan,
  timelineBlockStyle,
  timelineMinutesAt,
  timelinePercent,
} from "./timeline";

interface WeekViewProps {
  store: CalendarStore;
  onOpenAddItem: (
    day?: DayOfWeek,
    defaultType?: "busy" | "event" | "sleep" | "todo",
    defaultStart?: number,
    defaultEnd?: number,
  ) => void;
  onOpenEditItem: (item: DayItem | Todo) => void;
  onOpenTemplate?: (day: DayOfWeek) => void;
  onDropRefused?: (reason: string) => void;
  onPlacementNotice?: (message: string, kind: "adjusted" | "refused") => void;
}

const TIMELINE_HEIGHT = 960;
const TIME_LABELS = Array.from({ length: 13 }, (_, index) => index * 120);

function sourceLabel(source: EffectiveBlock["source"]): string {
  switch (source) {
    case "boundary":
      return "Week boundary";
    case "template":
      return "Template";
    case "override":
      return "Sleep override";
    default:
      return "One-off";
  }
}

function blockName(block: EffectiveBlock): string {
  if (block.source === "boundary") return "Sleep continuation";
  if (block._tag === "sleep") return ITEM_THEMES.sleep.name;
  return block.title ?? ITEM_THEMES[block._tag].name;
}

function isInteractive(block: EffectiveBlock): boolean {
  return block.source === "one-off" || block.source === "template" || block.source === "override";
}

type PointerPreview = {
  mode: "move" | "resize";
  day: DayOfWeek;
  start: number;
  end: number;
  adjusted: boolean;
  refused: boolean;
  message: string;
};

type PointerInteraction = {
  pointerId: number;
  mode: "move" | "resize";
  item: DayItem;
  sourceDay: DayOfWeek;
  edge?: ResizeEdge;
  grabOffset: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};

export default function WeekView(props: WeekViewProps) {
  const todayWeekday = createMemo(() => getTodayWeekday(props.store.doc.settings.timezone));
  const weekSchedule = createMemo(() => computeSchedule(props.store.doc));
  const [dropHighlight, setDropHighlight] = createSignal<DayOfWeek | null>(null);
  const [pointerInteraction, setPointerInteraction] =
    createSignal<PointerInteraction | null>(null);
  const [pointerPreview, setPointerPreview] =
    createSignal<PointerPreview | null>(null);
  let timelineCanvas: HTMLDivElement | undefined;
  const columnElements = new Map<DayOfWeek, HTMLElement>();
  let suppressClick = false;

  const boundaryFor = (day: DayOfWeek) =>
    day === "monday" ? props.store.doc.boundaryOccupancy : [];

  const minuteAt = (clientY: number) =>
    timelineMinutesAt(clientY, timelineCanvas?.getBoundingClientRect() ?? { top: 0, height: 0 });

  const dayAt = (clientX: number, fallback: DayOfWeek): DayOfWeek => {
    for (const day of WEEKDAY_NAMES) {
      const rect = columnElements.get(day)?.getBoundingClientRect();
      if (rect && clientX >= rect.left && clientX <= rect.right) return day;
    }
    return fallback;
  };

  const placementMessage = (
    mode: "move" | "resize",
    day: DayOfWeek,
    start: number,
    end: number,
    adjusted: boolean,
    requestedStart: number,
    requestedEnd: number,
  ): string => {
    const placement = `${DAY_LABELS[day]} ${minutesToTime(start)}–${minutesToTime(end)}`;
    if (!adjusted) return `${mode === "move" ? "Move" : "Resize"} preview: ${placement}`;
    if (
      mode === "move" &&
      requestedEnd === end &&
      requestedStart < start &&
      end - start < requestedEnd - requestedStart
    ) {
      return `Adjusted: shortened to ${placement}`;
    }
    return `Adjusted: ${mode === "move" ? "placed" : "resized"} at ${placement}`;
  };

  const updatePointerPreview = (event: PointerEvent) => {
    const interaction = pointerInteraction();
    if (!interaction) return;
    if (!interaction.moved) {
      if (
        Math.abs(event.clientX - interaction.startClientX) < 4 &&
        Math.abs(event.clientY - interaction.startClientY) < 4
      ) {
        return;
      }
      event.preventDefault();
      setPointerInteraction({ ...interaction, moved: true });
    }

    const targetDay =
      interaction.mode === "resize"
        ? interaction.sourceDay
        : dayAt(event.clientX, interaction.sourceDay);
    const pointerMinute = minuteAt(event.clientY);
    let requestedStart = interaction.item.start;
    let requestedEnd = interaction.item.end;
    let resolved: ReturnType<typeof resolvePointerMove> | ReturnType<typeof resolvePointerResize> = null;

    if (interaction.mode === "move") {
      const shifted = pointerMoveSpan(
        interaction.item,
        pointerMinute,
        interaction.grabOffset,
      );
      requestedStart = shifted.start;
      requestedEnd = shifted.end;
      resolved = resolvePointerMove(
        props.store.doc.days[targetDay],
        interaction.item,
        pointerMinute,
        interaction.grabOffset,
        boundaryFor(targetDay),
      );
    } else {
      resolved = resolvePointerResize(
        props.store.doc.days[interaction.sourceDay],
        interaction.item,
        interaction.edge!,
        pointerMinute,
        boundaryFor(interaction.sourceDay),
      );
    }

    if (resolved === null) {
      setPointerPreview({
        mode: interaction.mode,
        day: targetDay,
        start: interaction.item.start,
        end: interaction.item.end,
        adjusted: false,
        refused: true,
        message: `Drop refused: no valid 15-minute placement on ${targetDay}.`,
      });
      return;
    }

    setPointerPreview({
      mode: interaction.mode,
      day: targetDay,
      start: resolved.start,
      end: resolved.end,
      adjusted: resolved.adjusted,
      refused: false,
      message: placementMessage(
        interaction.mode,
        targetDay,
        resolved.start,
        resolved.end,
        resolved.adjusted,
        requestedStart,
        requestedEnd,
      ),
    });
  };

  const beginPointerInteraction = (
    event: PointerEvent,
    day: DayOfWeek,
    item: DayItem,
    span: { start: number; end: number },
    edge?: ResizeEdge,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();
    const pointerMinute = minuteAt(event.clientY);
    const grabOffset =
      edge === undefined
        ? item.start > item.end
          ? (pointerMinute - item.start + 1440) % 1440
          : pointerMinute - span.start
        : 0;
    setPointerInteraction({
      pointerId: event.pointerId,
      mode: edge === undefined ? "move" : "resize",
      item,
      sourceDay: day,
      edge,
      grabOffset,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    });
    setPointerPreview(null);
    const target = event.currentTarget as HTMLElement;
    if (target.setPointerCapture) target.setPointerCapture(event.pointerId);
  };

  const finishPointerInteraction = (event: PointerEvent) => {
    const interaction = pointerInteraction();
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (!interaction.moved) {
      setPointerInteraction(null);
      setPointerPreview(null);
      return;
    }
    const preview = pointerPreview();
    if (preview === null || preview.refused) {
      props.onPlacementNotice?.(
        preview?.message ?? "Drop refused: no valid 15-minute placement.",
        "refused",
      );
    } else {
      const saved =
        interaction.mode === "move"
          ? props.store.moveDayItem(
              interaction.sourceDay,
              interaction.item,
              preview.day,
              preview.start,
              preview.end,
            )
          : props.store.resizeDayItem(interaction.sourceDay, interaction.item, {
              edge: interaction.edge!,
              value: interaction.edge === "start" ? preview.start : preview.end,
            });
      if (!saved) {
        props.onPlacementNotice?.(
          props.store.errorMessage() ?? "Placement refused.",
          "refused",
        );
      } else if (preview.adjusted) {
        props.onPlacementNotice?.(preview.message, "adjusted");
      }
    }
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    setPointerInteraction(null);
    setPointerPreview(null);
  };

  const cancelPointerInteraction = (event: PointerEvent) => {
    const interaction = pointerInteraction();
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    setPointerInteraction(null);
    setPointerPreview(null);
  };

  const handleColumnDragOver = (event: DragEvent, day: DayOfWeek) => {
    const preview = previewDragOverDay(event, props.store, day);
    if (!preview) return;
    setDropHighlight(preview.accepted ? day : null);
  };

  const handleColumnDrop = (event: DragEvent, day: DayOfWeek) => {
    event.preventDefault();
    setDropHighlight(null);
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

  const blocksFor = (day: DayOfWeek) =>
    getWeekDayOccupancy(
      props.store.doc.days[day],
      day === "monday" ? props.store.doc.boundaryOccupancy : [],
    ).effectiveBlocks;

  const handleBlockClick = (day: DayOfWeek, block: EffectiveBlock) => {
    if (suppressClick) return;
    if (block.source === "one-off") {
      const item = props.store.doc.days[day].items.find((candidate) => candidate.id === block.id);
      if (item) props.onOpenEditItem(item);
    } else if (block.source === "template" || block.source === "override") {
      props.onOpenTemplate?.(day);
    }
  };

  const renderBlock = (day: DayOfWeek, block: EffectiveBlock) => (
    <For each={splitTimelineSpan(block.start, block.end)}>
      {(span) => {
        const item = block.source === "one-off"
          ? props.store.doc.days[day].items.find((candidate) => candidate.id === block.id)
          : undefined;
        const continuation = block.start > block.end && span.start === 0;
        const theme = ITEM_THEMES[block._tag];
        return (
          <div
            class={`group absolute inset-x-1 overflow-hidden rounded-md border p-1 text-[10px] leading-tight transition-colors ${
              block.source === "one-off"
                ? `${theme.card} cursor-grab active:cursor-grabbing`
                : block.source === "boundary"
                  ? "border-dashed border-info bg-info/15 text-info-content"
                  : block.source === "override"
                    ? "border-dotted border-secondary bg-secondary/20 text-secondary-content"
                    : "border-dashed border-base-content/40 bg-base-content/10 text-base-content/75"
            } ${isInteractive(block) ? "cursor-pointer" : "cursor-default"} z-20`}
            style={timelineBlockStyle(span)}
            draggable={block.source === "one-off"}
            classList={{ "touch-none": block.source === "one-off" }}
            role={isInteractive(block) ? "button" : undefined}
            aria-readonly={block.source !== "one-off"}
            tabIndex={isInteractive(block) ? 0 : undefined}
            onDragStart={(event) => {
              if (item) beginDrag(event.dataTransfer, { kind: "day-item", item });
            }}
            onPointerDown={(event) => {
              if (item) beginPointerInteraction(event, day, item, span);
            }}
            onClick={(event) => {
              event.stopPropagation();
              handleBlockClick(day, block);
            }}
            onKeyDown={(event) => {
              if (isInteractive(block) && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                handleBlockClick(day, block);
              }
            }}
            title={`${sourceLabel(block.source)}: ${continuation ? "Sleep continuation" : blockName(block)} (${formatTimeSpan(span.start, span.end)})`}
            aria-label={`${sourceLabel(block.source)} ${blockName(block)}, ${minutesToTime(span.start)} to ${minutesToTime(span.end)}`}
            >
            <Show when={item && (item.start < item.end || span.start === item.start)}>
              <button
                type="button"
                class="absolute inset-x-0 top-0 z-30 h-2 cursor-ns-resize bg-transparent"
                aria-label={`Resize ${blockName(block)} start`}
                title="Resize start"
                onPointerDown={(event) => {
                  if (item) beginPointerInteraction(event, day, item, span, "start");
                }}
                onClick={(event) => event.stopPropagation()}
              />
            </Show>
            <div class="flex items-start gap-1 font-medium">
              <span>{ITEM_ICONS[block._tag]}</span>
              <span class="truncate">{continuation ? "Sleep continuation" : blockName(block)}</span>
            </div>
            <div class="mt-0.5 flex items-center justify-between gap-1 font-mono text-[9px] opacity-80">
              <span>{sourceLabel(block.source)}</span>
              <span>{minutesToTime(span.start)}–{minutesToTime(span.end)}</span>
            </div>
            <Show
              when={
                item &&
                (item.start < item.end ||
                  span.end === item.end ||
                  (item.start > item.end && item.end === 0 && span.end === 1440))
              }
            >
              <button
                type="button"
                class="absolute inset-x-0 bottom-0 z-30 h-2 cursor-ns-resize bg-transparent"
                aria-label={`Resize ${blockName(block)} end`}
                title="Resize end"
                onPointerDown={(event) => {
                  if (item) beginPointerInteraction(event, day, item, span, "end");
                }}
                onClick={(event) => event.stopPropagation()}
              />
            </Show>
            <Show when={item}>
              <button
                type="button"
                class="absolute right-0.5 top-0.5 hidden text-xs text-error group-hover:block"
                onClick={(event) => {
                  event.stopPropagation();
                  props.store.deleteDayItem(day, item!.id);
                }}
                aria-label={`Delete ${blockName(block)}`}
              >
                x
              </button>
            </Show>
          </div>
        );
      }}
    </For>
  );

  const renderSegment = (segment: ScheduledSegment) => {
    const isWork = segment._tag === "work";
    const workTitle = isWork ? segment.todoTitle : undefined;
    return (
      <div
          class={`pointer-events-none absolute inset-x-1 z-10 overflow-hidden rounded border px-1 text-[9px] leading-tight ${
          isWork
            ? "border-primary/60 bg-primary/20 text-primary-content"
            : "border-base-content/20 bg-base-300/70 text-base-content/65"
        }`}
        style={timelineBlockStyle(segment)}
        aria-label={isWork ? `Derived work: ${segment.todoTitle}` : `Derived ${segment.breakType} break`}
      >
        <div class="flex items-center justify-between gap-1 font-mono">
          <span>{isWork ? `Pomodoro ${segment.pomodoroNumber}` : segment.breakType === "long" ? "Long break" : "Short break"}</span>
          <span>{minutesToTime(segment.start)}–{minutesToTime(segment.end)}</span>
        </div>
        <Show when={isWork}>
          <div class="truncate">{workTitle}</div>
        </Show>
      </div>
    );
  };

  return (
    <div class="space-y-6">
      <WeekStrip
        store={props.store}
        onOpenEditItem={props.onOpenEditItem}
        onOpenTemplate={props.onOpenTemplate}
        onDropRefused={props.onDropRefused}
        onPlacementNotice={props.onPlacementNotice}
      />

      <section aria-labelledby="week-timeline-heading" class="space-y-3">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="week-timeline-heading" class="text-lg font-bold">Week timeline</h2>
            <p class="text-xs text-base-content/60">One shared local wall-clock scale. Stored occupancy is primary; the derived plan is read-only.</p>
          </div>
          <div class="flex flex-wrap gap-2 text-[10px] text-base-content/60">
            <span class="badge badge-sm border border-base-content/30 bg-base-content/10">Template</span>
            <span class="badge badge-sm border border-secondary/60 bg-secondary/20">Override</span>
            <span class="badge badge-sm border border-info border-dashed bg-info/15">Boundary</span>
            <span class="badge badge-sm border border-primary/60 bg-primary/20">Derived</span>
          </div>
        </div>
        <Show when={pointerPreview()}>
          {(preview) => (
            <div
              class={`rounded-md border px-3 py-2 text-xs ${preview().refused ? "border-error/40 bg-error/10 text-error" : preview().adjusted ? "border-warning/40 bg-warning/10 text-warning-content" : "border-info/40 bg-info/10 text-info-content"}`}
              aria-live="polite"
              data-testid="timeline-preview-status"
            >
              {preview().message}
            </div>
          )}
        </Show>

        <div class="overflow-x-auto rounded-box border border-base-300 bg-base-100 shadow-sm" data-testid="week-timeline-scroll">
          <div class="min-w-[1000px]">
            <div class="grid grid-cols-[4.5rem_repeat(7,minmax(8.5rem,1fr))] border-b border-base-300 bg-base-200/50">
              <div aria-hidden="true" />
              <For each={WEEKDAY_NAMES}>
                {(day) => {
                  const isToday = () => todayWeekday() === day;
                  return (
                    <div class={`border-l border-base-300 px-2 py-2 ${isToday() ? "bg-primary/10" : ""}`}>
                      <div class="flex items-center justify-between gap-1">
                        <span class="text-xs font-bold">{DAY_LABELS[day]}</span>
                        <Show when={isToday()}>
                          <span class="badge badge-primary badge-xs">Today</span>
                        </Show>
                      </div>
                      <div class="text-[10px] capitalize text-base-content/50">{day}</div>
                    </div>
                  );
                }}
              </For>
            </div>

            <div
              ref={timelineCanvas}
              class="grid grid-cols-[4.5rem_repeat(7,minmax(8.5rem,1fr))]"
              onPointerMove={updatePointerPreview}
              onPointerUp={finishPointerInteraction}
              onPointerCancel={cancelPointerInteraction}
            >
              <div class="relative border-r border-base-300" style={{ height: `${TIMELINE_HEIGHT}px` }} aria-hidden="true">
                <For each={TIME_LABELS}>
                  {(minute) => (
                    <span class="absolute right-2 -translate-y-1/2 font-mono text-[10px] tabular-nums text-base-content/55" style={{ top: `${timelinePercent(minute)}%` }}>
                      {minutesToTime(minute)}
                    </span>
                  )}
                </For>
              </div>

              <For each={WEEKDAY_NAMES}>
                {(day) => {
                  const blocks = () => blocksFor(day);
                  const segments = () => weekSchedule()[day].segments;
                  return (
                    <div
                      ref={(element) => columnElements.set(day, element)}
                      class={`relative border-r border-base-200 ${dropHighlight() === day ? "bg-info/5 ring-2 ring-inset ring-info/40" : ""}`}
                      style={{ height: `${TIMELINE_HEIGHT}px` }}
                      role="gridcell"
                      aria-label={`${DAY_LABELS[day]} timeline, 00:00 to 24:00`}
                      onClick={(event) => {
                        if (event.target !== event.currentTarget || suppressClick) return;
                        const emptyPlacement = emptyTimelinePlacement(
                          minuteAt(event.clientY),
                        );
                        const start = emptyPlacement.start;
                        const occupied = blocks().some((block) =>
                          spansOverlap({ start, end: start + 1 }, block),
                        ) || segments().some((segment) =>
                          spansOverlap({ start, end: start + 1 }, segment),
                        );
                        if (!occupied) {
                          props.onOpenAddItem(day, "busy", start, emptyPlacement.end);
                        }
                      }}
                      onDragOver={(event) => handleColumnDragOver(event, day)}
                      onDrop={(event) => handleColumnDrop(event, day)}
                      onDragLeave={() => {
                        if (dropHighlight() === day) setDropHighlight(null);
                      }}
                    >
                      <For each={TIME_LABELS}>
                        {(minute) => (
                          <div class="pointer-events-none absolute inset-x-0 border-t border-base-200/80" style={{ top: `${timelinePercent(minute)}%` }} />
                        )}
                      </For>
                      <For each={blocks()}>{(block) => renderBlock(day, block)}</For>
                      <For each={segments()}>{(segment) => renderSegment(segment)}</For>
                      <Show when={pointerPreview()?.day === day && !pointerPreview()?.refused}>
                        <For each={splitTimelineSpan(pointerPreview()!.start, pointerPreview()!.end)}>
                          {(span) => (
                            <div
                              class="pointer-events-none absolute inset-x-1 z-40 overflow-hidden rounded-md border-2 border-warning bg-warning/25 p-1 text-[10px] font-semibold text-warning-content shadow-md"
                              style={timelineBlockStyle(span)}
                              data-testid="timeline-preview"
                            >
                              Preview {minutesToTime(span.start)}–{minutesToTime(span.end)}
                            </div>
                          )}
                        </For>
                      </Show>
                      <Show when={blocks().length === 0 && segments().length === 0}>
                        <div class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-base-content/25">No occupancy</div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </div>
      </section>

      <section class="card border border-base-300 bg-base-100 shadow-sm" aria-labelledby="week-todos-heading">
        <div class="card-body p-4">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-base-200 pb-3">
            <div>
              <h3 id="week-todos-heading" class="card-title text-base font-bold"><span>🍅</span><span>Week Todos</span><span class="badge badge-sm badge-neutral">{props.store.doc.todos.length}</span></h3>
              <p class="text-xs text-base-content/60">Work is sized by pomodoros and placed into free gaps by priority.</p>
            </div>
            <button type="button" class="btn btn-sm btn-primary" onClick={() => props.onOpenAddItem(undefined, "todo")}>+ Add Todo</button>
          </div>

          <Show when={props.store.doc.todos.length > 0} fallback={<div class="py-6 text-center text-xs italic text-base-content/40">No todos recorded for this week yet. Click "+ Add Todo" to schedule work!</div>}>
            <div class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              <For each={props.store.doc.todos}>
                {(todo) => (
                  <div
                    class="flex cursor-grab items-center justify-between rounded-lg border border-base-200 bg-base-200/40 p-2.5 active:cursor-grabbing"
                    draggable
                    onDragStart={(event) => beginDrag(event.dataTransfer, { kind: "todo", item: todo })}
                    title="Drag onto a day column to set its due date"
                  >
                    <div class="min-w-0 pr-2">
                      <div class="flex items-center gap-1.5 truncate"><span class={`badge badge-xs font-bold ${PRIORITY_BADGES[todo.priority]}`}>{todo.priority}</span><span class="truncate text-sm font-medium">{todo.title}</span></div>
                      <div class="mt-1 flex items-center gap-2 text-xs text-base-content/70"><span>{todo.pomodoros} {todo.pomodoros === 1 ? "pomodoro" : "pomodoros"}</span><Show when={todo.dueDate}><span class="badge badge-outline badge-xs capitalize">Due {DAY_LABELS[todo.dueDate!]}</span></Show></div>
                    </div>
                    <div class="flex shrink-0 gap-1"><button type="button" class="btn btn-ghost btn-xs" onClick={() => props.onOpenEditItem(todo)}>Edit</button><button type="button" class="btn btn-ghost btn-xs text-error" onClick={() => props.store.deleteTodo(todo.id)}>Delete</button></div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </section>
    </div>
  );
}
