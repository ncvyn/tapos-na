# Plan: Pomodoro Calendar ("tapos-na")

## Locked decisions

- **Stack**: Astro 7 + SolidJS islands + TypeScript strict + Effect (domain, storage, errors). TailwindCSS + DaisyUI. pnpm.
- **Deploy**: Cloudflare Pages (static build). No server endpoints.
- **Storage**: `StorageService` (Effect service) seam.
  - Phase 1: **localStorage** impl — works with zero infra.
  - Phase 2: **R2 impl** behind same interface. User sets up the bucket manually; add `// TODO(r2): set API key` marker where the key gets entered in Settings (stored in localStorage).
  - Single JSON `CalendarDoc`.
- **Data model (week-only)**: doc stores exactly **Monday–Sunday for the current week** — no history. Display can be **Monday-first or Sunday-first** (user setting); if Sunday-first, the Sunday column renders empty (JSON's Sunday belongs to the next display week, and prior weeks aren't stored).
  - **Export**: download current doc as JSON (and import/restore).
- **Items**:
  - **busy** (school/work), **event** (one-off), **todo** (pomodoro count + optional due date + **P0–P4** priority, P0=critical), **sleep** (naps + nights — blocks pomodoros like busy, distinct rendering).
  - **Recurring weekly template** created per day, includes busy blocks **and sleep windows**; **sleep overrides** possible (one-off).
- **Sleep model**: waking time = complement of sleep blocks. No pomodoros scheduled inside any sleep/busy block.
- **Algorithm**:
  - Free time = day minus sleep minus busy minus events. **Event always wins**.
  - Greedy placement by priority (P0 first). Work + break lengths configurable in **5-min steps**. **Long break after every 4th pomodoro, length configurable in 30-min steps**.
  - Due date = hard bound. **Spill** (no due date, or due > next day): overflow → next day **morning-first**, re-sorted vs next day's priorities; a spill displaces only **strictly-lower** priority items.
  - Small gaps (< work length) → optional **mini-focus** = ½ pomodoro (counts 0.5, toggleable).
  - **Recompute only affected day**. Pomodoros are **derived, never stored, never draggable**.
- **Timer**: wall-clock driven, auto-start; ends fixed to schedule. **Remaining = end − now** (started 10 min late → 15 left + 10 wasted). Wasted tracked **only for the live segment**, time simply lost. No notifications.
- **Views**: Week + Day, drag & drop for user items, collision prevents overlaps.
- **Timezone**: store UTC + tz, DST-aware.

## Architecture

```
src/lib/schema/    Effect Schema: BusyBlock, Event, Todo, SleepBlock, Template, Settings, CalendarDoc
src/lib/engine/    Pure scheduling engine (UTC-normalized, deterministic, TDD)
src/lib/timer/     Wall-clock resolver: current segment, remaining, wasted — f(doc, now)
src/lib/storage/   StorageService (Effect) + LocalStorage impl; R2 impl later; export/import
src/lib/state/     Solid store + actions (source of truth in browser)
src/components/    WeekView, DayView, DragLayer, TodoPanel, SettingsModal, ClockBar
src/pages/         index (app shell)
```

Principle: **store inputs, derive schedule.** `(userItems, template, settings) → segments` and `(schedule, now) → liveState` are pure → small payload, trivial timer, easy tests.

## Phases

1. **Scaffold**: Astro + Solid + Tailwind/DaisyUI + Effect, strict tsconfig, layout/theme.
2. **Schema**: all types + `CalendarDoc`, Effect Schema encode/decode, round-trip tests.
3. **Storage**: `StorageService` interface + localStorage impl, optimistic cache, debounced writes; Settings modal (week-start choice, API key field with R2 TODO); export/import JSON.
4. **Engine (core, TDD)**: template→week (busy + sleep); free spans; greedy priority placement with long-break cadence, mini-focus toggle, due-date bounds, sleep-aware morning-first spill (lower-priority displacement only), `replanDay(date)`. vitest.
5. **Timer module**: live segment/remaining/wasted + 1-second `ClockBar`.
6. **Calendar UI**: week/day grids (Mon-first + Sun-first empty-column), render items + derived pomodoro bands, drag & drop w/ collision, todo panel (count, due, P0–P4), create/edit modals.
7. **Polish**: save/load wiring, Effect error handling, responsive.
