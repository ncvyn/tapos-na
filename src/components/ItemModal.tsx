import { createEffect, createSignal, For, Show } from "solid-js";
import {
  type Busy,
  DAY_LABELS,
  type DayItem,
  type DayOfWeek,
  type Event as CalendarEvent,
  type Priority,
  type Sleep,
  type Todo,
  WEEKDAY_NAMES,
} from "../schema";
import type { CalendarStore } from "../state";
import { getTodayWeekday, minutesToTime, timeToMinutes } from "../time";

export type ItemType = "busy" | "event" | "sleep" | "todo";

interface ItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  store: CalendarStore;
  itemToEdit?: DayItem | Todo | null;
  defaultDay?: DayOfWeek;
  defaultType?: ItemType;
  defaultStart?: number;
  defaultEnd?: number;
}

export default function ItemModal(props: ItemModalProps) {
  const [itemType, setItemType] = createSignal<ItemType>("busy");
  const [day, setDay] = createSignal<DayOfWeek>("monday");
  const [title, setTitle] = createSignal("");
  const [start, setStart] = createSignal("09:00");
  const [end, setEnd] = createSignal("10:00");
  const [pomodoros, setPomodoros] = createSignal(2);
  const [priority, setPriority] = createSignal<Priority>("P1");
  const [dueDate, setDueDate] = createSignal<DayOfWeek | "">("");
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  // Original item metadata for edits
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [originalDay, setOriginalDay] = createSignal<DayOfWeek | null>(null);

  createEffect(() => {
    if (!props.isOpen) return;

    setErrorMessage(null);
    const item = props.itemToEdit;

    if (item) {
      setEditingId(item.id);
      setItemType(item._tag);

      if (item._tag === "todo") {
        setTitle(item.title);
        setPomodoros(item.pomodoros);
        setPriority(item.priority);
        setDueDate(item.dueDate ?? "");
        setOriginalDay(null);
      } else {
        // Day item (busy, event, sleep)
        setDay(item.day);
        setOriginalDay(item.day);
        setStart(minutesToTime(item.start));
        setEnd(minutesToTime(item.end));
        if (item._tag === "busy" || item._tag === "event") {
          setTitle(item.title);
        } else {
          setTitle("");
        }
      }
    } else {
      // New item creation
      setEditingId(null);
      setOriginalDay(null);
      setItemType(props.defaultType ?? "busy");
      setDay(
        props.defaultDay ?? getTodayWeekday(props.store.doc.settings.timezone),
      );
      setTitle("");
      setStart(minutesToTime(props.defaultStart ?? 540));
      setEnd(minutesToTime(props.defaultEnd ?? 600));
      setPomodoros(2);
      setPriority("P1");
      setDueDate("");
    }
  });

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const type = itemType();
    const isEdit = editingId() !== null;
    const id = editingId() ?? crypto.randomUUID();

    if (type === "todo") {
      const trimmedTitle = title().trim();
      if (!trimmedTitle) {
        setErrorMessage("Title is required for a todo");
        return;
      }
      const count = Number(pomodoros());
      if (!count || count < 1 || !Number.isInteger(count)) {
        setErrorMessage("Pomodoros must be a whole number of at least 1");
        return;
      }

      const todo: Todo = {
        _tag: "todo",
        id,
        title: trimmedTitle,
        pomodoros: count,
        priority: priority(),
        dueDate: dueDate() === "" ? undefined : (dueDate() as DayOfWeek),
      };

      if (isEdit) {
        props.store.updateTodo(todo);
      } else {
        props.store.addTodo(todo);
      }
    } else {
      // Busy, Event, or Sleep
      const targetDay = day();
      const startMin = timeToMinutes(start());
      const endMin = timeToMinutes(end());

      if (type === "busy" || type === "event") {
        const trimmedTitle = title().trim();
        if (!trimmedTitle) {
          setErrorMessage(`Title is required for ${type}`);
          return;
        }
        if (endMin <= startMin) {
          setErrorMessage("End time must be after start time");
          return;
        }

        const dayItem: Busy | CalendarEvent = {
          _tag: type,
          id,
          title: trimmedTitle,
          day: targetDay,
          start: startMin,
          end: endMin,
        };

        const saved = commitDayItemEdit(targetDay, startMin, endMin, dayItem);
        if (!saved) {
          setErrorMessage(props.store.errorMessage() ?? "Blocks overlap");
          return;
        }
      } else if (type === "sleep") {
        if (startMin === endMin) {
          setErrorMessage("Sleep start and end times must differ");
          return;
        }

        const sleepItem: Sleep = {
          _tag: "sleep",
          id,
          day: targetDay,
          start: startMin,
          end: endMin,
        };

        const saved = commitDayItemEdit(targetDay, startMin, endMin, sleepItem);
        if (!saved) {
          setErrorMessage(props.store.errorMessage() ?? "Blocks overlap");
          return;
        }
      }
    }

    props.onClose();
  };

  /**
   * Commit an edit of a day item. A same-day edit that changes exactly one
   * time edge is a resize and runs through the shared placement-resolution
   * seam (clamps the active edge, refuses spans shorter than 15 minutes).
   * Anything else — a move to another day, or both edges changed — resolves
   * through the shared move seam (adjusts on collision, refuses when no
   * 15-minute placement exists).
   */
  const commitDayItemEdit = (
    targetDay: DayOfWeek,
    startMin: number,
    endMin: number,
    dayItem: DayItem,
  ): boolean => {
    const isEdit = editingId() !== null;
    if (!isEdit || originalDay() === null)
      return props.store.addDayItem(dayItem);

    const original = props.itemToEdit;
    const originalStart =
      original && original._tag !== "todo" ? original.start : null;
    const originalEnd =
      original && original._tag !== "todo" ? original.end : null;

    const sameDay = targetDay === originalDay();
    const startChanged = originalStart !== null && startMin !== originalStart;
    const endChanged = originalEnd !== null && endMin !== originalEnd;
    const singleEdgeResize = sameDay && startChanged !== endChanged;

    if (singleEdgeResize && original && original._tag !== "todo") {
      return props.store.resizeDayItem(originalDay()!, original, {
        edge: startChanged ? "start" : "end",
        value: startChanged ? startMin : endMin,
      });
    }
    return props.store.moveDayItem(
      originalDay()!,
      dayItem,
      targetDay,
      startMin,
      endMin,
    );
  };

  return (
    <Show when={props.isOpen}>
      <div class="modal modal-open" role="dialog" aria-modal="true">
        <div class="modal-box max-w-lg">
          <div class="flex items-center justify-between border-b border-base-200 pb-3">
            <h3 class="font-bold text-lg">
              {editingId() ? "Edit Item" : "New Calendar Item"}
            </h3>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-circle"
              onClick={props.onClose}
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSubmit} class="mt-4 space-y-4">
            <Show when={errorMessage()}>
              <div class="alert alert-error text-xs py-2">
                <span>{errorMessage()}</span>
              </div>
            </Show>

            {/* Item Type Selector (Tabs) - only for new items */}
            <Show
              when={!editingId()}
              fallback={
                <div class="badge badge-outline badge-md capitalize font-semibold">
                  {itemType()}
                </div>
              }
            >
              <div class="form-control">
                <label class="label pt-0">
                  <span class="label-text font-medium">Item Type</span>
                </label>
                <div class="grid grid-cols-4 gap-1.5" role="radiogroup">
                  <button
                    type="button"
                    class={`btn btn-sm text-xs flex-col py-1 h-auto ${
                      itemType() === "busy" ? "btn-primary" : "btn-outline"
                    }`}
                    onClick={() => setItemType("busy")}
                  >
                    <span>💼</span>
                    <span>Busy</span>
                  </button>
                  <button
                    type="button"
                    class={`btn btn-sm text-xs flex-col py-1 h-auto ${
                      itemType() === "event" ? "btn-success" : "btn-outline"
                    }`}
                    onClick={() => setItemType("event")}
                  >
                    <span>🗓️</span>
                    <span>Event</span>
                  </button>
                  <button
                    type="button"
                    class={`btn btn-sm text-xs flex-col py-1 h-auto ${
                      itemType() === "sleep" ? "btn-secondary" : "btn-outline"
                    }`}
                    onClick={() => setItemType("sleep")}
                  >
                    <span>🌙</span>
                    <span>Sleep</span>
                  </button>
                  <button
                    type="button"
                    class={`btn btn-sm text-xs flex-col py-1 h-auto ${
                      itemType() === "todo" ? "btn-accent" : "btn-outline"
                    }`}
                    onClick={() => setItemType("todo")}
                  >
                    <span>🍅</span>
                    <span>Todo</span>
                  </button>
                </div>
              </div>
            </Show>

            {/* Title field (Busy, Event, Todo) */}
            <Show when={itemType() !== "sleep"}>
              <div class="form-control">
                <label class="label">
                  <span class="label-text">Title</span>
                </label>
                <input
                  type="text"
                  class="input input-bordered w-full"
                  placeholder={
                    itemType() === "busy"
                      ? "e.g. Physics Lecture, Work Shift"
                      : itemType() === "event"
                        ? "e.g. Dentist, Team Meeting"
                        : "e.g. Write Assignment 2"
                  }
                  value={title()}
                  onInput={(e) => setTitle(e.currentTarget.value)}
                  required
                  autofocus
                />
              </div>
            </Show>

            {/* Day field (for Busy, Event, Sleep) */}
            <Show when={itemType() !== "todo"}>
              <div class="form-control">
                <label class="label">
                  <span class="label-text">Day of Week</span>
                </label>
                <select
                  class="select select-bordered w-full capitalize"
                  value={day()}
                  onChange={(e) => setDay(e.currentTarget.value as DayOfWeek)}
                >
                  <For each={WEEKDAY_NAMES}>
                    {(d) => (
                      <option value={d} class="capitalize">
                        {DAY_LABELS[d]} ({d})
                      </option>
                    )}
                  </For>
                </select>
              </div>

              {/* Time Span */}
              <div class="grid grid-cols-2 gap-3">
                <div class="form-control">
                  <label class="label">
                    <span class="label-text">Start Time</span>
                  </label>
                  <input
                    type="time"
                    class="input input-bordered w-full"
                    value={start()}
                    onInput={(e) => setStart(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="form-control">
                  <label class="label">
                    <span class="label-text">End Time</span>
                  </label>
                  <input
                    type="time"
                    class="input input-bordered w-full"
                    value={end()}
                    onInput={(e) => setEnd(e.currentTarget.value)}
                    required
                  />
                </div>
              </div>
              <Show when={itemType() === "sleep"}>
                <p class="text-xs text-base-content/60 italic">
                  Tip: Sleep windows can cross midnight (e.g. 23:00 to 07:00).
                </p>
              </Show>
            </Show>

            {/* Todo specific fields */}
            <Show when={itemType() === "todo"}>
              <div class="grid grid-cols-3 gap-3">
                <div class="form-control">
                  <label class="label">
                    <span class="label-text">Pomodoros</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    class="input input-bordered w-full"
                    value={pomodoros()}
                    onInput={(e) =>
                      setPomodoros(parseInt(e.currentTarget.value, 10) || 1)
                    }
                    required
                  />
                </div>

                <div class="form-control">
                  <label class="label">
                    <span class="label-text">Priority</span>
                  </label>
                  <select
                    class="select select-bordered w-full"
                    value={priority()}
                    onChange={(e) =>
                      setPriority(e.currentTarget.value as Priority)
                    }
                  >
                    <option value="P0">P0 (Critical)</option>
                    <option value="P1">P1 (High)</option>
                    <option value="P2">P2 (Medium)</option>
                    <option value="P3">P3 (Low)</option>
                    <option value="P4">P4 (Lowest)</option>
                  </select>
                </div>

                <div class="form-control">
                  <label class="label">
                    <span class="label-text">Due Date</span>
                  </label>
                  <select
                    class="select select-bordered w-full"
                    value={dueDate()}
                    onChange={(e) =>
                      setDueDate(
                        e.currentTarget.value === ""
                          ? ""
                          : (e.currentTarget.value as DayOfWeek),
                      )
                    }
                  >
                    <option value="">None</option>
                    <For each={WEEKDAY_NAMES}>
                      {(d) => (
                        <option value={d} class="capitalize">
                          {DAY_LABELS[d]}
                        </option>
                      )}
                    </For>
                  </select>
                </div>
              </div>
            </Show>

            <div class="modal-action border-t border-base-200 pt-3">
              <button
                type="button"
                class="btn btn-ghost"
                onClick={props.onClose}
              >
                Cancel
              </button>
              <button type="submit" class="btn btn-primary">
                {editingId() ? "Save Changes" : "Create Item"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
