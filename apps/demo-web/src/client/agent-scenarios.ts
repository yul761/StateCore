export type AgentRole = {
  id: "researcher" | "planner" | "executor";
  label: string;
  role: string;
  summary: string;
};

export type AgentScenarioStep = {
  label: string;
  activeAgent: AgentRole["id"];
  userTurn: string;
  agentOutput: string;
  workingWrites: string[];
  stableWrites: string[];
  nextAgentSees: string[];
  baselineSees: string[];
  baselineFailure: string;
  preservedChecks: string[];
  lostChecks: string[];
};

export type AgentScenario = {
  id: string;
  title: string;
  summary: string;
  watch: string[];
  agents: AgentRole[];
  steps: AgentScenarioStep[];
  payoff: string;
  scorecard: {
    withStateCore: string[];
    withoutSharedState: string[];
  };
};

const DEFAULT_AGENTS: AgentRole[] = [
  {
    id: "researcher",
    label: "Researcher",
    role: "Gather facts",
    summary: "Pulls raw context out of the latest turn and turns it into tracked state."
  },
  {
    id: "planner",
    label: "Planner",
    role: "Turn state into a plan",
    summary: "Reads the current mission, constraints, and risks before deciding the next move."
  },
  {
    id: "executor",
    label: "Executor",
    role: "Act without drifting",
    summary: "Executes while the same durable state stays visible instead of relying on stale chat context."
  }
];

