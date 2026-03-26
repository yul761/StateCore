# Demo Quickstart

This is the shortest path to the interactive three-layer demo.

## Fastest Local Path

From the repo root:

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm seed
pnpm dev:demo-stack
```

Then open:

- `http://localhost:3100`

That launcher waits for the API and demo shell to become reachable before it
prints `Demo stack ready.`

That stack starts:

- the NestJS API
- the worker
- the demo web shell

## What To Try First

1. Create a scope.
2. Send `What is the current goal?`
3. Send `What constraints still apply?`
4. Watch:
   - the hero card
   - the turn story
   - the turn pipeline
   - the working/stable inspector summaries

## First Minute Walkthrough

If you want the quickest visible three-layer effect:

1. Create a scope called `demo runtime`.
2. Ask `What is the current goal?`
3. Look at:
   - `Answer` in the hero card
   - `Turn Story`
   - `Turn Pipeline`
4. Ask `What work remains open?`
5. Open:
   - `Layer Status`
   - `Latest Layer Diff`

That sequence is usually enough to show:

- direct fast-path answers
- Working Memory catch-up
- whether State Layer stayed idle or committed a new snapshot

## What You Should See

- Fast Layer answers immediately.
- Working Memory catches up after the reply.
- State Layer commits in the background when digesting is needed.
- The UI shows:
  - answer mode
  - retrieval mode
  - working/stable versions
  - alignment
  - whether each layer is caught up

## If API And Worker Are Already Running

You can start only the demo shell:

```bash
pnpm dev:demo
```

## If You Want To Verify The Shell

```bash
pnpm smoke:demo-web
```

## Related Docs

- `docs/demo-web-surface.md`
- `docs/product-surface.md`
- `docs/start-here.md`
