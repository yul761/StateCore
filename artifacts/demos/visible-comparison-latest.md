# Observable Drift Demo

- Started: 2026-03-21T23:56:55.491Z
- Ended: 2026-03-22T00:01:26.048Z
- Fixture: benchmark-fixtures/observable-drift-demo.json
- Baseline: Direct model (rolling-summary)
- Model: gpt-5-nano

## Score

- Rounds evaluated: 3
- Questions evaluated: 7
- Project Memory passed: 7/7
- Direct model passed: 3/7
- Project Memory wins: 4
- Direct model wins: 0
- Ties: 3

## Round 1: Early Goal

- Checkpoint: after event 5
- This round covers events 1-5
- Digest: f9f2ee82-bf62-46b7-9f42-958b9edf7208

**Input In This Round**

- 1. [document:doc:goal] goal: ship a generic local chat ui
- 2. [document:doc:constraints] constraint: keep api stable
     constraint: self-hosted first
- 3. [stream] We decide to focus on memory continuity for long-running projects
- 4. [stream] TODO: formalize drift metrics
- 5. [stream] Status update: early demos looked too much like a chat shell

**Direct-Model Rolling Summary At This Point**

**Goal**

- ship a generic local chat UI.

**Constraints**

- keep API stable
- self-hosted first.

**Decisions**

- prioritize memory continuity for long-running projects.

**Open Todos**

- formalize drift metrics.

**Status**

- early demos looked too much like a chat shell.

### Question: What is the current project goal?

**Check Rules**

- Must include all: generic local chat ui
- Must avoid: self-hosted long-term memory runtime | hosted ai platform

**Answers**

- Project Memory (pass): The current project goal is to ship a generic local chat ui.
- Direct model (pass): The current project goal is to ship a generic local chat UI.

## Round 2: After Pivot

- Checkpoint: after event 10
- This round covers events 6-10
- Digest: 86bf5dd9-076b-4862-9c9a-7347abfa0482

**Input In This Round**

- 6. [document:doc:goal] goal: ship a self-hosted memory layer for project assistants
- 7. [stream] We decide to focus on low-drift memory reliability before expanding integrations
- 8. [stream] TODO: add replay consistency checks
- 9. [stream] Constraint reminder: do not become a general-purpose agent platform
- 10. [stream] Noise: note about optional future desktop demos

**Direct-Model Rolling Summary At This Point**

**Goal**

- ship a self-hosted memory layer for project assistants.

**Constraints**

- keep API stable
- self-hosted first
- do not become a general-purpose agent platform.

**Decisions**

- continue prioritizing memory continuity for long-running projects
- now emphasize achieving low-drift memory reliability before expanding integrations.

**Open Todos**

- formalize drift metrics
- add replay consistency checks.

**Status**

- early demos looked too much like a chat shell.

**Noise**

- optional future desktop demos.

### Question: What is the current project goal?

**Check Rules**

- Must include one of: self-hosted memory layer for project assistants | self-hosted memory layer
- Must avoid: generic local chat ui | hosted ai platform

**Answers**

- Project Memory (pass): Goal: ship a self-hosted memory layer for project assistants.
- Direct model (pass): The current project goal is to ship a self-hosted memory layer for project assistants.

### Question: What is explicitly out of scope?

**Check Rules**

- Must include one of: do not become a general-purpose agent platform | general-purpose agent platform
- Must avoid: hosted ai platform

**Answers**

- Project Memory (pass): There is no explicit statement about what is out of scope in the retrieved memory. The closest boundary is the constraint "do not become a general-purpose agent platform," which suggests a scope limit but is not framed as an explicit out-of-scope item.

- Direct model (pass): - Becoming a general-purpose agent platform (explicit constraint: not in scope).
- Expanding integrations beyond the memory layer until drift metrics and replay checks are formalized (focus is on low-drift reliability first).
- Desktop demos or non-essential UI/demo noise (desktop demos are noted as optional in the future and out of current scope).
- Non-self-hosted deployments or cloud-hosted alternatives are not the current focus (self-hosted first is the priority).

## Round 3: Final State

- Checkpoint: after event 16
- This round covers events 11-16
- Digest: 6cc32641-6b8d-4ce3-8994-368708160fb8

**Input In This Round**

- 11. [document:doc:goal] goal: ship a self-hosted long-term memory runtime for local models
- 12. [stream] We decide to treat assistant runtime as a product boundary, not just loose APIs
- 13. [stream] TODO: define assistant runtime policies
- 14. [stream] Status update: roadmap now centers retention, stability, grounding, and replayability
- 15. [stream] Reminder: hosted platform work is explicitly out of scope
- 16. [stream] Noise: casual discussion about optional desktop mockups and branding experiments

**Direct-Model Rolling Summary At This Point**

**Goal**

- ship a self-hosted memory runtime for local models.

**Constraints**

- stable API
- self-hosted first
- not a general-purpose agent platform
- hosted work out of scope.

**Decisions**

- prioritize memory continuity for long-running projects
- ensure low-drift reliability before expanding integrations
- treat the assistant runtime as a product boundary.

**Open Todos**

- drift metrics
- replay checks
- define runtime policies.

**Status**

- roadmap centers retention, stability, grounding, and replayability.

**Noise**

- desktop mockups and branding experiments discussed.

### Question: What is the current project goal?

**Check Rules**

- Must include one of: self-hosted long-term memory runtime for local models | long-term memory runtime for local models
- Must avoid: generic local chat ui | hosted ai platform

**Answers**

- Project Memory (pass): Current project goal: ship a self-hosted long-term memory runtime for local models. Constraints: keep API stable; self-hosted first.
- Direct model (fail): The goal is to ship a self-hosted memory runtime for local models.

### Question: What constraints still apply?

**Check Rules**

- Must include all: keep api stable | self-hosted first | general-purpose agent platform
- Must avoid: hosted ai platform | break api compatibility

**Answers**

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

### Question: What key decisions have we made?

**Check Rules**

- Must include all: low-drift memory reliability | assistant runtime as a product boundary
- Must avoid: ui polish over memory stability | hosted ai platform

**Answers**

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

### Question: What work remains open?

**Check Rules**

- Must include all: formalize drift metrics | add replay consistency checks | define assistant runtime policies
- Must avoid: remove replay consistency work | delete replay consistency work

**Answers**

- Project Memory (pass): - TODO: define assistant runtime policies
- TODO: add replay consistency checks
- TODO: formalize drift metrics
- Direct model (fail): Open work items:

- Drift metrics: define, implement, and instrument drift metrics to monitor stability and coherence over long-running sessions; establish acceptance thresholds and dashboards.

- Replay checks: implement tests and checks to ensure memory state is replayable/reproducible; add regression tests for replay paths and determinism.

- Define runtime policies: formalize runtime policies governing memory retention, grounding, privacy, security, resource limits, and failure handling; document enforcement rules.
