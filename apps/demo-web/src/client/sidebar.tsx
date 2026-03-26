import { CHAT_HINT, DEMO_BRAND, PIPELINE_LEGEND } from "./content";
import type { DiffEntry, PipelineState, ScopeSummary } from "./lib";
import { CodeDetails, FactPills, PipelineView, SummarySections, type SummarySection } from "./ui";

export type ScopeCard = ScopeSummary & {
  messageCount: number;
  latestTurn: string | null;
};

export function Sidebar(props: {
  scopeName: string;
  onScopeNameChange: (value: string) => void;
  onCreateScope: (event: React.FormEvent<HTMLFormElement>) => void;
  scopeCards: ScopeCard[];
  activeScopeId: string | null;
  onSelectScope: (scopeId: string) => void;
  onRefreshScopes: () => void;
  healthSummarySections: SummarySection[];
  health: unknown;
  turnOutcomeHeadline: string;
  turnOutcomeDetail: string;
  turnOutcomeFacts: string[];
  whyAnswerHeadline: string;
  whyAnswerDetail: string;
  whyAnswerFacts: string[];
  pipeline: PipelineState;
  timeline: { title: string; detail: string; time: string }[];
  diff: { working: DiffEntry[]; stable: DiffEntry[] };
}) {
  const {
    scopeName,
    onScopeNameChange,
    onCreateScope,
    scopeCards,
    activeScopeId,
    onSelectScope,
    onRefreshScopes,
    healthSummarySections,
    health,
    turnOutcomeHeadline,
    turnOutcomeDetail,
    turnOutcomeFacts,
    whyAnswerHeadline,
    whyAnswerDetail,
    whyAnswerFacts,
    pipeline,
    timeline,
    diff
  } = props;

  return (
    <aside className="sidebar">
      <div className="panel">
        <div className="eyebrow">{DEMO_BRAND.eyebrow}</div>
        <h1>{DEMO_BRAND.title}</h1>
        <p className="muted">{DEMO_BRAND.subtitle}</p>
      </div>

      <div className="panel">
        <h2>Session</h2>
        <form className="stack" onSubmit={onCreateScope}>
          <input
            value={scopeName}
            onChange={(event) => onScopeNameChange(event.target.value)}
            name="scopeName"
            type="text"
            placeholder="New scope name"
            required
          />
          <button type="submit">Create Scope</button>
        </form>
        <div className="scope-browser">
          <div className="scope-browser-header">
            <span className="field-label">Recent Scopes</span>
            <span className="scope-browser-count">
              {scopeCards.length} {scopeCards.length === 1 ? "scope" : "scopes"}
            </span>
          </div>
          <div className="scope-list">
            {!scopeCards.length ? (
              <div className="scope-list-empty">Create a scope to start a three-layer session.</div>
            ) : (
              scopeCards.map((scope) => (
                <button
                  className={`scope-item${scope.id === activeScopeId ? " scope-item-active" : ""}`}
                  key={scope.id}
                  type="button"
                  onClick={() => onSelectScope(scope.id)}
                >
                  <div className="scope-item-row">
                    <div className="scope-item-title">{scope.name}</div>
                    <span className={`scope-item-badge${scope.id === activeScopeId ? " scope-item-badge-active" : ""}`}>
                      {scope.id === activeScopeId ? "Active" : scope.stage}
                    </span>
                  </div>
                  <div className="scope-item-meta">
                    {scope.messageCount} {scope.messageCount === 1 ? "message" : "messages"} | stage: {scope.stage}
                  </div>
                  <div className="scope-item-preview">
                    {scope.latestTurn || "No turns yet. Ask about the current goal or constraints."}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="stack gap-sm">
          <label className="field-label" htmlFor="scope-select">
            Active Scope
          </label>
          <select id="scope-select" value={activeScopeId || ""} onChange={(event) => onSelectScope(event.target.value)}>
            {scopeCards.map((scope) => (
              <option key={scope.id} value={scope.id}>
                {scope.name}
              </option>
            ))}
          </select>
        </div>
        <button className="ghost" type="button" onClick={onRefreshScopes}>
          Refresh Scopes
        </button>
      </div>

      <div className="sidebar-section-label">Explain The Turn</div>

      <div className="panel">
        <h2>Status</h2>
        <div className="summary-inline">
          <SummarySections sections={healthSummarySections} emptyText="Loading health..." />
        </div>
        <CodeDetails value={health} />
      </div>

      <div className="panel">
        <h2>Last Turn Outcome</h2>
        <div className="explanation-card">
          <div className="explanation-headline">{turnOutcomeHeadline}</div>
          <div className="explanation-detail">{turnOutcomeDetail}</div>
          <div className="explanation-facts">
            <FactPills items={turnOutcomeFacts} />
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Why This Answer</h2>
        <div className="explanation-card">
          <div className="explanation-headline">{whyAnswerHeadline}</div>
          <div className="explanation-detail">{whyAnswerDetail}</div>
          <div className="explanation-facts">
            <FactPills items={whyAnswerFacts} />
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Turn Pipeline</h2>
        <div className="pipeline-legend">{PIPELINE_LEGEND}</div>
        <PipelineView pipeline={pipeline} />
      </div>

      <div className="sidebar-section-label">Deep Diagnostics</div>

      <details className="panel diagnostics-panel" open>
        <summary>Last Turn Timeline</summary>
        <div className="timeline-list">
          {!timeline.length ? (
            <div className="timeline-empty">Send a message to see the three-layer turn timeline.</div>
          ) : (
            timeline.map((item) => (
              <article className="timeline-item" key={`${item.time}-${item.title}`}>
                <div className="timeline-row">
                  <div className="timeline-title">{item.title}</div>
                  <div className="timeline-time">{item.time}</div>
                </div>
                <div className="timeline-detail">{item.detail}</div>
              </article>
            ))
          )}
        </div>
      </details>

      <details className="panel diagnostics-panel">
        <summary>Latest Layer Diff</summary>
        <div className="diff-grid">
          <article className="diff-card">
            <h3>Working Memory Diff</h3>
            <div className="diff-list">
              {diff.working.length ? (
                diff.working.map((item) => (
                  <div className="diff-item" key={`working-${item.field}-${item.detail}`}>
                    <strong>{item.field}</strong>: {item.detail}
                  </div>
                ))
              ) : (
                "No working-memory diff yet."
              )}
            </div>
          </article>
          <article className="diff-card">
            <h3>State Layer Diff</h3>
            <div className="diff-list">
              {diff.stable.length ? (
                diff.stable.map((item) => (
                  <div className="diff-item" key={`stable-${item.field}-${item.detail}`}>
                    <strong>{item.field}</strong>: {item.detail}
                  </div>
                ))
              ) : (
                "No state-layer diff yet."
              )}
            </div>
          </article>
        </div>
      </details>

      <div className="chat-hint">{CHAT_HINT}</div>
    </aside>
  );
}