export const AGENT_SCENARIOS: AgentScenario[] = [
  {
    id: "launch-handoff",
    title: "Launch handoff",
    summary: "A researcher, planner, and executor hand off a product launch without losing the goal, rollout constraint, or launch risk.",
    watch: ["Mission continuity", "Constraint handoff", "Risk carryover"],
    payoff: "With shared tracked state, each agent sees the same mission. Without it, the handoff collapses into vague launch advice.",
    scorecard: {
      withStateCore: ["Goal preserved", "Constraint preserved", "Risk preserved", "Decision preserved"],
      withoutSharedState: ["Goal blurred after pivot", "Constraint softened", "Risk not durable", "Decision turns generic"]
    },
    agents: DEFAULT_AGENTS,
    steps: [
      {
        label: "Step 1",
        activeAgent: "researcher",
        userTurn: "We are launching StateCore for local-model developers. Keep the launch self-hosted first and do not promise team collaboration yet.",
        agentOutput:
          "Captured the launch mission, the self-hosted-first product constraint, and the 'no collaboration promise yet' boundary.",
        workingWrites: [
          "Goal: launch StateCore for local-model developers",
          "Constraint: self-hosted first",
          "Constraint: do not promise collaboration yet"
        ],
        stableWrites: [],
        nextAgentSees: [
          "Goal: launch StateCore for local-model developers",
          "Constraints: self-hosted first; no collaboration promise yet"
        ],
        baselineSees: ["Goal: launch StateCore", "Constraint: generic launch focus"],
        baselineFailure: "A plain handoff usually keeps 'launch StateCore' but softens the product boundary into generic launch language.",
        preservedChecks: ["Launch goal", "Self-hosted-first boundary", "No collaboration promise"],
        lostChecks: ["No collaboration promise", "Exact product boundary"]
      },
      {
        label: "Step 2",
        activeAgent: "researcher",
        userTurn: "One more thing: the biggest risk is people thinking this is just another chat wrapper instead of a memory runtime.",
        agentOutput: "Added a launch risk that messaging must defend the memory-runtime positioning.",
        workingWrites: ["Risk: messaging could collapse into 'just another chat wrapper'"],
        stableWrites: ["Risk: messaging must defend the memory-runtime positioning"],
        nextAgentSees: [
          "Goal: launch StateCore for local-model developers",
          "Constraints: self-hosted first; no collaboration promise yet",
          "Risk: avoid 'just another chat wrapper' framing"
        ],
        baselineSees: ["Goal: launch StateCore", "Constraint: stay focused", "Risk: not clearly carried forward"],
        baselineFailure: "The risk often stays in the last answer but fails to become durable state that the planner still sees later.",
        preservedChecks: ["Positioning risk", "Constraint carryover", "Launch mission"],
        lostChecks: ["Risk durability", "Exact risk wording"]
      },
      {
        label: "Step 3",
        activeAgent: "planner",
        userTurn: "Draft the next move for launch week.",
        agentOutput:
          "Proposed a launch-week plan: homepage first, compare page second, and explicit messaging about StateCore as a low-drift memory runtime.",
        workingWrites: [
          "Decision: homepage first, compare page second",
          "Decision: message StateCore as a low-drift memory runtime"
        ],
        stableWrites: ["Decision: homepage first, compare page second"],
        nextAgentSees: [
          "Goal: launch StateCore for local-model developers",
          "Constraints: self-hosted first; no collaboration promise yet",
          "Risk: avoid 'just another chat wrapper' framing",
          "Decisions: homepage first; compare page second"
        ],
        baselineSees: ["Goal: launch StateCore", "Loose launch plan", "Risk maybe implied"],
        baselineFailure: "Without tracked state, the planner usually returns a plausible plan but forgets either the positioning risk or the collaboration boundary.",
        preservedChecks: ["Launch sequence", "Positioning risk", "Collaboration boundary"],
        lostChecks: ["Risk in plan", "Boundary in plan"]
      },
      {
        label: "Step 4",
        activeAgent: "executor",
        userTurn: "What exactly should the public landing page say right now?",
        agentOutput:
          "Lead with StateCore as low-drift memory for long-running local-model systems, mention self-hosted first, and avoid promising collaboration until the agent surface exists.",
        workingWrites: ["Executor answer stayed aligned with the tracked mission"],
        stableWrites: ["Stable state now reflects goal, constraints, risk, and rollout decisions"],
        nextAgentSees: [
          "Goal: launch StateCore for local-model developers",
          "Constraints: self-hosted first; no collaboration promise yet",
          "Risk: avoid 'just another chat wrapper' framing",
          "Decisions: homepage first; compare page second"
        ],
        baselineSees: ["Generic launch copy", "Some self-hosted wording", "No durable boundary check"],
        baselineFailure: "The baseline answer often sounds polished but drifts toward generic launch copy and reintroduces promises the team explicitly ruled out.",
        preservedChecks: ["Current mission", "Current constraints", "Current risk", "Current rollout decision"],
        lostChecks: ["No-collaboration boundary", "Memory-runtime positioning"]
      }
    ]
  },
  {
    id: "incident-handoff",
    title: "Incident response handoff",
    summary: "A researcher, planner, and executor coordinate an incident without losing severity, customer constraint, or immediate action.",
    watch: ["Severity continuity", "Customer constraint", "Next-action precision"],
    payoff: "This is where multi-agent drift becomes an operational problem: the wrong handoff is no longer a bad answer, it is the wrong action.",
    scorecard: {
      withStateCore: ["Severity preserved", "Scope preserved", "Customer constraint preserved", "Mitigation preserved"],
      withoutSharedState: ["Severity survives vaguely", "Scope broadens", "Constraint disappears", "Mitigation over-escalates"]
    },
    agents: DEFAULT_AGENTS,
    steps: [
      {
        label: "Step 1",
        activeAgent: "researcher",
        userTurn:
          "Production compare replay is timing out for public demo users. Severity is high, but do not take the site fully offline because people are actively evaluating the product.",
        agentOutput: "Captured a high-severity incident with an explicit constraint to keep the public site online during mitigation.",
        workingWrites: [
          "Goal: mitigate compare replay outage",
          "Constraint: do not take the site fully offline",
          "Severity: high"
        ],
        stableWrites: [],
        nextAgentSees: [
          "Goal: mitigate compare replay outage",
          "Constraint: keep public site online",
          "Severity: high"
        ],
        baselineSees: ["Outage exists", "Severity: high", "Constraint often missing"],
        baselineFailure: "A plain handoff often keeps 'there is an outage' but loses the keep-the-site-online constraint.",
        preservedChecks: ["Incident goal", "Severity", "Keep-site-online constraint"],
        lostChecks: ["Customer-visible constraint"]
      },
      {
        label: "Step 2",
        activeAgent: "researcher",
        userTurn: "The failure only affects replay on the compare page. Overview and runtime are still loading.",
        agentOutput: "Scoped the incident to compare replay so the fix can stay narrow instead of full-site mitigation.",
        workingWrites: ["Scope: compare replay only"],
        stableWrites: ["Scope: compare replay only"],
        nextAgentSees: [
          "Goal: mitigate compare replay outage",
          "Constraint: keep public site online",
          "Severity: high",
          "Scope: compare replay only"
        ],
        baselineSees: ["Outage", "High severity", "Full-site scope inferred"],
        baselineFailure: "Without durable state, the next agent often treats the whole site as broken and recommends unnecessary rollback.",
        preservedChecks: ["Scoped failure", "Keep-site-online constraint", "Severity continuity"],
        lostChecks: ["Compare-only scope"]
      },
      {
        label: "Step 3",
        activeAgent: "planner",
        userTurn: "What is the immediate mitigation plan?",
        agentOutput:
          "Leave overview and runtime live, disable compare replay entry points temporarily, and post a narrow status note while tracing the replay timeout path.",
        workingWrites: [
          "Decision: keep overview/runtime live",
          "Decision: disable compare replay entry points only",
          "Decision: post narrow status note"
        ],
        stableWrites: ["Decision: disable compare replay entry points only"],
        nextAgentSees: [
          "Goal: mitigate compare replay outage",
          "Constraint: keep public site online",
          "Scope: compare replay only",
          "Decision: disable compare replay entry points only"
        ],
        baselineSees: ["Broad outage", "General mitigation plan", "Rollback pressure"],
        baselineFailure: "The baseline plan often escalates to broad mitigation because it forgot the scoped-failure detail.",
        preservedChecks: ["Narrow mitigation", "Public-site stays up", "Compare-only scope"],
        lostChecks: ["Narrow scope", "Specific mitigation decision"]
      },
      {
        label: "Step 4",
        activeAgent: "executor",
        userTurn: "Write the operator summary for the next on-call handoff.",
        agentOutput:
          "High severity incident limited to compare replay. Keep overview and runtime public, disable compare replay only, and continue tracing the timeout path without a full-site rollback.",
        workingWrites: ["Executor handoff stayed aligned with severity, scope, and mitigation"],
        stableWrites: ["Stable state now includes severity, scope, and mitigation decision"],
        nextAgentSees: [
          "Goal: mitigate compare replay outage",
          "Constraint: keep public site online",
          "Scope: compare replay only",
          "Decision: disable compare replay entry points only"
        ],
        baselineSees: ["There was an outage", "Rollback if needed", "Little durable scope detail"],
        baselineFailure: "A drifted handoff usually degrades into 'there was an outage, rollback if needed' and loses the narrow mitigation strategy.",
        preservedChecks: ["Severity", "Scope", "Customer constraint", "Mitigation decision"],
        lostChecks: ["Scoped response", "Keep-site-online constraint", "Compare-only decision"]
      }
    ]
  }
];
