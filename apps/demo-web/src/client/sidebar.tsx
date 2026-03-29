import { CHAT_HINT, DEMO_BRAND, type DemoTemplate } from "./content";
import type { DiffEntry, ScopeSummary } from "./lib";
import { CodeDetails, FactPills, SummarySections, type SummarySection } from "./ui";

export type ScopeCard = ScopeSummary & {
  messageCount: number;
  latestTurn: string | null;
};

export function Sidebar(props: {
  page: "overview" | "chat" | "compare" | "agents";
  guestUserId: string;
  onResetGuestSession: () => void;
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
  timeline: { title: string; detail: string; time: string }[];
  diff: { working: DiffEntry[]; stable: DiffEntry[] };
  selectedTemplate: DemoTemplate | null;
  compareStatus: string;
}) {
  const {
    page,
    guestUserId,
    onResetGuestSession,
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
    timeline,
    diff,
    selectedTemplate,
    compareStatus
  } = props;

  const isChatPage = page === "chat";
  const isComparePage = page === "compare";
  const isOverviewPage = page === "overview";
  const isAgentPage = page === "agents";

  return (
    <aside className="sidebar">
      <div className="panel">
        <div className="eyebrow">{DEMO_BRAND.eyebrow}</div>
        <h1>{DEMO_BRAND.title}</h1>
        <p className="muted">{DEMO_BRAND.subtitle}</p>
      </div>

      <div className="panel">
        {isChatPage ? (
          <>
            <h2>Workspace</h2>
            <div className="guest-session-card">
              <div className="guest-session-row">
                <div>
                  <div className="field-label">Visitor Session</div>
                  <div className="guest-session-id" title={guestUserId}>
                    {guestUserId}
                  </div>
                </div>
                <button className="ghost" type="button" onClick={onResetGuestSession}>
                  Reset
                </button>
              </div>
              <div className="guest-session-detail">This browser keeps a private anonymous visitor id so scopes stay isolated from other visitors.</div>
            </div>
            <form className="stack" onSubmit={onCreateScope}>
              <input
                value={scopeName}
                onChange={(event) => onScopeNameChange(event.target.value)}
                name="scopeName"
                type="text"
                placeholder="New workspace name"
                required
              />
              <button type="submit">Create Workspace</button>
            </form>
            <div className="scope-browser">
              <div className="scope-browser-header">
                <span className="field-label">Recent Workspaces</span>
                <span className="scope-browser-count">
                  {scopeCards.length} {scopeCards.length === 1 ? "workspace" : "workspaces"}
                </span>
              </div>
              <div className="scope-list">
                {!scopeCards.length ? (
                  <div className="scope-list-empty">Create a workspace to start a three-layer runtime session.</div>
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
                Active Workspace
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
              Refresh Workspaces
            </button>
          </>
        ) : (
          <>
            <h2>{isOverviewPage ? "Overview" : isComparePage ? "Compare Guide" : "Agents"}</h2>
            <div className="guest-session-card">
              <div className="guest-session-row">
                <div>
                  <div className="field-label">Visitor Session</div>
                  <div className="guest-session-id" title={guestUserId}>
                    {guestUserId}
                  </div>
                </div>
                <button className="ghost" type="button" onClick={onResetGuestSession}>
                  Reset
                </button>
              </div>
              <div className="guest-session-detail">Anonymous sessions keep this public site lightweight while isolating saved runtime state per visitor.</div>
            </div>
            <div className="sidebar-mode-card">
              {isOverviewPage ? (
                <>
                  <div className="sidebar-mode-title">StateCore at a glance</div>
                  <div className="sidebar-mode-body">Start here for the product story: what drift looks like, why the three-layer split exists, and which view to open next.</div>
                  <FactPills items={["Product overview", "Three-layer flow", "Runtime", "Compare"]} />
                </>
              ) : null}
              {isComparePage ? (
                <>
                  <div className="sidebar-mode-title">How to read compare mode</div>
                  <div className="sidebar-mode-body">
                    {selectedTemplate
                      ? `You are comparing the same scenario through StateCore and a plain rolling-summary baseline. Current scenario: ${selectedTemplate.title}.`
                      : "Pick a scenario to see where low-drift state starts to diverge from a plain LLM."}
                  </div>
                  <FactPills items={[selectedTemplate?.title || "No scenario", compareStatus, "Same model", "Same sequence"]} />
                </>
              ) : null}
              {isAgentPage ? (
                <>
                  <div className="sidebar-mode-title">What this page previews</div>
                  <div className="sidebar-mode-body">The next product surface is a scripted multi-agent handoff where researcher, planner, and executor all read the same durable mission without drifting apart.</div>
                  <FactPills items={["Shared state", "Handoff", "Planner", "Executor"]} />
                </>
              ) : null}
            </div>
          </>
        )}
      </div>

      {isChatPage ? (
        <>
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
        </>
      ) : (
        <div className="panel">
          <h2>Status</h2>
          <div className="summary-inline">
            <SummarySections sections={healthSummarySections} emptyText="Loading health..." />
          </div>
          <CodeDetails value={health} />
        </div>
      )}

      <div className="chat-hint">{CHAT_HINT}</div>
    </aside>
  );
}
