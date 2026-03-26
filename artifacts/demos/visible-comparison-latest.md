# Observable Drift Demo

- Started: 2026-03-26T05:23:21.722Z
- Ended: 2026-03-26T05:29:20.445Z
- Status: complete
- Fixture: benchmark-fixtures/observable-drift-demo.json
- Baseline: Direct model (rolling-summary)
- Model: gpt-5-nano
- Completed checkpoints: 3/3

## Score

- Rounds evaluated: 3
- Questions evaluated: 7
- Project Memory passed: 7/7
- Direct model passed: 4/7
- Project Memory wins: 3
- Direct model wins: 0
- Ties: 4

## Round 1: Early Goal

- Checkpoint: after event 5
- This round covers events 1-5
- Digest: cf39814a-519a-48ef-b075-41b893641f27

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

**Open Todos**

- formalize drift metrics.

**Status**

- early demos looked too much like a chat shell.

**Other**

- Decision: focus on memory continuity for long-running projects.

### Question: What is the current project goal?

**Check Rules**

- Must include all: generic local chat ui
- Must avoid: self-hosted long-term memory runtime | hosted ai platform

**Answers**

- Project Memory (pass): The current project goal is to ship a generic local chat UI.
- Direct model (pass): The current project goal is to ship a generic local chat UI.

## Round 2: After Pivot

- Checkpoint: after event 10
- This round covers events 6-10
- Digest: 685814b1-b81c-4c53-b51f-6f690ca7a763

**Input In This Round**

- 6. [document:doc:goal] goal: ship a self-hosted memory layer for project assistants
- 7. [stream] We decide to focus on low-drift memory reliability before expanding integrations
- 8. [stream] TODO: add replay consistency checks
- 9. [stream] Constraint reminder: do not become a general-purpose agent platform
- 10. [stream] Noise: note about optional future desktop demos

**Direct-Model Rolling Summary At This Point**

**Goal**

- ship a self-hosted memory layer for project assistants

**Constraints**

- keep API stable
- self-hosted first
- do not become a general-purpose agent platform

**Open Todos**

- formalize drift metrics
- add replay consistency checks

**Status**

- shifting focus from demos toward reliability; cautious about integration expansions

**Noise**

- optional future desktop demos

**Other**

- Decision: prioritize low-drift memory reliability; defer integrations/expansions until reliability is achieved

### Question: What is the current project goal?

**Check Rules**

- Must include one of: self-hosted memory layer for project assistants | self-hosted memory layer
- Must avoid: generic local chat ui | hosted ai platform

**Answers**

- Project Memory (pass): Goal: ship a self-hosted memory layer for project assistants.
- Direct model (pass): The goal is to ship a self-hosted memory layer for project assistants.

Focusing on API stability, self-hosted-first design, and high reliability (low drift) before adding integrations.

### Question: What is explicitly out of scope?

**Check Rules**

- Must include one of: do not become a general-purpose agent platform | general-purpose agent platform
- Must avoid: hosted ai platform

**Answers**

- Project Memory (pass): There is no item explicitly labeled as "out of scope" in the retrieved memory.

The memory does specify scope-related constraints instead:
- Do not become a general-purpose agent platform.
- Keep API stable.
- Self-hosted first.
- Focus on memory continuity for long-running projects.
- Focus on low-drift memory reliability before expanding integrations.
- Direct model (pass): - Not becoming a general-purpose agent platform.
- Integrations and expansions beyond the core memory layer are deferred and not in scope until reliability (low-drift memory) is achieved.
- Desktop demos are not planned now (optional future).

## Round 3: Final State

- Checkpoint: after event 16
- This round covers events 11-16
- Digest: a3b13174-3c30-4d89-941e-346bbad0507a

**Input In This Round**

