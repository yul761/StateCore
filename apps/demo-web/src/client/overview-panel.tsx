import { FactPills } from "./ui";

export function OverviewPanel(props: {
  onOpenChat: () => void;
  onOpenCompare: () => void;
  onOpenAgents: () => void;
}) {
  const { onOpenChat, onOpenCompare, onOpenAgents } = props;

  return (
    <section className="panel overview-panel">
      <div className="overview-hero">
        <div className="overview-hero-copy">
          <div className="eyebrow">StateCore</div>
          <h1>Shared memory runtime for long-running LLM and agent systems</h1>
          <p className="overview-hero-body">
            StateCore keeps goals, constraints, decisions, and risks stable as conversations get longer, agent handoffs multiply, and
            product direction changes. It is not just longer context, chat history, or one more retrieval layer.
          </p>
          <div className="overview-pill-row">
            <FactPills
              items={[
                "Fast Layer answers in tens of milliseconds",
                "Working Memory updates in sub-second background",
                "State Layer commits durable truth in the background",
                "Built for copilots, workflows, and multi-agent systems"
              ]}
            />
          </div>
          <div className="overview-pill-row">
            <FactPills items={["Not just chat history", "Not just RAG", "Not just a rolling summary"]} />
          </div>
          <div className="overview-cta-row">
            <button type="button" onClick={onOpenChat}>
              Open Runtime
            </button>
            <button className="ghost" type="button" onClick={onOpenCompare}>
              Open Compare
            </button>
            <button className="ghost" type="button" onClick={onOpenAgents}>
              Open Agents
            </button>
          </div>
        </div>

        <div className="overview-signal-card">
          <div className="overview-signal-grid">
            <article className="overview-signal-pill">
              <span className="summary-label">Without StateCore</span>
              <strong>State lives inside transcripts and summaries</strong>
              <div className="muted">Old goals blur into new ones, constraints compress, and decisions slowly turn into vague advice.</div>
            </article>
            <article className="overview-signal-pill overview-signal-pill-accent">
              <span className="summary-label">StateCore</span>
              <strong>Protected memory stays queryable across turns</strong>
              <div className="muted">Fast replies stay quick while durable state remains replayable, inspectable, and low-drift.</div>
            </article>
          </div>
        </div>
      </div>

      <div className="overview-section">
        <div className="overview-section-copy">
          <div className="eyebrow">How It Works</div>
          <h2>One turn becomes three jobs with three different latency budgets</h2>
          <p className="muted">
            The same turn does not need one monolithic memory system. Fast Layer serves the user immediately. Working Memory bridges the
            next few turns. State Layer consolidates durable truth without blocking the current reply.
          </p>
        </div>

        <div className="overview-flow-rail">
          <article className="overview-flow-node overview-flow-node-user">
            <div className="overview-flow-step">1</div>
            <h3>User Turn</h3>
            <p>New input arrives with goals, constraints, or context hidden inside natural language.</p>
          </article>
          <article className="overview-flow-node overview-flow-node-fast">
            <div className="overview-flow-step">2</div>
            <h3>Fast Layer</h3>
            <p>Build the prompt from recent turns, retrieval, Working Memory, and Stable State. Answer now.</p>
          </article>
          <article className="overview-flow-node overview-flow-node-working">
            <div className="overview-flow-step">3</div>
            <h3>Working Memory</h3>
            <p>Extract the active goal, constraints, decisions, and open questions quickly in the background.</p>
          </article>
          <article className="overview-flow-node overview-flow-node-state">
            <div className="overview-flow-step">4</div>
            <h3>State Layer</h3>
            <p>Run controlled digest, merge, and consistency checks so durable truth is replayable and low-drift.</p>
          </article>
          <article className="overview-flow-node overview-flow-node-return">
            <div className="overview-flow-step">5</div>
            <h3>Next Turn</h3>
            <p>The next reply can already use Working Memory, then benefit from Stable State once the digest commits.</p>
          </article>
        </div>
      </div>

      <div className="overview-grid">
        <article className="overview-card">
          <div className="eyebrow">Why Systems Drift</div>
          <h3>Most stacks only have one place to put memory</h3>
          <ul className="overview-list">
            <li>Recent turns get compressed into generic summaries.</li>
            <li>Old goals and new goals blend together after pivots.</li>
            <li>Constraints and decisions get paraphrased until they lose force.</li>
            <li>The model can sound coherent while still forgetting what was actually agreed.</li>
          </ul>
        </article>

        <article className="overview-card overview-card-accent">
          <div className="eyebrow">What StateCore Changes</div>
          <h3>It separates responsiveness from durable truth</h3>
          <ul className="overview-list">
            <li>Fast Layer optimizes for responsiveness, not durable mutation.</li>
            <li>Working Memory keeps short-term state warm between turns.</li>
            <li>State Layer protects the authoritative long-term record.</li>
            <li>The answer path and the memory consolidation path stop fighting each other.</li>
          </ul>
        </article>

        <article className="overview-card">
          <div className="eyebrow">Who It Is For</div>
          <h3>Teams shipping systems that need continuity</h3>
          <ul className="overview-list">
            <li>Long-running copilots that need to preserve user intent.</li>
            <li>Workflow agents that must keep constraints and decisions intact.</li>
            <li>Multi-agent handoffs where one agent should not reconstruct mission state from scratch.</li>
            <li>Local-model products that need a deployable memory runtime, not just UI glue.</li>
          </ul>
        </article>
      </div>

      <div className="overview-grid">
        <article className="overview-card">
          <div className="eyebrow">Open Runtime</div>
          <h3>Watch the three layers react live</h3>
          <p className="muted">
            Run a guided scenario, then inspect the Fast Layer, Working Memory, State Layer, and live transcript from the same scope.
          </p>
          <button type="button" onClick={onOpenChat}>
            Open Runtime
          </button>
        </article>

        <article className="overview-card">
          <div className="eyebrow">Open Compare</div>
          <h3>See the same scenario side by side</h3>
          <p className="muted">Compare StateCore against a plain rolling-summary baseline at every checkpoint, not just at the end.</p>
          <button className="ghost" type="button" onClick={onOpenCompare}>
            Open Compare
          </button>
        </article>

        <article className="overview-card">
          <div className="eyebrow">Open Agents</div>
          <h3>See why multi-agent handoffs drift</h3>
          <p className="muted">
            Watch one agent write mission state, the next agent inherit it, and the plain-stack baseline lose fidelity in the handoff.
          </p>
          <button className="ghost" type="button" onClick={onOpenAgents}>
            Open Agents
          </button>
        </article>
      </div>
    </section>
  );
}
