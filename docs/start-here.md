# Start Here

If you are opening this repository for the first time, do not start by reading every doc.

Use this order instead.

## Fastest Proof

Start here if you want to know whether the core claim is real:

- `artifacts/demos/visible-comparison-latest.md`
- `artifacts/demos/visible-comparison-latest.json`

That demo shows the same event sequence evaluated in two ways:

- Project Memory
- a direct-model rolling-summary baseline

The current curated sample evaluates:

- 3 rounds
- 7 questions
- Project Memory: 7/7
- direct baseline: 3/7

## Quick Mental Model

If you want the simplest explanation of what this project changes, read:

- `README.md`
- `docs/observable-comparison.md`

The short version:

- direct model memory: events -> rolling summary -> answer
- Project Memory: events -> selection -> protected state -> digest -> grounded answer

The project is not trying to make one summary prompt better.
It is changing the memory update mechanism itself.

## If You Want To Run It

Use this path:

```bash
docker compose up -d
pnpm install
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpm seed
pnpm dev:api
pnpm dev:worker
pnpm benchmark:visible
```

Then open:

- `artifacts/demos/visible-comparison-latest.md`

## If You Want The Internals

Read these next:

- `docs/technical-overview.md`
- `docs/digest-state.md`
- `docs/drift-definition.md`
- `docs/benchmarking.md`
