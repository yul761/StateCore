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
          <div className="eyebrow">Overview</div>
          <h1>Low-drift memory for long-running LLM agents</h1>
          <p className="overview-hero-body">
            StateCore separates immediate response speed from durable state accuracy. The point is not to write a better rolling summary.
            The point is to stop agent memory from quietly drifting as conversations get longer and goals change.
          </p>
          <div className="overview-pill-row">
            <FactPills
              items={[
                "Fast Layer answers in tens of milliseconds",
                "Working Memory updates in sub-second background",
                "State Layer commits durable truth in the background"
              ]}
            />
          </div>
          <div className="overview-cta-row">
            <button type="button" onClick={onOpenChat}>
              Open Chat Demo
            </button>
            <button className="ghost" type="button" onClick={onOpenCompare}>
              See Baseline Compare
            </button>
            <button className="ghost" type="button" onClick={onOpenAgents}>
              Agent Demo Preview
            </button>
          </div>
        </div>

        <div className="overview-signal-card">
          <div className="overview-signal-grid">
            <article className="overview-signal-pill">
              <span className="summary-label">Plain LLM</span>
              <strong>Rolling summary drifts</strong>
              <div className="muted">Old goals blur into new ones, constraints compress, decisions fade into vague advice.</div>
            </article>
            <article className="overview-signal-pill overview-signal-pill-accent">
              <span className="summary-label">StateCore</span>
              <strong>Protected memory stays queryable</strong>
              <div className="muted">Fast replies stay quick while durable state stays replayable and low-drift.</div>
            </article>
          </div>
        </div>
      </div>

      <div className="overview-section">
        <div className="overview-section-copy">
          <div className="eyebrow">Three-Layer Flow</div>
          <h2>One turn, three jobs, three different latency budgets</h2>
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
          <div className="eyebrow">Why Plain LLMs Drift</div>
          <h3>They only have one place to put memory</h3>
          <ul className="overview-list">
            <li>Recent turns get compressed into generic summaries.</li>
            <li>Old goals and new goals blend together after pivots.</li>
            <li>Constraints and decisions get paraphrased until they lose force.</li>
            <li>The model can sound coherent while still forgetting what was actually agreed.</li>
          </ul>
        </article>

        <article className="overview-card overview-card-accent">
          <div className="eyebrow">What StateCore Changes</div>
          <h3>It separates speed from durable truth</h3>
          <ul className="overview-list">
            <li>Fast Layer optimizes for responsiveness, not durable mutation.</li>
            <li>Working Memory keeps short-term state warm between turns.</li>
            <li>State Layer protects the authoritative long-term record.</li>
            <li>The answer path and the memory consolidation path stop fighting each other.</li>
          </ul>
        </article>
      </div>

      <div className="overview-grid">
        <article className="overview-card">
          <div className="eyebrow">Try The Chat Demo</div>
          <h3>Watch the three layers react live</h3>
          <p className="muted">
            Run a guided scenario, then inspect the Fast Layer, Working Memory, State Layer, and live transcript from the same scope.
          </p>
          <button type="button" onClick={onOpenChat}>
            Go to Chat Demo
          </button>
        </article>

        <article className="overview-card">
          <div className="eyebrow">See The Compare</div>
          <h3>Read the same scenario side by side</h3>
          <p className="muted">
            Compare StateCore against a plain rolling-summary baseline at every checkpoint, not just at the end.
          </p>
          <button className="ghost" type="button" onClick={onOpenCompare}>
            Open Baseline Compare
          </button>
        </article>

        <article className="overview-card">
          <div className="eyebrow">Multi-Agent Next</div>
          <h3>Use shared memory for handoffs</h3>
          <p className="muted">
            The next demo page shows how different agents can read the same state, hand work off cleanly, and avoid forgetting the current mission.
          </p>
          <button className="ghost" type="button" onClick={onOpenAgents}>
            Preview Agent Demo
          </button>
        </article>
      </div>
    </section>
  );
}
