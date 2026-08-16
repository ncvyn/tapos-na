import { createMemo, For, Show } from "solid-js";
import {
  DAY_LABELS,
  type DayItem,
  type DayOfWeek,
  type Todo,
  WEEKDAY_NAMES,
} from "../schema";
import { computeSchedule, type DaySchedule, type ScheduledSegment } from "../engine";
import type { CalendarStore } from "../state";
import { formatTimeSpan, getTodayWeekday, minutesToTime } from "../time";
import { ITEM_ICONS, ITEM_THEMES, PRIORITY_BADGES } from "./itemStyles";
import type { ItemType } from "./ItemModal";

interface DayViewProps {
  store: CalendarStore;
  onOpenAddItem?: (day: DayOfWeek, defaultType?: ItemType) => void;
  onOpenEditItem?: (item: DayItem | Todo) => void;
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

            <div class="mt-3 space-y-2">
              <Show
                when={selectedDayItems().length > 0}
                fallback={
                  <div class="py-8 text-center text-xs text-base-content/40 italic">
                    No fixed commitments on {props.store.selectedDay()}.
                  </div>
                }
              >
                <For each={selectedDayItems()}>
                  {(item) => {
                    const theme = ITEM_THEMES[item._tag];
                    return (
                      <div
                        class={`rounded-lg p-2.5 border transition-all flex items-center justify-between ${theme.card}`}
                      >
                        <div class="min-w-0 pr-2">
                          <div class="flex items-center gap-1.5 truncate text-sm font-medium">
                            <span>{ITEM_ICONS[item._tag]}</span>
                            <span class="truncate">
                              {item._tag === "sleep" ? theme.name : item.title}
                            </span>
                            <span class="badge badge-xs badge-outline opacity-70 uppercase text-[9px]">
                              {item._tag}
                            </span>
                          </div>
                          <div class="text-xs opacity-80 font-mono mt-0.5">
                            {formatTimeSpan(item.start, item.end)}
                          </div>
                        </div>

                        <div class="flex gap-1 shrink-0">
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            onClick={() => props.onOpenEditItem?.(item)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs text-error"
                            onClick={() =>
                              props.store.deleteDayItem(
                                props.store.selectedDay(),
                                item.id,
                              )
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  }}
                </For>
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
                    <div class="flex items-center justify-between py-2.5">
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
