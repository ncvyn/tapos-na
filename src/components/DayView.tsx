import {
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import {
  type Busy,
  DAY_LABELS,
  type DayOfWeek,
  type Priority,
  type Todo,
  WEEKDAY_NAMES,
} from "../schema";
import { computeSchedule, type DaySchedule } from "../engine";
import { createCalendarStore } from "../state";

const PRIORITY_BADGES: Record<Priority, string> = {
  P0: "badge-error",
  P1: "badge-warning",
  P2: "badge-primary",
  P3: "badge-info",
  P4: "badge-ghost",
};

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function timeToMinutes(timeStr: string): number {
  const [hStr, mStr] = timeStr.split(":");
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  return Math.min(1440, Math.max(0, h * 60 + m));
}

export default function DayView() {
  const store = createCalendarStore();

  onMount(() => {
    void store.load();
  });

  // Active form state for adding / editing Busy Block
  const [busyModalOpen, setBusyModalOpen] = createSignal(false);
  const [editingBusyId, setEditingBusyId] = createSignal<string | null>(null);
  const [busyTitle, setBusyTitle] = createSignal("");
  const [busyStart, setBusyStart] = createSignal("09:00");
  const [busyEnd, setBusyEnd] = createSignal("10:00");
  const [busyFormError, setBusyFormError] = createSignal<string | null>(null);

  // Active form state for adding / editing Todo
  const [todoModalOpen, setTodoModalOpen] = createSignal(false);
  const [editingTodoId, setEditingTodoId] = createSignal<string | null>(null);
  const [todoTitle, setTodoTitle] = createSignal("");
  const [todoPomodoros, setTodoPomodoros] = createSignal(2);
  const [todoPriority, setTodoPriority] = createSignal<Priority>("P1");
  const [todoDueDate, setTodoDueDate] = createSignal<DayOfWeek | "">("");
  const [todoFormError, setTodoFormError] = createSignal<string | null>(null);

  // Import modal state
  const [importModalOpen, setImportModalOpen] = createSignal(false);
  const [importJsonText, setImportJsonText] = createSignal("");
  const [importError, setImportError] = createSignal<string | null>(null);

  // Derived schedule for selected day (cascades across the full week)
  const derivedSchedule = createMemo<DaySchedule | null>(() => {
    if (!store.isLoaded()) return null;
    const weekSchedule = computeSchedule(store.doc);
    return weekSchedule[store.selectedDay()];
  });

  // Busy block handlers
  const openAddBusyModal = () => {
    setEditingBusyId(null);
    setBusyTitle("");
    setBusyStart("09:00");
    setBusyEnd("10:00");
    setBusyFormError(null);
    setBusyModalOpen(true);
  };

  const openEditBusyModal = (busy: Busy) => {
    setEditingBusyId(busy.id);
    setBusyTitle(busy.title);
    setBusyStart(minutesToTime(busy.start));
    setBusyEnd(minutesToTime(busy.end));
    setBusyFormError(null);
    setBusyModalOpen(true);
  };

  const handleSaveBusy = (e: SubmitEvent) => {
    e.preventDefault();
    const title = busyTitle().trim();
    if (!title) {
      setBusyFormError("Title is required");
      return;
    }
    const startMin = timeToMinutes(busyStart());
    const endMin = timeToMinutes(busyEnd());
    if (endMin <= startMin) {
      setBusyFormError("End time must be after start time");
      return;
    }

    const currentDay = store.selectedDay();
    const editId = editingBusyId();

    if (editId) {
      const updated: Busy = {
        _tag: "busy",
        id: editId,
        title,
        day: currentDay,
        start: startMin,
        end: endMin,
      };
      store.updateBusy(currentDay, updated);
    } else {
      const newBusy: Busy = {
        _tag: "busy",
        id: crypto.randomUUID(),
        title,
        day: currentDay,
        start: startMin,
        end: endMin,
      };
      store.addBusy(currentDay, newBusy);
    }
    setBusyModalOpen(false);
  };

  // Todo handlers
  const openAddTodoModal = () => {
    setEditingTodoId(null);
    setTodoTitle("");
    setTodoPomodoros(2);
    setTodoPriority("P1");
    setTodoDueDate("");
    setTodoFormError(null);
    setTodoModalOpen(true);
  };

  const openEditTodoModal = (todo: Todo) => {
    setEditingTodoId(todo.id);
    setTodoTitle(todo.title);
    setTodoPomodoros(todo.pomodoros);
    setTodoPriority(todo.priority);
    setTodoDueDate(todo.dueDate ?? "");
    setTodoFormError(null);
    setTodoModalOpen(true);
  };

  const handleSaveTodo = (e: SubmitEvent) => {
    e.preventDefault();
    const title = todoTitle().trim();
    if (!title) {
      setTodoFormError("Title is required");
      return;
    }
    const pomodoros = Number(todoPomodoros());
    if (!pomodoros || pomodoros < 1) {
      setTodoFormError("Pomodoro count must be at least 1");
      return;
    }

    const editId = editingTodoId();
    const due = todoDueDate() === "" ? undefined : todoDueDate() as DayOfWeek;

    if (editId) {
      const updated: Todo = {
        _tag: "todo",
        id: editId,
        title,
        pomodoros,
        priority: todoPriority(),
        dueDate: due,
      };
      store.updateTodo(updated);
    } else {
      const newTodo: Todo = {
        _tag: "todo",
        id: crypto.randomUUID(),
        title,
        pomodoros,
        priority: todoPriority(),
        dueDate: due,
      };
      store.addTodo(newTodo);
    }
    setTodoModalOpen(false);
  };

  // Export / Import handlers
  const handleExport = async () => {
    const json = await store.exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tapos-na-calendar.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenImport = () => {
    setImportJsonText("");
    setImportError(null);
    setImportModalOpen(true);
  };

  const handleFileUpload = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImportJsonText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handlePerformImport = async (e: SubmitEvent) => {
    e.preventDefault();
    const text = importJsonText().trim();
    if (!text) {
      setImportError("Please provide JSON content to import.");
      return;
    }
    const result = await store.importJson(text);
    if (result.success) {
      setImportModalOpen(false);
    } else {
      setImportError(result.error ?? "Failed to import JSON");
    }
  };

  const dayBusyItems = createMemo(() => {
    const day = store.selectedDay();
    const items = store.doc.days[day]?.items ?? [];
    return items.filter((item): item is Busy => item._tag === "busy");
  });

  return (
    <div class="space-y-6">
      {/* Top action bar: Week day tabs, Status indicator, Import/Export */}
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-base-300 pb-4">
        {/* Day Selector */}
        <div class="flex flex-wrap gap-1" role="tablist" aria-label="Day selection">
          <For each={WEEKDAY_NAMES}>
            {(day) => (
              <button
                type="button"
                role="tab"
                aria-selected={store.selectedDay() === day}
                class={`btn btn-sm ${
                  store.selectedDay() === day ? "btn-primary" : "btn-ghost"
                }`}
                onClick={() => store.setSelectedDay(day)}
              >
                {DAY_LABELS[day]}
              </button>
            )}
          </For>
        </div>

        {/* Persistence Status & Export/Import */}
        <div class="flex items-center gap-2">
          <Show when={store.status() === "saving"}>
            <span class="text-xs text-base-content/70">Saving...</span>
          </Show>
          <Show when={store.status() === "saved"}>
            <span class="badge badge-xs badge-success">Saved</span>
          </Show>
          <Show when={store.errorMessage()}>
            <div class="badge badge-sm badge-error gap-1">
              <span>{store.errorMessage()}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onClick={store.clearError}
              >
                ×
              </button>
            </div>
          </Show>
          <button
            type="button"
            class="btn btn-sm btn-outline"
            onClick={handleExport}
            title="Export current calendar as JSON"
          >
            Export
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline"
            onClick={handleOpenImport}
            title="Import calendar from JSON"
          >
            Import
          </button>
        </div>
      </div>

      {/* Main content grid: Busy blocks + Todos + Derived schedule preview */}
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Column 1: Busy Blocks for Selected Day (5 cols) */}
        <div class="card bg-base-100 shadow-sm lg:col-span-4">
          <div class="card-body p-4">
            <div class="flex items-center justify-between">
              <h2 class="card-title text-base font-bold capitalize">
                {store.selectedDay()} Busy Blocks
              </h2>
              <button
                type="button"
                class="btn btn-primary btn-xs"
                onClick={openAddBusyModal}
              >
                + Add Busy
              </button>
            </div>
            <p class="text-xs text-base-content/70">
              Fixed commitments (classes, work shifts). Gaps become available for
              pomodoros.
            </p>

            <div class="mt-3 divide-y divide-base-200">
              <Show
                when={dayBusyItems().length > 0}
                fallback={
                  <div class="py-6 text-center text-xs text-base-content/50">
                    No busy blocks on {store.selectedDay()}.
                  </div>
                }
              >
                <For each={dayBusyItems()}>
                  {(busy) => (
                    <div class="flex items-center justify-between py-2">
                      <div class="min-w-0 pr-2">
                        <div class="truncate text-sm font-medium">
                          {busy.title}
                        </div>
                        <div class="text-xs text-base-content/70 font-mono">
                          {minutesToTime(busy.start)} – {minutesToTime(busy.end)} ({busy.end - busy.start}m)
                        </div>
                      </div>
                      <div class="flex gap-1 shrink-0">
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          onClick={() => openEditBusyModal(busy)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs text-error"
                          onClick={() =>
                            store.deleteBusy(store.selectedDay(), busy.id)
                          }
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

        {/* Column 2: Todos (Week-Scoped) (4 cols) */}
        <div class="card bg-base-100 shadow-sm lg:col-span-4">
          <div class="card-body p-4">
            <div class="flex items-center justify-between">
              <h2 class="card-title text-base font-bold">Todos</h2>
              <button
                type="button"
                class="btn btn-primary btn-xs"
                onClick={openAddTodoModal}
              >
                + Add Todo
              </button>
            </div>
            <p class="text-xs text-base-content/70">
              Work sized by pomodoros and scheduled in priority order (P0 first).
            </p>

            <div class="mt-3 divide-y divide-base-200">
              <Show
                when={store.doc.todos.length > 0}
                fallback={
                  <div class="py-6 text-center text-xs text-base-content/50">
                    No todos yet. Add one to generate pomodoro bands!
                  </div>
                }
              >
                <For each={store.doc.todos}>
                  {(todo) => (
                    <div class="flex items-center justify-between py-2">
                      <div class="min-w-0 pr-2">
                        <div class="flex items-center gap-1.5 truncate">
                          <span
                            class={`badge badge-xs ${
                              PRIORITY_BADGES[todo.priority]
                            }`}
                          >
                            {todo.priority}
                          </span>
                          <span class="truncate text-sm font-medium">
                            {todo.title}
                          </span>
                        </div>
                        <div class="text-xs text-base-content/70">
                          {todo.pomodoros} {todo.pomodoros === 1 ? "pomodoro" : "pomodoros"}
                          <Show when={todo.dueDate}>
                            <span class="ml-1 opacity-70">
                              · Due {DAY_LABELS[todo.dueDate!]}
                            </span>
                          </Show>
                        </div>
                      </div>
                      <div class="flex gap-1 shrink-0">
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          onClick={() => openEditTodoModal(todo)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs text-error"
                          onClick={() => store.deleteTodo(todo.id)}
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
        <div class="card bg-base-100 shadow-sm lg:col-span-4">
          <div class="card-body p-4">
            <h2 class="card-title text-base font-bold capitalize">
              {store.selectedDay()} Derived Plan
            </h2>
            <p class="text-xs text-base-content/70">
              Auto-derived schedule in free gaps. Never stored or dragged.
            </p>

            <div class="mt-3 space-y-1.5">
              <Show
                when={
                  derivedSchedule() &&
                  derivedSchedule()!.segments.length > 0
                }
                fallback={
                  <div class="py-6 text-center text-xs text-base-content/50">
                    No scheduled segments for this day.
                  </div>
                }
              >
                <For each={derivedSchedule()?.segments ?? []}>
                  {(seg) => (
                    <Show
                      when={seg._tag === "work"}
                      fallback={
                        <div class="flex items-center justify-between rounded bg-base-200/60 px-2.5 py-1 text-xs text-base-content/60">
                          <span>☕ Break</span>
                          <span class="font-mono">
                            {minutesToTime(seg.start)} – {minutesToTime(seg.end)}
                          </span>
                        </div>
                      }
                    >
                      {(() => {
                        const work = seg as Extract<typeof seg, { _tag: "work" }>;
                        return (
                          <div class="flex items-center justify-between rounded bg-primary/10 border-l-2 border-primary px-2.5 py-1.5 text-xs text-primary-content">
                            <div class="truncate text-base-content font-medium">
                              <span class="mr-1">🍅</span>
                              {work.todoTitle}
                              <Show when={work.isMiniFocus}>
                                <span class="ml-1 badge badge-xs badge-ghost">½</span>
                              </Show>
                            </div>
                            <span class="font-mono text-base-content/70 shrink-0 ml-2">
                              {minutesToTime(work.start)} – {minutesToTime(work.end)}
                            </span>
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

      {/* Busy Modal */}
      <Show when={busyModalOpen()}>
        <div class="modal modal-open" role="dialog" aria-modal="true">
          <div class="modal-box">
            <h3 class="font-bold text-lg">
              {editingBusyId() ? "Edit Busy Block" : "Add Busy Block"}
            </h3>
            <p class="text-xs text-base-content/70 capitalize">
              For {store.selectedDay()}
            </p>

            <form onSubmit={handleSaveBusy} class="mt-4 space-y-4">
              <Show when={busyFormError()}>
                <div class="alert alert-error text-xs py-2">
                  <span>{busyFormError()}</span>
                </div>
              </Show>

              <div class="form-control">
                <label class="label">
                  <span class="label-text">Title</span>
                </label>
                <input
                  type="text"
                  class="input input-bordered w-full"
                  placeholder="e.g. CS101 Lecture, Shift"
                  value={busyTitle()}
                  onInput={(e) => setBusyTitle(e.currentTarget.value)}
                  required
                  autofocus
                />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="form-control">
                  <label class="label">
                    <span class="label-text">Start Time</span>
                  </label>
                  <input
                    type="time"
                    class="input input-bordered w-full"
                    value={busyStart()}
                    onInput={(e) => setBusyStart(e.currentTarget.value)}
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
                    value={busyEnd()}
                    onInput={(e) => setBusyEnd(e.currentTarget.value)}
                    required
                  />
                </div>
              </div>

              <div class="modal-action">
                <button
                  type="button"
                  class="btn btn-ghost"
                  onClick={() => setBusyModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* Todo Modal */}
      <Show when={todoModalOpen()}>
        <div class="modal modal-open" role="dialog" aria-modal="true">
          <div class="modal-box">
            <h3 class="font-bold text-lg">
              {editingTodoId() ? "Edit Todo" : "Add Todo"}
            </h3>

            <form onSubmit={handleSaveTodo} class="mt-4 space-y-4">
              <Show when={todoFormError()}>
                <div class="alert alert-error text-xs py-2">
                  <span>{todoFormError()}</span>
                </div>
              </Show>

              <div class="form-control">
                <label class="label">
                  <span class="label-text">Title</span>
                </label>
                <input
                  type="text"
                  class="input input-bordered w-full"
                  placeholder="e.g. Read Chapter 4, Submit Lab"
                  value={todoTitle()}
                  onInput={(e) => setTodoTitle(e.currentTarget.value)}
                  required
                  autofocus
                />
              </div>

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
                    value={todoPomodoros()}
                    onInput={(e) =>
                      setTodoPomodoros(parseInt(e.currentTarget.value, 10) || 1)
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
                    value={todoPriority()}
                    onChange={(e) =>
                      setTodoPriority(e.currentTarget.value as Priority)
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
                    value={todoDueDate()}
                    onChange={(e) =>
                      setTodoDueDate(
                        e.currentTarget.value === ""
                          ? ""
                          : (e.currentTarget.value as DayOfWeek),
                      )
                    }
                  >
                    <option value="">None</option>
                    <For each={WEEKDAY_NAMES}>
                      {(day) => (
                        <option value={day} class="capitalize">
                          {day}
                        </option>
                      )}
                    </For>
                  </select>
                </div>
              </div>

              <div class="modal-action">
                <button
                  type="button"
                  class="btn btn-ghost"
                  onClick={() => setTodoModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* Import Modal */}
      <Show when={importModalOpen()}>
        <div class="modal modal-open" role="dialog" aria-modal="true">
          <div class="modal-box max-w-xl">
            <h3 class="font-bold text-lg">Import Calendar JSON</h3>
            <p class="text-xs text-base-content/70">
              Restore your calendar doc from JSON. Invalid or corrupt input is
              rejected safely without modifying existing state.
            </p>

            <form onSubmit={handlePerformImport} class="mt-4 space-y-4">
              <Show when={importError()}>
                <div class="alert alert-error text-xs py-2">
                  <span>{importError()}</span>
                </div>
              </Show>

              <div class="form-control">
                <label class="label">
                  <span class="label-text">Upload JSON File</span>
                </label>
                <input
                  type="file"
                  accept=".json,application/json"
                  class="file-input file-input-bordered w-full text-xs"
                  onChange={handleFileUpload}
                />
              </div>

              <div class="form-control">
                <label class="label">
                  <span class="label-text">Or Paste JSON</span>
                </label>
                <textarea
                  class="textarea textarea-bordered h-36 font-mono text-xs w-full"
                  placeholder='{"version": 1, ...}'
                  value={importJsonText()}
                  onInput={(e) => setImportJsonText(e.currentTarget.value)}
                />
              </div>

              <div class="modal-action">
                <button
                  type="button"
                  class="btn btn-ghost"
                  onClick={() => setImportModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary">
                  Import & Restore
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
}
