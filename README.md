# tapos-na

A week-only pomodoro calendar: record fixed commitments (busy blocks, events,
sleep, todos) and the app derives the pomodoro schedule in the free gaps —
`(userItems, template, settings) -> segments`. Pomodoros are computed, never
stored.

## Stack

- Astro 7 + SolidJS islands + TailwindCSS 4 + daisyUI 5
- Effect (domain schema via Effect Schema; services later)
- Strict TypeScript, vitest

## Development

```sh
pnpm install
pnpm dev        # foreground; background: pnpm astro dev --background (see AGENTS.md)
pnpm test       # vitest (schema seam)
pnpm typecheck  # astro check
pnpm build      # static production build
```

## Layout

- `src/schema.ts` — domain schema + `CalendarDoc` encode/decode (the storage seam)
- `src/pages/` — app shell
- `src/components/` — islands
- Future modules per spec: `engine`, `timer`, `storage`, `state`

See the issue tracker (GitHub issues) for the spec and tickets.
