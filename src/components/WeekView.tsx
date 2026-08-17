import { createMemo, createSignal, For, Show } from "solid-js";
import {
  DAY_LABELS,
  type DayItem,
  type DayOfWeek,
  type Todo,
  WEEKDAY_NAMES,
} from "../schema";
import {
  computeSchedule,
  type DaySchedule,
  type ScheduledSegment,
} from "../engine";
import { getWeekDayOccupancy } from "../occupancy";
import {
  beginDrag,
  commitDropOnDay,
  getDragPayload,
  wouldPayloadCollide,
} from "../drag";
import type { CalendarStore } from "../state";
import { formatTimeSpan, getTodayWeekday, minutesToTime } from "../time";
import { ITEM_ICONS, ITEM_THEMES, PRIORITY_BADGES } from "./itemStyles";

interface WeekViewProps {
  store: CalendarStore;
  onOpenAddItem: (day: DayOfWeek, defaultType?: "busy" | "event" | "sleep" | "todo") => void;
  onOpenEditItem: (item: DayItem | Todo) => void;
  onOpenTemplate?: (day: DayOfWeek) => void;
  onDropRefused?: (reason: string) => void;
}

export default function WeekView(props: WeekViewProps) {
  const todayWeekday = createMemo(() => {
    return getTodayWeekday(props.store.doc.settings.timezone);
  });

  const weekSchedule = createMemo<Record<DayOfWeek, DaySchedule>>(() => {
    return computeSchedule(props.store.doc);
  });

  const [dropHighlight, setDropHighlight] = createSignal<DayOfWeek | null>(null);

  const handleColumnDragOver = (e: DragEvent, day: DayOfWeek) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    const payload = getDragPayload(dt);
    if (!payload) return;
    e.preventDefault();
    const collides =
      payload.kind === "day-item" &&
      wouldPayloadCollide(props.store, payload, day, {
        start: payload.item.start,
        end: payload.item.end,
      });
    dt.dropEffect = collides ? "none" : "move";
    if (!collides) setDropHighlight(day);
    else if (dropHighlight() === day) setDropHighlight(null);
  };

  const handleColumnDrop = (e: DragEvent, day: DayOfWeek) => {
    e.preventDefault();
    setDropHighlight(null);
    const payload = getDragPayload(e.dataTransfer);
    if (!payload) return;
    const result = commitDropOnDay(props.store, payload, day);
    if (!result.ok) props.onDropRefused?.(result.reason);
  };

  return (
    <div class="space-y-6">
      {/* Week Grid */}
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-7">
        <For each={WEEKDAY_NAMES}>
          {(day) => {
            const isToday = () => todayWeekday() === day;
            const dayData = () => props.store.doc.days[day];
            const schedule = () => weekSchedule()[day];
            const dayBlocks = () =>
              dayData() ? getWeekDayOccupancy(dayData()!).effectiveBlocks : [];
            const templateBlocks = () =>
              dayBlocks().filter((b) => b.source === "template");
            const overrideBlocks = () =>
              dayBlocks().filter((b) => b.source === "override");
            const oneOffItems = () =>
              [...(dayData()?.items ?? [])].sort((a, b) => a.start - b.start);
            const hasFixed = () =>
              templateBlocks().length +
                overrideBlocks().length +
                oneOffItems().length >
              0;

            return (
              <div
                class={`card flex flex-col transition-all border ${
                  isToday()
                    ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary/20"
                    : "border-base-300 bg-base-100 shadow-xs hover:border-base-content/20"
                } ${
                  dropHighlight() === day
                    ? "ring-2 ring-info/50 border-info"
                    : ""
                }`}
                onDragOver={(e: DragEvent) => handleColumnDragOver(e, day)}
                onDrop={(e: DragEvent) => handleColumnDrop(e, day)}
                onDragLeave={() => {
                  if (dropHighlight() === day) setDropHighlight(null);
                }}
              >
                {/* Column Header */}
                <div
                  class={`p-3 border-b ${
                    isToday()
                      ? "border-primary/20 bg-primary/10"
                      : "border-base-200 bg-base-200/40"
                  }`}
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <button
                        type="button"
                        class="text-sm font-bold capitalize hover:underline truncate text-left"
                        onClick={() => {
                          props.store.setSelectedDay(day);
                          props.store.setViewMode("day");
                        }}
                        title={`Switch to ${day} day view`}
                      >
                        {DAY_LABELS[day]}
                      </button>
                      <Show when={isToday()}>
                        <span class="badge badge-primary badge-xs uppercase font-bold tracking-wider">
                          Today
                        </span>
                      </Show>
                    </div>

                    <button
                      type="button"
                      class="btn btn-ghost btn-xs btn-circle shrink-0"
                      onClick={() => props.onOpenAddItem(day, "busy")}
                      title={`Add item to ${day}`}
                      aria-label={`Add item to ${day}`}
                    >
                      +
                    </button>
                  </div>
                  <div class="text-[10px] text-base-content/60 capitalize truncate">
                    {day}
                  </div>
                </div>

                {/* Day Content Body */}
                <div class="p-2.5 flex-1 space-y-3">
                  {/* Fixed Commitments & Events (template-inherited, override, one-off) */}
                  <div class="space-y-1.5">
                    <Show when={templateBlocks().length > 0}>
                      <div class="space-y-1">
                        <div class="text-[10px] font-semibold text-base-content/50 uppercase tracking-wider flex items-center gap-1">
                          <span>⟳ Template</span>
                          <span class="badge badge-ghost badge-xs text-[9px]">
                            recurring
                          </span>
                        </div>
                        <For each={templateBlocks()}>
                          {(block) => {
                            const theme = ITEM_THEMES[block._tag];
                            return (
                              <div
                                class={`group relative rounded-md p-1.5 text-xs transition-all cursor-pointer border border-dashed ${theme.card}`}
                                onClick={() => props.onOpenTemplate?.(day)}
                                title={`Edit ${day} weekly template`}
                              >
                                <div class="font-medium truncate flex items-center gap-1">
                                  <span>{ITEM_ICONS[block._tag]}</span>
                                  <span class="truncate">
                                    {block._tag === "sleep"
                                      ? theme.name
                                      : block.title}
                                  </span>
                                </div>
                                <div class="text-[10px] opacity-80 font-mono mt-0.5">
                                  {formatTimeSpan(block.start, block.end)}
                                </div>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
  
                    <Show when={overrideBlocks().length > 0}>
                      <div class="space-y-1">
                        <div class="text-[10px] font-semibold text-secondary uppercase tracking-wider flex items-center gap-1">
                          <span>⏰ Override</span>
                          <span class="badge badge-secondary badge-xs text-[9px]">
                            this week
                          </span>
                        </div>
                        <For each={overrideBlocks()}>
                          {(block) => (
                            <div
                              class={`group relative rounded-md p-1.5 text-xs transition-all cursor-pointer border border-dashed border-secondary ${ITEM_THEMES[block._tag].card}`}
                              onClick={() => props.onOpenTemplate?.(day)}
                              title={`Edit ${day} sleep override`}
                            >
                              <div class="font-medium truncate flex items-center gap-1">
                                <span>{ITEM_ICONS[block._tag]}</span>
                                <span class="truncate">
                                  {ITEM_THEMES[block._tag].name}
                                </span>
                              </div>
                              <div class="text-[10px] opacity-80 font-mono mt-0.5">
                                {formatTimeSpan(block.start, block.end)}
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
  
                    <Show
                      when={oneOffItems().length > 0}
                      fallback={
                        <Show when={!hasFixed()}>
                          <div class="py-2 text-center text-[11px] text-base-content/40">
                            No fixed blocks
                          </div>
                        </Show>
                      }
                    >
                      <div class="space-y-1">
                        <div class="text-[10px] font-semibold text-base-content/50 uppercase tracking-wider flex items-center gap-1">
                          <span>One-off</span>
                          <span class="badge badge-neutral badge-xs text-[9px]">
                            this week
                          </span>
                        </div>
                        <For each={oneOffItems()}>
                          {(item) => {
                            const theme = ITEM_THEMES[item._tag];
                            return (
                              <div
                                class={`group relative rounded-md p-2 text-xs transition-all cursor-grab active:cursor-grabbing border ${theme.card}`}
                                draggable
                                onDragStart={(e) =>
                                  beginDrag(e.dataTransfer, {
                                    kind: "day-item",
                                    item,
                                  })
                                }
                                onClick={() => props.onOpenEditItem(item)}
                                title="Drag to another day column to move it (same time)"
                              >
                                <div class="flex items-start justify-between gap-1">
                                  <div class="font-medium truncate flex items-center gap-1">
                                    <span>{ITEM_ICONS[item._tag]}</span>
                                    <span class="truncate">
                                      {item._tag === "sleep"
                                        ? theme.name
                                        : item.title}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    class="btn btn-ghost btn-xs text-error opacity-0 group-hover:opacity-100 p-0 h-4 min-h-0 w-4"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      props.store.deleteDayItem(day, item.id);
                                    }}
                                    title="Delete item"
                                    aria-label="Delete item"
                                  >
                                    ×
                                  </button>
                                </div>
                                <div class="text-[10px] opacity-80 font-mono mt-0.5">
                                  {formatTimeSpan(item.start, item.end)}
                                </div>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
                  </div>
  
                    {/* Derived Pomodoro Bands */}
                    <div class="border-t border-base-200/80 pt-2">
                      <div class="text-[10px] font-semibold text-base-content/60 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                        <span>Derived Plan</span>
                        <span class="text-[9px] font-normal normal-case opacity-70">
                          {schedule()?.segments.filter((s) => s._tag === "work").length ?? 0} 🍅
                        </span>
                      </div>
    
                      <div class="space-y-1">
                        <Show
                          when={
                            schedule() && schedule()!.segments.length > 0
                          }
                          fallback={
                            <div class="py-3 text-center text-[10px] text-base-content/30 italic">
                              No pomodoros scheduled
                            </div>
                          }
                        >
                          <For each={schedule()?.segments ?? []}>
                            {(seg: ScheduledSegment) => (
                              <                              Show
                                when={seg._tag === "work"}
                                fallback={(() => {
                                   const brk = seg as Extract<
                                     ScheduledSegment,
                                     { _tag: "break" }
                                   >;
                                   return (
                                     <div class="rounded bg-base-300/40 px-1.5 py-0.5 text-[10px] text-base-content/60 font-mono flex items-center justify-between">
                                       <span>
                                         {brk.breakType === "long"
                                           ? "🌴 Long Break"
                                           : "☕ Short Break"}
                                       </span>
                                       <span>
                                         {minutesToTime(brk.start)}–{minutesToTime(brk.end)}
                                       </span>
                                     </div>
                                   );
                                 })()}
                              >
                                {(() => {
                                  const work = seg as Extract<
                                    ScheduledSegment,
                                    { _tag: "work" }
                                  >;
                                  return (
                                    <div class="rounded bg-primary/15 border-l-2 border-primary px-1.5 py-1 text-[11px] text-base-content">
                                      <div class="flex items-center justify-between gap-1">
                                        <div class="flex items-center gap-1 min-w-0">
                                          <span
                                            class={`badge badge-xs font-bold ${
                                              PRIORITY_BADGES[work.priority]
                                            }`}
                                          >
                                            {work.priority}
                                          </span>
                                          <span class="font-medium truncate">
                                            🍅 {work.todoTitle}
                                          </span>
                                        </div>
                                        <Show when={work.isMiniFocus}>
                                          <span class="badge badge-ghost badge-xs text-[9px] p-0.5">
                                            ½
                                          </span>
                                        </Show>
                                      </div>
                                      <div class="text-[10px] text-base-content/70 font-mono flex items-center justify-between mt-0.5">
                                        <span>
                                          #{work.pomodoroNumber}
                                        </span>
                                        <span>
                                          {minutesToTime(work.start)}–{minutesToTime(work.end)}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </Show>
                            )}
                          </For>
                        </Show>
                    </div>
                  </div>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      {/* Week-Scoped Todos Section in Week View */}
      <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body p-4">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-base-200 pb-3">
            <div>
              <h3 class="card-title text-base font-bold flex items-center gap-2">
                <span>🍅</span>
                <span>Week Todos</span>
                <span class="badge badge-sm badge-neutral">
                  {props.store.doc.todos.length}
                </span>
              </h3>
              <p class="text-xs text-base-content/60">
                Work sized by pomodoros, placed into free gaps across the week by priority (P0 first).
              </p>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-primary"
              onClick={() => props.onOpenAddItem(props.store.selectedDay(), "todo")}
            >
              + Add Todo
            </button>
          </div>

          <div class="mt-3">
            <Show
              when={props.store.doc.todos.length > 0}
              fallback={
                <div class="py-6 text-center text-xs text-base-content/40 italic">
                  No todos recorded for this week yet. Click "+ Add Todo" to schedule work!
                </div>
              }
            >
              <div class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                <For each={props.store.doc.todos}>
                  {(todo) => (
                    <div
                      class="flex items-center justify-between rounded-lg border border-base-200 bg-base-200/40 p-2.5 transition-all hover:border-base-300 cursor-grab active:cursor-grabbing"
                      draggable
                      onDragStart={(e) =>
                        beginDrag(e.dataTransfer, { kind: "todo", item: todo })
                      }
                      title="Drag onto a day column to set its due date"
                    >
                      <div class="min-w-0 pr-2">
                        <div class="flex items-center gap-1.5 truncate">
                          <span
                            class={`badge badge-xs font-bold ${
                              PRIORITY_BADGES[todo.priority]
                            }`}
                          >
                            {todo.priority}
                          </span>
                          <span class="truncate text-sm font-medium">
                            {todo.title}
                          </span>
                        </div>
                        <div class="text-xs text-base-content/70 mt-1 flex items-center gap-2">
                          <span>
                            {todo.pomodoros}{" "}
                            {todo.pomodoros === 1 ? "pomodoro" : "pomodoros"}
                          </span>
                          <Show when={todo.dueDate}>
                            <span class="badge badge-outline badge-xs capitalize">
                              Due {DAY_LABELS[todo.dueDate!]}
                            </span>
                          </Show>
                        </div>
                      </div>

                      <div class="flex gap-1 shrink-0">
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          onClick={() => props.onOpenEditItem(todo)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs text-error"
                          onClick={() => props.store.deleteTodo(todo.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
