import { createMemo, For, Show } from "solid-js";
import {
  DAY_LABELS,
  type DayItem,
  type DayOfWeek,
  type Todo,
  WEEKDAY_NAMES,
} from "../schema";
import {
  computeSchedule,
  expandDay,
  type DaySchedule,
  type ScheduledSegment,
} from "../engine";
import {
  beginDrag,
  commitDropOnDay,
  getDragPayload,
  wouldPayloadCollide,
} from "../drag";
import type { CalendarStore } from "../state";
import { formatTimeSpan, getTodayWeekday, minutesToTime } from "../time";
import { PRIORITY_BADGES } from "./itemStyles";
import type { ItemType } from "./ItemModal";
import TimeGrid from "./TimeGrid";

interface DayViewProps {
  store: CalendarStore;
  onOpenAddItem?: (day: DayOfWeek, defaultType?: ItemType) => void;
  onOpenEditItem?: (item: DayItem | Todo) => void;
  onOpenTemplate?: (day: DayOfWeek) => void;
  onDropRefused?: (reason: string) => void;
}

export default function DayView(props: DayViewProps) {
  const todayWeekday = createMemo(() => {
    return getTodayWeekday(props.store.doc.settings.timezone);
  });

  const derivedSchedule = createMemo<DaySchedule | null>(() => {
    if (!props.store.isLoaded()) return null;
    const weekSchedule = computeSchedule(props.store.doc);
    return weekSchedule[props.store.selectedDay()];
  });

  const selectedDayItems = createMemo(() => {
    const day = props.store.selectedDay();
    const items = props.store.doc.days[day]?.items ?? [];
    return [...items].sort((a, b) => a.start - b.start);
  });

  const recurringBlocks = createMemo(() => {
    const day = props.store.selectedDay();
    const dayData = props.store.doc.days[day];
    if (!dayData) return [];
    return expandDay(dayData).filter((b) => b.source !== "one-off");
  });

  const hasRecurring = createMemo(() => recurringBlocks().length > 0);

  const handleDayTabDragOver = (e: DragEvent, targetDay: DayOfWeek) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    const payload = getDragPayload(dt);
    if (!payload) return;
    e.preventDefault();
    const collides =
      payload.kind === "day-item" &&
      wouldPayloadCollide(props.store, payload, targetDay, {
        start: payload.item.start,
        end: payload.item.end,
      });
    dt.dropEffect = collides ? "none" : "move";
  };

  const handleDayTabDrop = (e: DragEvent, targetDay: DayOfWeek) => {
    e.preventDefault();
    const payload = getDragPayload(e.dataTransfer);
    if (!payload) return;
    const result = commitDropOnDay(props.store, payload, targetDay);
    if (!result.ok) props.onDropRefused?.(result.reason);
  };

  return (
    <div class="space-y-6">
      {/* Day Selector Tabs */}
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-base-300 pb-3">
        <div class="flex flex-wrap gap-1.5" role="tablist" aria-label="Day selection">
          <For each={WEEKDAY_NAMES}>
            {(day) => {
              const isToday = () => todayWeekday() === day;
              const isSelected = () => props.store.selectedDay() === day;
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={isSelected()}
                  class={`btn btn-sm gap-1.5 ${
                    isSelected() ? "btn-primary" : "btn-ghost"
                  }`}
                  onClick={() => props.store.setSelectedDay(day)}
                  onDragOver={(e) => handleDayTabDragOver(e, day)}
                  onDrop={(e) => handleDayTabDrop(e, day)}
                  title={`Switch to ${day} day view (drop an item here to move it to ${day})`}
                >
                  <span class="capitalize">{DAY_LABELS[day]}</span>
                  <Show when={isToday()}>
                    <span class="badge badge-xs badge-accent uppercase font-bold text-[9px]">
                      Today
                    </span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>

        {/* Quick Add buttons */}
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-sm btn-outline"
            onClick={() =>
              props.onOpenAddItem?.(props.store.selectedDay(), "busy")
            }
          >
            + Add Commitment
          </button>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            onClick={() =>
              props.onOpenAddItem?.(props.store.selectedDay(), "todo")
            }
          >
            + Add Todo
          </button>
        </div>
      </div>

      {/* Weekly Template (recurring) card */}
      <div class="card bg-base-100 shadow-sm border border-base-300">
        <div class="card-body p-4">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="card-title text-base font-bold capitalize">
                ⟳ Weekly Template
              </h2>
              <p class="text-xs text-base-content/60">
                Recurring busy blocks and sleep windows repeat every week; any
                one-off sleep override replaces this day's template sleep for
                one week.
              </p>
            </div>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              onClick={() =>
                props.onOpenTemplate?.(props.store.selectedDay())
              }
            >
              Edit Template
            </button>
          </div>

          <Show
            when={hasRecurring()}
            fallback={
              <div class="py-3 text-center text-xs text-base-content/40 italic">
                No recurring template for {props.store.selectedDay()}. Click
                "Edit Template" to add recurring blocks.
              </div>
            }
          >
            <div class="mt-2 flex flex-wrap gap-1.5">
              <For each={recurringBlocks()}>
                {(block) => (
                  <div
                    class={`rounded-md px-2 py-1 text-xs border border-dashed ${
                      block._tag === "sleep"
                        ? "border-secondary bg-secondary/10 text-secondary-content"
                        : "border-primary bg-primary/10 text-primary-content"
                    }`}
                  >
                    <span class="font-medium">
                      {block._tag === "sleep"
                        ? "Sleep"
                        : block.title}
                    </span>
                    <span class="font-mono text-[10px] opacity-75 ml-1.5">
                      {formatTimeSpan(block.start, block.end)}
                    </span>
                    <span
                      class={`badge badge-xs ml-1.5 ${
                        block.source === "override"
                          ? "badge-secondary"
                          : "badge-ghost"
                      }`}
                    >
                      {block.source === "override" ? "override" : "template"}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>

      {/* Main Grid: Fixed Commitments + Todos + Derived Plan */}
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Column 1: Fixed Commitments, Events & Sleep for Selected Day (4 cols) */}
        <div class="card bg-base-100 shadow-sm border border-base-300 lg:col-span-4">
          <div class="card-body p-4">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="card-title text-base font-bold capitalize">
                  {props.store.selectedDay()} Commitments
                </h2>
                <p class="text-xs text-base-content/60">
                  Fixed blocks (events, busy, sleep). Gaps become available.
                </p>
              </div>
              <div class="dropdown dropdown-end">
                <div
                  tabIndex={0}
                  role="button"
                  class="btn btn-ghost btn-xs btn-circle"
                  title="Add item"
                >
                  +
                </div>
                <ul
                  tabIndex={0}
                  class="dropdown-content menu z-1 bg-base-200 rounded-box w-36 p-2 shadow-lg text-xs"
                >
                  <li>
                    <a
                      onClick={() =>
                        props.onOpenAddItem?.(
                          props.store.selectedDay(),
                          "busy",
                        )
                      }
                    >
                      💼 Busy Block
                    </a>
                  </li>
                  <li>
                    <a
                      onClick={() =>
                        props.onOpenAddItem?.(
                          props.store.selectedDay(),
                          "event",
                        )
                      }
                    >
                      🗓️ Event
                    </a>
                  </li>
                  <li>
                    <a
                      onClick={() =>
                        props.onOpenAddItem?.(
                          props.store.selectedDay(),
                          "sleep",
                        )
                      }
                    >
                      🌙 Sleep Window
                    </a>
                  </li>
                </ul>
              </div>
            </div>

            <div class="mt-3 space-y-1.5">
              <div class="text-[10px] text-base-content/50">
                Drag a block vertically to change its time, or onto a day tab
                above to move it to another day. Overlapping drops are refused.
              </div>
              <Show
                when={selectedDayItems().length > 0}
                fallback={
                  <div class="py-8 text-center text-xs text-base-content/40 italic">
                    No fixed commitments on {props.store.selectedDay()}.
                    Drop an item here from another day or add one above.
                  </div>
                }
              >
                <div class="max-h-[70vh] overflow-y-auto rounded-lg border border-base-200 bg-base-200/30 p-1">
                  <TimeGrid
                    store={props.store}
                    day={props.store.selectedDay()}
                    items={selectedDayItems()}
                    onOpenEditItem={(item) => props.onOpenEditItem?.(item)}
                    onDropRefused={props.onDropRefused}
                  />
                </div>
              </Show>
            </div>
          </div>
        </div>

        {/* Column 2: Todos (Week-Scoped) (4 cols) */}
        <div class="card bg-base-100 shadow-sm border border-base-300 lg:col-span-4">
          <div class="card-body p-4">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="card-title text-base font-bold">Week Todos</h2>
                <p class="text-xs text-base-content/60">
                  Sized by pomodoros, placed in priority order (P0 first).
                </p>
              </div>
              <button
                type="button"
                class="btn btn-primary btn-xs"
                onClick={() =>
                  props.onOpenAddItem?.(props.store.selectedDay(), "todo")
                }
              >
                + Add Todo
              </button>
            </div>

            <div class="mt-3 divide-y divide-base-200">
              <Show
                when={props.store.doc.todos.length > 0}
                fallback={
                  <div class="py-8 text-center text-xs text-base-content/40 italic">
                    No todos yet. Add one to generate pomodoro schedule!
                  </div>
                }
              >
                <For each={props.store.doc.todos}>
                  {(todo) => (
                    <div
                      class="flex items-center justify-between py-2.5 cursor-grab active:cursor-grabbing"
                      draggable
                      onDragStart={(e) =>
                        beginDrag(e.dataTransfer, { kind: "todo", item: todo })
                      }
                      title="Drag onto a day (tab or grid) to set its due date"
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
                        <div class="text-xs text-base-content/70 mt-0.5">
                          {todo.pomodoros}{" "}
                          {todo.pomodoros === 1 ? "pomodoro" : "pomodoros"}
                          <Show when={todo.dueDate}>
                            <span class="ml-1 badge badge-outline badge-xs capitalize">
                              Due {DAY_LABELS[todo.dueDate!]}
                            </span>
                          </Show>
                        </div>
                      </div>
                      <div class="flex gap-1 shrink-0">
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          onClick={() => props.onOpenEditItem?.(todo)}
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
              </Show>
            </div>
          </div>
        </div>

        {/* Column 3: Derived Pomodoro Schedule for Selected Day (4 cols) */}
        <div class="card bg-base-100 shadow-sm border border-base-300 lg:col-span-4">
          <div class="card-body p-4">
            <h2 class="card-title text-base font-bold capitalize">
              {props.store.selectedDay()} Derived Plan
            </h2>
            <p class="text-xs text-base-content/60">
              Derived automatically into free gaps. Never stored or dragged.
            </p>

            <div class="mt-3 space-y-1.5">
              <Show
                when={
                  derivedSchedule() &&
                  derivedSchedule()!.segments.length > 0
                }
                fallback={
                  <div class="py-8 text-center text-xs text-base-content/40 italic">
                    No pomodoro segments scheduled for this day.
                  </div>
                }
              >
                <For each={derivedSchedule()?.segments ?? []}>
                  {(seg: ScheduledSegment) => (
                    <Show
                      when={seg._tag === "work"}
                      fallback={(() => {
                        const brk = seg as Extract<
                          ScheduledSegment,
                          { _tag: "break" }
                        >;
                        return (
                          <div class="flex items-center justify-between rounded bg-base-200/80 px-2.5 py-1 text-xs text-base-content/70 font-mono">
                            <span>
                              {brk.breakType === "long"
                                ? "🌴 Long Break"
                                : "☕ Short Break"}
                            </span>
                            <span>
                              {minutesToTime(brk.start)} – {minutesToTime(brk.end)}
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
                          <div class="flex items-center justify-between rounded bg-primary/10 border-l-2 border-primary px-2.5 py-1.5 text-xs text-primary-content">
                            <div class="flex items-center gap-1.5 min-w-0 text-base-content font-medium">
                              <span
                                class={`badge badge-xs font-bold ${
                                  PRIORITY_BADGES[work.priority]
                                }`}
                              >
                                {work.priority}
                              </span>
                              <span class="truncate">
                                🍅 {work.todoTitle}
                              </span>
                              <Show when={work.isMiniFocus}>
                                <span class="badge badge-xs badge-ghost">
                                  ½
                                </span>
                              </Show>
                            </div>
                            <div class="font-mono text-base-content/70 shrink-0 ml-2 text-right">
                              <span class="text-[10px] opacity-75 mr-1.5">
                                #{work.pomodoroNumber}
                              </span>
                              <span>
                                {minutesToTime(work.start)} – {minutesToTime(work.end)}
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
    </div>
  );
}
