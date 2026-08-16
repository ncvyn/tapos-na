import { For } from "solid-js";
import { DAY_LABELS, WEEKDAY_NAMES } from "../schema";

/**
 * Shell island: renders the week's Monday–Sunday strip, hydrated on load.
 * Proves the SolidJS + Effect wiring end to end (the schema module imports
 * Effect and ships to the client).
 */
export default function WeekStrip() {
  return (
    <div class="flex flex-wrap gap-2" role="list" aria-label="Days of the week">
      <For each={WEEKDAY_NAMES}>
        {(day) => (
          <span class="badge badge-outline badge-lg" role="listitem">
            {DAY_LABELS[day]}
          </span>
        )}
      </For>
    </div>
  );
}
