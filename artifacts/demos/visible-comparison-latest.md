# Observable Drift Demo

- Started: 2026-03-21T23:56:55.491Z
- Ended: 2026-03-22T00:01:26.048Z
- Fixture: benchmark-fixtures/observable-drift-demo.json
- Baseline: Direct model (rolling-summary)
- Model: gpt-5-nano

## Score

- Project Memory passed: 7/7
- Direct model passed: 3/7
- Project Memory wins: 4
- Direct model wins: 0
- Ties: 3

## Early Goal

- After event: 5
- Digest: f9f2ee82-bf62-46b7-9f42-958b9edf7208
- Direct-model rolling summary: Goal: ship a generic local chat UI.
Constraints: keep API stable; self-hosted first.
Decisions: prioritize memory continuity for long-running projects.
Open todos: formalize drift metrics.
Status update: early demos looked too much like a chat shell.

### What is the current project goal?

- Must include all: generic local chat ui
- Must avoid: self-hosted long-term memory runtime | hosted ai platform
- Project Memory (pass): The current project goal is to ship a generic local chat ui.
- Direct model (pass): The current project goal is to ship a generic local chat UI.

## After Pivot

- After event: 10
- Digest: 86bf5dd9-076b-4862-9c9a-7347abfa0482
- Direct-model rolling summary: Goal: ship a self-hosted memory layer for project assistants.
Constraints: keep API stable; self-hosted first; do not become a general-purpose agent platform.
Decisions: continue prioritizing memory continuity for long-running projects; now emphasize achieving low-drift memory reliability before expanding integrations.
Open todos: formalize drift metrics; add replay consistency checks.
Status update: early demos looked too much like a chat shell. Noise: optional future desktop demos.

### What is the current project goal?

- Must include one of: self-hosted memory layer for project assistants | self-hosted memory layer
- Must avoid: generic local chat ui | hosted ai platform
- Project Memory (pass): Goal: ship a self-hosted memory layer for project assistants.
- Direct model (pass): The current project goal is to ship a self-hosted memory layer for project assistants.

### What is explicitly out of scope?

- Must include one of: do not become a general-purpose agent platform | general-purpose agent platform
- Must avoid: hosted ai platform
- Project Memory (pass): There is no explicit statement about what is out of scope in the retrieved memory. The closest boundary is the constraint "do not become a general-purpose agent platform," which suggests a scope limit but is not framed as an explicit out-of-scope item.
- Direct model (pass): - Becoming a general-purpose agent platform (explicit constraint: not in scope).
- Expanding integrations beyond the memory layer until drift metrics and replay checks are formalized (focus is on low-drift reliability first).
- Desktop demos or non-essential UI/demo noise (desktop demos are noted as optional in the future and out of current scope).
- Non-self-hosted deployments or cloud-hosted alternatives are not the current focus (self-hosted first is the priority).

## Final State

- After event: 16
- Digest: 6cc32641-6b8d-4ce3-8994-368708160fb8
- Direct-model rolling summary: Goal: ship a self-hosted memory runtime for local models.
Constraints: stable API; self-hosted first; not a general-purpose agent platform; hosted work out of scope.
Decisions: prioritize memory continuity for long-running projects; ensure low-drift reliability before expanding integrations; treat the assistant runtime as a product boundary.
Open todos: drift metrics; replay checks; define runtime policies.
Status: roadmap centers retention, stability, grounding, and replayability.
Noise: desktop mockups and branding experiments discussed.

### What is the current project goal?

- Must include one of: self-hosted long-term memory runtime for local models | long-term memory runtime for local models
- Must avoid: generic local chat ui | hosted ai platform
- Project Memory (pass): Current project goal: ship a self-hosted long-term memory runtime for local models. Constraints: keep API stable; self-hosted first.
- Direct model (fail): The goal is to ship a self-hosted memory runtime for local models.

### What constraints still apply?

- Must include all: keep api stable | self-hosted first | general-purpose agent platform
- Must avoid: hosted ai platform | break api compatibility
- Project Memory (pass): - Self-hosted first. Prioritize self-hosted deployment; hosted platform work is out of scope.
- Keep API stable.
- Do not become a general-purpose agent platform.
- Focus on memory continuity for long-running projects; aim for low-drift memory reliability before expanding integrations.
- Treat the assistant runtime as a product boundary, not just loose APIs.
- Roadmap constraints emphasize retention, stability, grounding, and replayability.
- Direct model (fail): - Stable API
- Self-hosted first
- Not a general-purpose agent platform
- Hosted work out of scope

### What key decisions have we made?

- Must include all: low-drift memory reliability | assistant runtime as a product boundary
- Must avoid: ui polish over memory stability | hosted ai platform
- Project Memory (pass): - Treat the assistant runtime as a product boundary, not just loose APIs.
- Ship a self-hosted long-term memory runtime for local models; self-hosted first and maintain API stability.
- Focus on memory continuity for long-running projects.
- Focus on low-drift memory reliability before expanding integrations.
- Hosted platform work is explicitly out of scope.
- Roadmap should center retention, stability, grounding, and replayability.
- Do not become a general-purpose agent platform.
- Direct model (fail): - Prioritize memory continuity for long-running projects.
- Ensure low-drift reliability before expanding integrations.
- Treat the assistant runtime as a product boundary.

### What work remains open?

- Must include all: formalize drift metrics | add replay consistency checks | define assistant runtime policies
- Must avoid: remove replay consistency work | delete replay consistency work
- Project Memory (pass): - TODO: define assistant runtime policies
- TODO: add replay consistency checks
- TODO: formalize drift metrics
- Direct model (fail): Open work items:

- Drift metrics: define, implement, and instrument drift metrics to monitor stability and coherence over long-running sessions; establish acceptance thresholds and dashboards.

- Replay checks: implement tests and checks to ensure memory state is replayable/reproducible; add regression tests for replay paths and determinism.

- Define runtime policies: formalize runtime policies governing memory retention, grounding, privacy, security, resource limits, and failure handling; document enforcement rules.
