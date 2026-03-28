export function AgentDemoPanel(props: {
  onOpenChat: () => void;
  onOpenCompare: () => void;
}) {
  const { onOpenChat, onOpenCompare } = props;

  return (
    <section className="panel agent-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Agent Demo</div>
          <h2>Scripted multi-agent handoff is the next step</h2>
        </div>
      </div>

      <div className="agent-hero">
        <div className="agent-hero-copy">
          <p className="muted">
            This page is intentionally not a free-form multi-agent playground yet. The first useful version should show a scripted handoff:
            one agent gathers context, one agent turns it into a plan, and one agent executes while all three keep the same durable mission.
          </p>
        </div>
      </div>

      <div className="agent-handoff-rail">
        <article className="agent-handoff-card">
          <div className="agent-badge">Agent 1</div>
          <h3>Researcher</h3>
          <p>Finds raw facts and writes them into Working Memory without blocking the user-facing loop.</p>
        </article>
        <article className="agent-handoff-card">
          <div className="agent-badge">Agent 2</div>
          <h3>Planner</h3>
          <p>Reads the current goal, constraints, and decisions from shared memory, then proposes the next move.</p>
        </article>
        <article className="agent-handoff-card">
          <div className="agent-badge">Agent 3</div>
          <h3>Executor</h3>
          <p>Acts on the plan while the State Layer keeps the long-term mission authoritative and queryable.</p>
        </article>
      </div>

      <div className="overview-grid">
        <article className="overview-card">
          <div className="eyebrow">Why This Matters</div>
          <h3>Multi-agent systems drift even faster</h3>
          <p className="muted">
            Once more than one agent is involved, state loss stops looking like a bad answer and starts looking like a bad handoff. That is the next demo worth building.
          </p>
        </article>

        <article className="overview-card">
          <div className="eyebrow">What You Can Try Now</div>
          <h3>Use the existing demos first</h3>
          <p className="muted">
            The chat and compare pages already prove the important primitive: the same tracked memory can stay stable while answers remain fast.
          </p>
          <div className="overview-cta-row">
            <button type="button" onClick={onOpenChat}>
              Open Chat Demo
            </button>
            <button className="ghost" type="button" onClick={onOpenCompare}>
              Open Baseline Compare
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
