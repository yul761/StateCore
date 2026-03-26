# Product Surface

This document defines the API boundary that a demo app, SDK, or external
integrator should treat as the supported product surface.

The goal is simple:

- keep the runtime-facing API small
- avoid coupling demo code to internal digest machinery
- keep benchmark and operator endpoints available without making them the
  default integration path

## Public Runtime Surface

These are the endpoints a chat UI, agent runtime, or demo app should prefer.

### Health And Session

- `GET /health`
- `POST /scopes`
- `GET /scopes`
- `POST /scopes/:id/active`
- `GET /state`

### Runtime And Inspectable Layers

- `POST /memory/runtime/turn`
- `GET /memory/working-state`
- `GET /memory/stable-state`
- `GET /memory/fast-view`
- `GET /memory/layer-status`

This is the recommended minimum surface for a product demo:

1. create or select a scope
2. send turns through `POST /memory/runtime/turn`
3. render `working-state`, `stable-state`, `fast-view`, and `layer-status`
   in an inspector panel

## Debug Surface

These endpoints are useful for developer tooling, diagnosis, and operator
inspection, but they should not be the default dependency for a public demo UI.

- `POST /memory/answer`
- `POST /memory/retrieve`
- `GET /memory/events`
- `GET /memory/digests`
- `GET /memory/state`
- `GET /memory/state/history`
- `POST /reminders`
- `GET /reminders`
- `POST /reminders/:id/cancel`

These are appropriate for:

- CLI diagnostics
- operator dashboards
- benchmark helpers
- manual replay and inspection

## Internal Control Surface

These endpoints exist to drive the memory control system itself and should be
treated as internal control operations rather than primary app-facing APIs.

- `POST /memory/events`
- `POST /memory/digest`
- `POST /memory/digest/rebuild`

They are useful when:

- importing data
- forcing a digest for a smoke test
- rebuilding digest history
- running benchmarks and CI workflows

For a normal product flow, `POST /memory/runtime/turn` should remain the entry
point and the background jobs should handle Working Memory and State Layer
updates.

## Demo Guidance

If you build `apps/demo-web`, keep it on the public runtime surface unless you
are explicitly building an operator/debug screen.

For the smallest intended dependency set, see `docs/demo-web-surface.md`.

Recommended demo layout:

- main chat thread:
  - `POST /memory/runtime/turn`
- session/sidebar:
  - `GET /scopes`
  - `POST /scopes`
  - `POST /scopes/:id/active`
- memory inspector:
  - `GET /memory/working-state`
  - `GET /memory/stable-state`
  - `GET /memory/fast-view`
  - `GET /memory/layer-status`

Avoid making the main user path depend directly on:

- raw event ingestion
- manual digest triggering
- rebuild endpoints
- replay-oriented snapshot history endpoints

## Why This Split Exists

The repository contains both product runtime code and research/benchmark
machinery.

Without an explicit boundary, a demo app can easily drift into using internal
endpoints simply because they are available.

This split keeps the repo cleaner:

- public runtime flow stays small
- debug tooling stays inspectable
- digest internals stay accessible without becoming the app contract

The same split now exists in `packages/contracts/src/index.ts` as:

- `PublicRuntimeContracts`
- `DebugSurfaceContracts`
- `InternalControlContracts`
- `PublicRuntimeRoutes`
- `DebugSurfaceRoutes`
- `InternalControlRoutes`
- `DemoWebContracts`
- `DemoWebRoutes`