- 11. [document:doc:goal] goal: ship a self-hosted long-term memory runtime for local models
- 12. [stream] We decide to treat assistant runtime as a product boundary, not just loose APIs
- 13. [stream] TODO: define assistant runtime policies
- 14. [stream] Status update: roadmap now centers retention, stability, grounding, and replayability
- 15. [stream] Reminder: hosted platform work is explicitly out of scope
- 16. [stream] Noise: casual discussion about optional desktop mockups and branding experiments

**Direct-Model Rolling Summary At This Point**

**Goal**

- ship self-hosted memory runtime for local models

**Constraints**

- API stable
- self-hosted-first
- not a general agent platform
- hosted work out of scope

**Open Todos**

- formalize drift metrics
- add replay checks
- define policies

**Status**

- roadmap for retention, stability, grounding, and replayability; shifting toward reliability; boundary framing; cautious on integrations

**Noise**

- casual optional desktop mockups and branding experiments

**Other**

- Decision: prioritize low-drift reliability; treat runtime as product boundary; design for a stable contract

### Question: What is the current project goal?

**Check Rules**

- Must include one of: self-hosted long-term memory runtime for local models | long-term memory runtime for local models
- Must avoid: generic local chat ui | hosted ai platform

**Answers**

- Project Memory (pass): Ship a self-hosted long-term memory runtime for local models.
- Direct model (fail): The current project goal is to ship a self-hosted memory runtime for local models.

### Question: What constraints still apply?

**Check Rules**

- Must include all: (keep api stable OR api stability must be maintained OR api must remain stable OR stable api) | (self-hosted first OR self-hosted-first OR self hosted first) | (general-purpose agent platform OR general agent platform OR do not become a general-purpose agent platform OR not a general agent platform)
- Must avoid: hosted ai platform | break api compatibility

**Answers**

- Project Memory (pass): - API stability must be maintained.
- Self-hosted first (priority).
- Do not become a general-purpose agent platform.
- Hosted platform work is explicitly out of scope.
- Treat the assistant runtime as a product boundary, not just loose APIs.
- Focus on memory continuity for long-running projects.
- Focus on low-drift memory reliability before expanding integrations.
- Roadmap centers on retention, stability, grounding, and replayability.
- Direct model (pass): Constraints that still apply:
- API must remain stable (no breaking changes).
- Self-hosted-first: primary focus is self-hosted deployment.
- Not a general agent platform; scope is limited to the memory runtime for local models.
- Hosted (cloud) work is out of scope.
- Design constraints: prioritize low-drift reliability, treat the runtime as a product boundary, and design for a stable contract.

### Question: What key decisions have we made?

**Check Rules**

- Must include all: low-drift memory reliability | assistant runtime as a product boundary
- Must avoid: ui polish over memory stability | hosted ai platform

**Answers**

- Project Memory (pass): Key decisions:
- We decide to focus on memory continuity for long-running projects.
- We decide to focus on low-drift memory reliability before expanding integrations.
- We decide to treat assistant runtime as a product boundary, not just loose APIs.
- Direct model (fail): Key decisions:

- Goal: ship a self-hosted memory runtime for local models.
- Constraints decisions:
  - API must be stable.
  - Self-hosted-first posture.
  - Not a general agent platform.
  - Hosted (cloud) work is out of scope.
- design decisions:
  - Prioritize low-drift reliability.
  - Treat the runtime as a product boundary.
  - Design for a stable contract.

### Question: What work remains open?

**Check Rules**

- Must include all: formalize drift metrics | add replay consistency checks | define assistant runtime policies
- Must avoid: remove replay consistency work | delete replay consistency work

**Answers**

- Project Memory (pass): Open work items (TODOs) from the retrieved records:
- Define assistant runtime policies
- Add replay consistency checks
- Formalize drift metrics
- Direct model (fail): Open work remaining (per memory summary open todos):

- Formalize drift metrics: define how to measure model/runtime drift, set thresholds, and establish monitoring/alerting for drift.

- Add replay checks: design and implement replayability checks to verify determinism and reliability across runs; specify replay semantics and logging requirements.

- Define policies: create policy documentation around drift handling, updates/rollback procedures, reliability targets, and boundary contracts.

