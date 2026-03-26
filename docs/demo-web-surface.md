# Demo Web Surface

This document defines the smallest intended dependency surface for a future
`apps/demo-web`.

The demo should not need raw event ingestion, manual digest triggers, or replay
endpoints in its main user path.

## Minimal Routes

The `packages/contracts` package now exports `DemoWebRoutes`, which is the
recommended route map for a chat-style demo:

- `health`
- `createScope`
- `listScopes`
- `setActiveScope`
- `getActiveState`
- `runtimeTurn`
- `workingState`
- `stableState`
- `fastView`
- `layerStatus`

## Minimal Contracts

The same package exports `DemoWebContracts`, which is the recommended schema
subset for the demo app:

- scope/session contracts
- `RuntimeTurnInput`
- `RuntimeTurnOutput`
- `WorkingMemoryOutput`
- `StableStateOutput`
- `FastLayerViewOutput`
- `LayerStatusOutput`
- `HealthOutput`

## Recommended UI Mapping

- session list / picker:
  - `listScopes`
  - `createScope`
  - `setActiveScope`
  - `getActiveState`
- chat thread:
  - `runtimeTurn`
- memory inspector:
  - `workingState`
  - `stableState`
  - `fastView`
  - `layerStatus`
- boot / status banner:
  - `health`

## Deliberate Exclusions

The main demo flow should not depend on:

- `POST /memory/events`
- `POST /memory/digest`
- `POST /memory/digest/rebuild`
- `POST /memory/retrieve`
- `POST /memory/answer`
- raw digest history endpoints

Those remain available for debug tooling, smoke scripts, benchmarks, and
operator workflows.

## Initial App Shell

The repository now includes a minimal `apps/demo-web` shell that follows this
boundary.

For the shortest end-to-end local setup path, start with:

- `docs/demo-quickstart.md`

Run it with:

```bash
pnpm dev:demo-stack
```

That starts the API, worker, and demo shell together.

Then open:

- `http://localhost:3100`

If the API and worker are already running, you can start only the shell with:

```bash
pnpm dev:demo
```

By default it serves on `http://localhost:3100` and points browser requests to
`API_BASE_URL` or `DEMO_API_BASE_URL`.

You can validate the shell end to end with:

```bash
pnpm smoke:demo-web
```
