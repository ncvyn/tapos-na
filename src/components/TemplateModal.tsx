import { createEffect, createSignal, For, Show } from "solid-js";
import {
  DAY_LABELS,
  type DayOfWeek,
  WEEKDAY_NAMES,
} from "../schema";
import type { CalendarStore } from "../state";
import {
  formatTimeSpan,
  getTodayWeekday,
  minutesToTime,
  timeToMinutes,
} from "../time";

/**
 * Weekly template editor for one day: recurring busy blocks, recurring sleep
 * windows, and a one-off sleep override that replaces that day's template
 * sleep only. Every add/edit/delete commits immediately (optimistic, debounced
 * persistence), so the modal is a thin editor over the store's template CRUD.
 */
interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  store: CalendarStore;
  defaultDay?: DayOfWeek;
}

export default function TemplateModal(props: TemplateModalProps) {
  const [day, setDay] = createSignal<DayOfWeek>("monday");
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  // Busy block form
  const [busyEditingId, setBusyEditingId] = createSignal<string | null>(null);
  const [busyTitle, setBusyTitle] = createSignal("");
  const [busyStart, setBusyStart] = createSignal("09:00");
  const [busyEnd, setBusyEnd] = createSignal("10:00");

  // Sleep window form
  const [sleepEditingId, setSleepEditingId] = createSignal<string | null>(null);
  const [sleepStart, setSleepStart] = createSignal("22:00");
  const [sleepEnd, setSleepEnd] = createSignal("07:00");

  // Sleep override form
  const [overrideStart, setOverrideStart] = createSignal("22:00");
  const [overrideEnd, setOverrideEnd] = createSignal("07:00");

  createEffect(() => {
    if (!props.isOpen) return;
    setDay(
      props.defaultDay ?? getTodayWeekday(props.store.doc.settings.timezone),
    );
  });

  createEffect(() => {
    if (!props.isOpen) return;
    setBusyEditingId(null);
    setBusyTitle("");
    setBusyStart("09:00");
    setBusyEnd("10:00");
    setSleepEditingId(null);
    setSleepStart("22:00");
    setSleepEnd("07:00");
    setOverrideStart("22:00");
    setOverrideEnd("07:00");
    setErrorMessage(null);
  });

  const busyBlocks = () => props.store.doc.days[day()].template.busy;
  const sleepWindows = () => props.store.doc.days[day()].template.sleep;
  const sleepOverride = () => props.store.doc.days[day()].sleepOverride;
  const overrideActive = () => sleepOverride() !== undefined;

  const startEditBusy = (id: string) => {
    const block = busyBlocks().find((b) => b.id === id);
    if (!block) return;
    setBusyEditingId(id);
    setBusyTitle(block.title);
    setBusyStart(minutesToTime(block.start));
    setBusyEnd(minutesToTime(block.end));
  };

  const submitBusy = (e: SubmitEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const title = busyTitle().trim();
    const startMin = timeToMinutes(busyStart());
    const endMin = timeToMinutes(busyEnd());

    if (!title) {
      setErrorMessage("Title is required for a busy block");
      return;
    }
    if (endMin <= startMin) {
      setErrorMessage("Busy block end time must be after start time");
      return;
    }

    const id = busyEditingId() ?? crypto.randomUUID();
    const block = { id, title, start: startMin, end: endMin };
    const saved = busyEditingId()
      ? props.store.updateTemplateBusy(day(), block)
      : props.store.addTemplateBusy(day(), block);
    if (!saved) {
      setErrorMessage(props.store.errorMessage() ?? "Blocks overlap");
      return;
    }
    setBusyEditingId(null);
    setBusyTitle("");
    setBusyStart("09:00");
    setBusyEnd("10:00");
  };

  const startEditSleep = (id: string) => {
    const window = sleepWindows().find((s) => s.id === id);
    if (!window) return;
    setSleepEditingId(id);
    setSleepStart(minutesToTime(window.start));
    setSleepEnd(minutesToTime(window.end));
  };

  const submitSleep = (e: SubmitEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const startMin = timeToMinutes(sleepStart());
    const endMin = timeToMinutes(sleepEnd());

    if (startMin === endMin) {
      setErrorMessage("Sleep start and end times must differ");
      return;
    }

    const id = sleepEditingId() ?? crypto.randomUUID();
    const window = { id, start: startMin, end: endMin };
    const saved = sleepEditingId()
      ? props.store.updateTemplateSleep(day(), window)
      : props.store.addTemplateSleep(day(), window);
    if (!saved) {
      setErrorMessage(props.store.errorMessage() ?? "Blocks overlap");
      return;
    }
    setSleepEditingId(null);
    setSleepStart("22:00");
    setSleepEnd("07:00");
  };

  const toggleOverride = () => {
    if (overrideActive()) {
      props.store.clearSleepOverride(day());
    } else {
      props.store.setSleepOverride(day(), []);
    }
  };

  const submitOverride = (e: SubmitEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const startMin = timeToMinutes(overrideStart());
    const endMin = timeToMinutes(overrideEnd());

    if (startMin === endMin) {
      setErrorMessage("Override sleep start and end times must differ");
      return;
    }

    const current = sleepOverride() ?? [];
    const saved = props.store.setSleepOverride(day(), [
      ...current,
      { start: startMin, end: endMin },
    ]);
    if (!saved) {
      setErrorMessage(props.store.errorMessage() ?? "Blocks overlap");
      return;
    }
    setOverrideStart("22:00");
    setOverrideEnd("07:00");
  };

  return (
    <Show when={props.isOpen}>
      <div class="modal modal-open" role="dialog" aria-modal="true">
        <div class="modal-box max-w-lg">
          <div class="flex items-center justify-between border-b border-base-200 pb-3">
            <h3 class="font-bold text-lg">Weekly Template</h3>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-circle"
              onClick={props.onClose}
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>

          <div class="mt-4 space-y-5">
            <Show when={errorMessage()}>
              <div class="alert alert-error text-xs py-2">
                <span>{errorMessage()}</span>
              </div>
            </Show>

            <p class="text-xs text-base-content/60">
              Recurring blocks repeat every week. Sleep overrides replace{" "}
              <em>this day's</em> template sleep for a single week.
            </p>

            {/* Day selector */}
            <div class="form-control">
              <label class="label pt-0">
                <span class="label-text font-medium">Day</span>
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

            {/* Recurring busy blocks */}
            <div class="rounded-lg border border-base-200 p-3 space-y-2">
              <div class="flex items-center justify-between">
                <h4 class="font-semibold text-sm flex items-center gap-1.5">
                  💼 Recurring Busy Blocks
                  <span class="badge badge-xs badge-outline">template</span>
                </h4>
                <span class="badge badge-sm badge-neutral">
                  {busyBlocks().length}
                </span>
              </div>

              <Show
                when={busyBlocks().length > 0}
                fallback={
                  <div class="text-xs text-base-content/40 italic py-1">
                    No recurring busy blocks. Add classes or shifts below.
                  </div>
                }
              >
                <div class="space-y-1">
                  <For each={busyBlocks()}>
                    {(block) => (
                      <div class="flex items-center justify-between gap-2 rounded bg-base-200/60 px-2 py-1.5 text-xs">
                        <div class="min-w-0">
                          <div class="truncate font-medium">{block.title}</div>
                          <div class="font-mono text-[10px] opacity-70">
                            {formatTimeSpan(block.start, block.end)}
                          </div>
                        </div>
                        <div class="flex gap-1 shrink-0">
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            onClick={() => startEditBusy(block.id)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs text-error"
                            onClick={() =>
                              props.store.deleteTemplateBusy(day(), block.id)
                            }
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <form onSubmit={submitBusy} class="flex flex-wrap items-end gap-2 pt-1">
                <div class="form-control flex-1 min-w-28">
                  <label class="label py-0.5">
                    <span class="label-text text-[10px]">Title</span>
                  </label>
                  <input
                    type="text"
                    class="input input-bordered input-sm w-full"
                    placeholder="e.g. Physics Lecture"
                    value={busyTitle()}
                    onInput={(e) => setBusyTitle(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="form-control w-24">
                  <label class="label py-0.5">
                    <span class="label-text text-[10px]">Start</span>
                  </label>
                  <input
                    type="time"
                    class="input input-bordered input-sm w-full"
                    value={busyStart()}
                    onInput={(e) => setBusyStart(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="form-control w-24">
                  <label class="label py-0.5">
                    <span class="label-text text-[10px]">End</span>
                  </label>
                  <input
                    type="time"
                    class="input input-bordered input-sm w-full"
                    value={busyEnd()}
                    onInput={(e) => setBusyEnd(e.currentTarget.value)}
                    required
                  />
                </div>
                <button type="submit" class="btn btn-primary btn-sm">
                  {busyEditingId() ? "Update" : "Add"}
                </button>
                <Show when={busyEditingId()}>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    onClick={() => {
                      setBusyEditingId(null);
                      setBusyTitle("");
                    }}
                  >
                    Cancel
                  </button>
                </Show>
              </form>
            </div>

            {/* Recurring sleep windows */}
            <div class="rounded-lg border border-base-200 p-3 space-y-2">
              <div class="flex items-center justify-between">
                <h4 class="font-semibold text-sm flex items-center gap-1.5">
                  🌙 Recurring Sleep Windows
                  <span class="badge badge-xs badge-outline">template</span>
                </h4>
                <span class="badge badge-sm badge-neutral">
                  {sleepWindows().length}
                </span>
              </div>

              <Show
                when={sleepWindows().length > 0}
                fallback={
                  <div class="text-xs text-base-content/40 italic py-1">
                    No recurring sleep. Add night sleep or naps below.
                  </div>
                }
              >
                <div class="space-y-1">
                  <For each={sleepWindows()}>
                    {(window) => (
                      <div class="flex items-center justify-between gap-2 rounded bg-base-200/60 px-2 py-1.5 text-xs">
                        <div class="font-mono">
                          {formatTimeSpan(window.start, window.end)}
                        </div>
                        <div class="flex gap-1 shrink-0">
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            onClick={() => startEditSleep(window.id)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs text-error"
                            onClick={() =>
                              props.store.deleteTemplateSleep(day(), window.id)
                            }
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <form onSubmit={submitSleep} class="flex flex-wrap items-end gap-2 pt-1">
                <div class="form-control w-24">
                  <label class="label py-0.5">
                    <span class="label-text text-[10px]">Start</span>
                  </label>
                  <input
                    type="time"
                    class="input input-bordered input-sm w-full"
                    value={sleepStart()}
                    onInput={(e) => setSleepStart(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="form-control w-24">
                  <label class="label py-0.5">
                    <span class="label-text text-[10px]">End</span>
                  </label>
                  <input
                    type="time"
                    class="input input-bordered input-sm w-full"
                    value={sleepEnd()}
                    onInput={(e) => setSleepEnd(e.currentTarget.value)}
                    required
                  />
                </div>
                <button type="submit" class="btn btn-primary btn-sm">
                  {sleepEditingId() ? "Update" : "Add"}
                </button>
                <Show when={sleepEditingId()}>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    onClick={() => setSleepEditingId(null)}
                  >
                    Cancel
                  </button>
                </Show>
              </form>
            </div>

            {/* Sleep override */}
            <div class="rounded-lg border border-secondary/40 p-3 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <h4 class="font-semibold text-sm flex items-center gap-1.5">
                    ⏰ One-Off Sleep Override
                    <span class="badge badge-xs badge-secondary">override</span>
                  </h4>
                  <p class="text-[11px] text-base-content/60">
                    Replaces this day's template sleep for one week only.
                  </p>
                </div>
                <input
                  type="checkbox"
                  class="toggle toggle-secondary toggle-sm"
                  checked={overrideActive()}
                  onChange={toggleOverride}
                  aria-label="Enable sleep override"
                />
              </div>

              <Show when={overrideActive()}>
                <Show
                  when={(sleepOverride() ?? []).length > 0}
                  fallback={
                    <div class="text-xs text-base-content/40 italic py-1">
                      Override enabled — add sleep windows for this day.
                    </div>
                  }
                >
                  <div class="space-y-1">
                    <For each={sleepOverride() ?? []}>
                      {(block, index) => (
                        <div class="flex items-center justify-between gap-2 rounded bg-secondary/10 px-2 py-1.5 text-xs">
                          <div class="font-mono">
                            {formatTimeSpan(block.start, block.end)}
                          </div>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs text-error"
                            onClick={() => {
                              const current = sleepOverride() ?? [];
                              props.store.setSleepOverride(
                                day(),
                                current.filter((_, i) => i !== index()),
                              );
                            }}
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <form
                  onSubmit={submitOverride}
                  class="flex flex-wrap items-end gap-2 pt-1"
                >
                  <div class="form-control w-24">
                    <label class="label py-0.5">
                      <span class="label-text text-[10px]">Start</span>
                    </label>
                    <input
                      type="time"
                      class="input input-bordered input-sm w-full"
                      value={overrideStart()}
                      onInput={(e) => setOverrideStart(e.currentTarget.value)}
                      required
                    />
                  </div>
                  <div class="form-control w-24">
                    <label class="label py-0.5">
                      <span class="label-text text-[10px]">End</span>
                    </label>
                    <input
                      type="time"
                      class="input input-bordered input-sm w-full"
                      value={overrideEnd()}
                      onInput={(e) => setOverrideEnd(e.currentTarget.value)}
                      required
                    />
                  </div>
                  <button type="submit" class="btn btn-secondary btn-sm">
                    Add
                  </button>
                </form>
              </Show>
            </div>
          </div>

          <div class="modal-action border-t border-base-200 pt-3">
            <button type="button" class="btn btn-primary" onClick={props.onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
