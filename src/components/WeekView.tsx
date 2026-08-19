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
  beginDrag,
  commitDropOnDay,
  getDragPayload,
  wouldDropBeRefused,
} from "../drag";
import type { CalendarStore } from "../state";
import { formatTimeSpan, getTodayWeekday, minutesToTime } from "../time";
import { ITEM_ICONS, ITEM_THEMES, PRIORITY_BADGES } from "./itemStyles";
import WeekStrip from "./WeekStrip";
import {
  splitTimelineSpan,
  timelineBlockStyle,
  timelinePercent,
} from "./timeline";

interface WeekViewProps {
  store: CalendarStore;
  onOpenAddItem: (
    day?: DayOfWeek,
    defaultType?: "busy" | "event" | "sleep" | "todo",
  ) => void;
  onOpenEditItem: (item: DayItem | Todo) => void;
  onOpenTemplate?: (day: DayOfWeek) => void;
  onDropRefused?: (reason: string) => void;
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

export default function WeekView(props: WeekViewProps) {
  const todayWeekday = createMemo(() => getTodayWeekday(props.store.doc.settings.timezone));
  const weekSchedule = createMemo(() => computeSchedule(props.store.doc));
  const [dropHighlight, setDropHighlight] = createSignal<DayOfWeek | null>(null);

  const handleColumnDragOver = (event: DragEvent, day: DayOfWeek) => {
    const payload = getDragPayload(event.dataTransfer);
    if (!payload) return;
    event.preventDefault();
    const refused = payload.kind === "day-item" && wouldDropBeRefused(props.store, payload, day);
    event.dataTransfer!.dropEffect = refused ? "none" : "move";
    setDropHighlight(refused ? null : day);
  };

  const handleColumnDrop = (event: DragEvent, day: DayOfWeek) => {
    event.preventDefault();
    setDropHighlight(null);
    const payload = getDragPayload(event.dataTransfer);
    if (!payload) return;
    const result = commitDropOnDay(props.store, payload, day);
    if (!result.ok) props.onDropRefused?.(result.reason);
  };

  const blocksFor = (day: DayOfWeek) =>
    getWeekDayOccupancy(
      props.store.doc.days[day],
      day === "monday" ? props.store.doc.boundaryOccupancy : [],
    ).effectiveBlocks;

  const handleBlockClick = (day: DayOfWeek, block: EffectiveBlock) => {
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
            role={isInteractive(block) ? "button" : undefined}
            aria-readonly={block.source !== "one-off"}
            tabIndex={isInteractive(block) ? 0 : undefined}
            onDragStart={(event) => {
              if (item) beginDrag(event.dataTransfer, { kind: "day-item", item });
            }}
            onClick={() => handleBlockClick(day, block)}
            onKeyDown={(event) => {
              if (isInteractive(block) && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                handleBlockClick(day, block);
              }
            }}
            title={`${sourceLabel(block.source)}: ${continuation ? "Sleep continuation" : blockName(block)} (${formatTimeSpan(span.start, span.end)})`}
            aria-label={`${sourceLabel(block.source)} ${blockName(block)}, ${minutesToTime(span.start)} to ${minutesToTime(span.end)}`}
          >
            <div class="flex items-start gap-1 font-medium">
              <span>{ITEM_ICONS[block._tag]}</span>
              <span class="truncate">{continuation ? "Sleep continuation" : blockName(block)}</span>
            </div>
            <div class="mt-0.5 flex items-center justify-between gap-1 font-mono text-[9px] opacity-80">
              <span>{sourceLabel(block.source)}</span>
              <span>{minutesToTime(span.start)}–{minutesToTime(span.end)}</span>
            </div>
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

            <div class="grid grid-cols-[4.5rem_repeat(7,minmax(8.5rem,1fr))]">
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
                      class={`relative border-r border-base-200 ${dropHighlight() === day ? "bg-info/5 ring-2 ring-inset ring-info/40" : ""}`}
                      style={{ height: `${TIMELINE_HEIGHT}px` }}
                      role="gridcell"
                      aria-label={`${DAY_LABELS[day]} timeline, 00:00 to 24:00`}
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
