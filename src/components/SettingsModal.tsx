import { createEffect, createSignal, For, Show } from "solid-js";
import type { Settings } from "../schema";
import type { CalendarStore } from "../state";

const COMMON_TIMEZONES = [
  "UTC",
  "Asia/Manila",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Dubai",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Australia/Sydney",
  "Pacific/Auckland",
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  store: CalendarStore;
}

export default function SettingsModal(props: SettingsModalProps) {
  const [weekStart, setWeekStart] = createSignal<"monday" | "sunday">("monday");
  const [timezone, setTimezone] = createSignal("UTC");
  const [workLength, setWorkLength] = createSignal(25);
  const [breakLength, setBreakLength] = createSignal(5);
  const [longBreakLength, setLongBreakLength] = createSignal(30);
  const [miniFocus, setMiniFocus] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (!props.isOpen) return;
    const settings = props.store.doc.settings;
    setWeekStart(settings.weekStart);
    setTimezone(settings.timezone);
    setWorkLength(settings.workLength);
    setBreakLength(settings.breakLength);
    setLongBreakLength(settings.longBreakLength);
    setMiniFocus(settings.miniFocus);
    setError(null);
  });

  const handleSave = (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);

    const tz = timezone().trim();
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      setError(`"${tz}" is not a valid IANA timezone identifier.`);
      return;
    }

    const updated: Partial<Settings> = {
      weekStart: weekStart(),
      timezone: tz,
      workLength: Number(workLength()),
      breakLength: Number(breakLength()),
      longBreakLength: Number(longBreakLength()),
      miniFocus: miniFocus(),
    };

    props.store.updateSettings(updated);
    props.onClose();
  };

  return (
    <Show when={props.isOpen}>
      <div class="modal modal-open" role="dialog" aria-modal="true">
        <div class="modal-box max-w-lg">
          <div class="flex items-center justify-between border-b border-base-200 pb-3">
            <h3 class="font-bold text-lg">Calendar Settings</h3>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-circle"
              onClick={props.onClose}
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSave} class="mt-4 space-y-4">
            <Show when={error()}>
              <div class="alert alert-error text-xs py-2">
                <span>{error()}</span>
              </div>
            </Show>

            {/* Week Start */}
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">First Day of Week</span>
              </label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  class={`btn btn-sm ${
                    weekStart() === "monday" ? "btn-primary" : "btn-outline"
                  }`}
                  onClick={() => setWeekStart("monday")}
                >
                  Monday-First (Default)
                </button>
                <button
                  type="button"
                  class={`btn btn-sm ${
                    weekStart() === "sunday" ? "btn-primary" : "btn-outline"
                  }`}
                  onClick={() => setWeekStart("sunday")}
                >
                  Sunday-First
                </button>
              </div>
            </div>

            {/* Timezone */}
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Timezone (IANA)</span>
              </label>
              <div class="flex gap-2">
                <select
                  class="select select-bordered select-sm w-1/2"
                  value={COMMON_TIMEZONES.includes(timezone()) ? timezone() : ""}
                  onChange={(e) => {
                    if (e.currentTarget.value) {
                      setTimezone(e.currentTarget.value);
                    }
                  }}
                >
                  <option value="">Select common...</option>
                  <For each={COMMON_TIMEZONES}>
                    {(tz) => <option value={tz}>{tz}</option>}
                  </For>
                </select>
                <input
                  type="text"
                  class="input input-bordered input-sm flex-1 font-mono text-xs"
                  placeholder="e.g. America/New_York"
                  value={timezone()}
                  onInput={(e) => setTimezone(e.currentTarget.value)}
                  required
                />
              </div>
            </div>

            {/* Pomodoro Lengths */}
            <div class="grid grid-cols-3 gap-2">
              <div class="form-control">
                <label class="label">
                  <span class="label-text text-xs">Work Length</span>
                </label>
                <select
                  class="select select-bordered select-sm w-full"
                  value={workLength()}
                  onChange={(e) => setWorkLength(Number(e.currentTarget.value))}
                >
                  <For each={[15, 20, 25, 30, 45, 50, 60, 90]}>
                    {(len) => <option value={len}>{len} min</option>}
                  </For>
                </select>
              </div>

              <div class="form-control">
                <label class="label">
                  <span class="label-text text-xs">Short Break</span>
                </label>
                <select
                  class="select select-bordered select-sm w-full"
                  value={breakLength()}
                  onChange={(e) => setBreakLength(Number(e.currentTarget.value))}
                >
                  <For each={[5, 10, 15, 20, 30]}>
                    {(len) => <option value={len}>{len} min</option>}
                  </For>
                </select>
              </div>

              <div class="form-control">
                <label class="label">
                  <span class="label-text text-xs">Long Break (4th)</span>
                </label>
                <select
                  class="select select-bordered select-sm w-full"
                  value={longBreakLength()}
                  onChange={(e) =>
                    setLongBreakLength(Number(e.currentTarget.value))
                  }
                >
                  <For each={[30, 60, 90, 120]}>
                    {(len) => <option value={len}>{len} min</option>}
                  </For>
                </select>
              </div>
            </div>

            {/* Mini Focus toggle */}
            <div class="form-control bg-base-200/50 p-3 rounded-lg">
              <label class="label cursor-pointer justify-between py-0">
                <div>
                  <span class="label-text font-medium">Mini-Focus (½ Pomodoro)</span>
                  <p class="text-xs text-base-content/60">
                    Schedule half-sessions in free gaps smaller than standard work length.
                  </p>
                </div>
                <input
                  type="checkbox"
                  class="toggle toggle-primary"
                  checked={miniFocus()}
                  onChange={(e) => setMiniFocus(e.currentTarget.checked)}
                />
              </label>
            </div>

            <div class="modal-action border-t border-base-200 pt-3">
              <button
                type="button"
                class="btn btn-ghost"
                onClick={props.onClose}
              >
                Cancel
              </button>
              <button type="submit" class="btn btn-primary">
                Save Settings
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
