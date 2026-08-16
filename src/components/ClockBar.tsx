/**
 * ClockBar — the 1-second wall-clock timer bar.
 *
 * Recomputes the pure live state every second from the derived schedule and
 * the current instant: (schedule, now) → liveState. Auto-start is emergent —
 * as `now` crosses a segment boundary the bar flips state on its own; there
 * is no start button and late time is lost, never recovered. DST-aware: the
 * resolver maps wall-clock segment times to absolute instants in the stored
 * timezone. No notifications anywhere.
 */

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { WEEKDAY_NAMES } from "../schema";
import { computeSchedule } from "../engine";
import type { CalendarStore } from "../state";
import { getZonedClockTime, minutesToTime } from "../time";
import { resolveLiveState, type LiveState, type SegmentRef } from "../timer";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function segmentLabel(ref: SegmentRef | null): string {
  if (!ref) return "";
  const seg = ref.segment;
  if (seg._tag === "work") {
    return `🍅 ${seg.todoTitle} #${seg.pomodoroNumber}`;
  }
  return seg.breakType === "long" ? "🌴 Long Break" : "☕ Short Break";
}

export default function ClockBar(props: { store: CalendarStore }) {
  const [now, setNow] = createSignal(new Date());

  createEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    onCleanup(() => clearInterval(id));
  });

  const weekSchedule = createMemo(() => computeSchedule(props.store.doc));
  const liveState = createMemo<LiveState>(() =>
    resolveLiveState(weekSchedule(), now(), props.store.doc.settings.timezone),
  );
  const clockTime = createMemo(() =>
    getZonedClockTime(props.store.doc.settings.timezone, now()),
  );
  const hasAnySegments = () =>
    WEEKDAY_NAMES.some((d) => (weekSchedule()[d]?.segments.length ?? 0) > 0);

  const current = () => liveState().current;
  const isWork = () => current()?.segment._tag === "work";
  const progress = () =>
    liveState().totalMs > 0
      ? Math.min(100, Math.max(0, (liveState().wastedMs / liveState().totalMs) * 100))
      : 0;

  return (
    <div class="border-b border-base-300 bg-base-200/50">
      <div class="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 sm:px-6">
        <div class="flex items-baseline gap-2">
          <span class="font-mono text-lg font-bold tabular-nums leading-none">
            {clockTime()}
          </span>
          <span class="hidden text-[10px] text-base-content/50 sm:inline">
            {props.store.doc.settings.timezone}
          </span>
        </div>

        <div class="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          <Show when={liveState().status === "active"}>
            <span class="badge badge-sm font-semibold">
              {isWork() ? "Focus" : "Break"}
            </span>
            <span class="text-sm font-medium">{segmentLabel(current())}</span>
            <span class="font-mono text-sm font-semibold tabular-nums text-success">
              −{formatDuration(liveState().remainingMs)}
            </span>
            <Show when={liveState().wastedMs > 0}>
              <span
                class="font-mono text-xs tabular-nums text-warning"
                title="Wasted this segment"
              >
                +{formatDuration(liveState().wastedMs)} wasted
              </span>
            </Show>
            <div class="min-w-40 flex-1">
              <div class="h-1.5 w-full overflow-hidden rounded-full bg-base-300">
                <div
                  class={`h-full ${isWork() ? "bg-primary" : "bg-secondary"} transition-all duration-1000 ease-linear`}
                  style={{ width: `${progress()}%` }}
                />
              </div>
            </div>
          </Show>

          <Show when={liveState().status === "before"}>
            <span class="text-xs text-base-content/60">Up next</span>
            <span class="text-sm font-medium">{segmentLabel(liveState().next)}</span>
            <span class="font-mono text-xs tabular-nums text-base-content/60">
              {minutesToTime(liveState().next?.segment.start ?? 0)} · in{" "}
              {formatDuration((liveState().next?.startMs ?? liveState().nowMs) - liveState().nowMs)}
            </span>
          </Show>

          <Show when={liveState().status === "after" && hasAnySegments()}>
            <span class="text-sm text-base-content/60">
              All sessions finished.
            </span>
          </Show>

          <Show when={!hasAnySegments()}>
            <span class="text-sm text-base-content/50">
              No sessions scheduled this week.
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
}
