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
  const [timezone, setTimezone] = createSignal("UTC");
  const [workLength, setWorkLength] = createSignal(25);
  const [breakLength, setBreakLength] = createSignal(5);
  const [longBreakLength, setLongBreakLength] = createSignal(30);
  const [miniFocus, setMiniFocus] = createSignal(true);
  const [apiKey, setApiKey] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (!props.isOpen) return;
    const settings = props.store.doc.settings;
    setTimezone(settings.timezone);
    setWorkLength(settings.workLength);
    setBreakLength(settings.breakLength);
    setLongBreakLength(settings.longBreakLength);
    setMiniFocus(settings.miniFocus);
    // TODO(r2): read site for the phase-2 R2 API key. Persisted to localStorage
    // today; no behavior depends on it yet. It must never be written to exports.
    setApiKey(settings.apiKey ?? "");
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

    const trimmedApiKey = apiKey().trim();
    const updated: Partial<Settings> = {
      timezone: tz,
      workLength: Number(workLength()),
      breakLength: Number(breakLength()),
      longBreakLength: Number(longBreakLength()),
      miniFocus: miniFocus(),
      apiKey: trimmedApiKey === "" ? undefined : trimmedApiKey,
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

            {/* R2 API Key */}
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">R2 API Key</span>
              </label>
              <input
                type="password"
                class="input input-bordered input-sm font-mono text-xs"
                placeholder="Phase-2 Cloudflare R2 key"
                value={apiKey()}
                onInput={(e) => setApiKey(e.currentTarget.value)}
                autocomplete="off"
              />
              <p class="text-xs text-base-content/60 mt-1">
                Stored locally for the phase-2 R2 backend (TODO(r2)). No behavior
                depends on it yet; it is never written to exported docs.
              </p>
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
