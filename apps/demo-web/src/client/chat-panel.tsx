import { DEMO_BRAND, DEMO_FLOW_STEPS, EMPTY_CHAT_HINTS, PIPELINE_LEGEND, type DemoTemplate } from "./content";
import { pretty, type DemoHistoryEntry, type DiffEntry, type InspectorBundle, type PipelineState, type ScopeSummary } from "./lib";
import { FactPills, PipelineView } from "./ui";

export function ChatPanel(props: {
  activeScope: ScopeSummary | null;
  activeScopeId: string | null;
  templates: readonly DemoTemplate[];
  selectedTemplateId: string;
  runningTemplateId: string | null;
  completedScenario: {
    templateId: string;
    scopeId: string;
    scopeName: string;
    completedAt: string;
  } | null;
  onPrepareTemplate: (template: DemoTemplate) => void;
  onCreateScopeFromTemplate: (template: DemoTemplate) => void;
  onRunTemplateScenario: (template: DemoTemplate) => void;
  goal: string;
  answerMode: string;
  retrievalMode: string;
  workingVersion: string | number;
  stableVersion: string;
  workingCaughtUp: boolean;
  stableCaughtUp: boolean;
  goalAligned: boolean | undefined;
  diff: { working: DiffEntry[]; stable: DiffEntry[] };
  pipeline: PipelineState;
  history: DemoHistoryEntry[];
  latestMeta: DemoHistoryEntry["meta"] | null;
  inspector: InspectorBundle;
}) {
  const {
    activeScope,
    activeScopeId,
    templates,
    selectedTemplateId,
    runningTemplateId,
    completedScenario,
    onPrepareTemplate,
    onCreateScopeFromTemplate,
    onRunTemplateScenario,
    goal,
    answerMode,
    retrievalMode,
    workingVersion,
    stableVersion,
    workingCaughtUp,
    stableCaughtUp,
    goalAligned,
    diff,
    pipeline,
    history,
    latestMeta,
    inspector
  } = props;

  const turnStoryHeadline =
    answerMode === "direct_state_fast_path"
      ? "The Fast Layer answered directly from tracked state, then handed off background memory upkeep."
      : "The Fast Layer used the LLM path, then Working Memory and State Layer continued in the background.";
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || null;
  const otherTemplates = templates.filter((template) => template.id !== selectedTemplateId);
  const isCompletedScenarioVisible =
    Boolean(completedScenario) && completedScenario?.templateId === selectedTemplateId && completedScenario.scopeId === activeScopeId;
  const scenarioStatusLabel =
    runningTemplateId === selectedTemplateId ? "Running now" : isCompletedScenarioVisible ? `Completed at ${completedScenario?.completedAt}` : "Ready to run";

  return (
    <section className="panel chat-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Runtime Surface</div>
          <h2>Guided Runtime</h2>
        </div>
      </div>
      <div className="chat-priority-grid">
        <div className="chat-priority-main">
          {selectedTemplate ? (
            <div className="template-stack">
              <div className="template-stack-header">
                <div>
                  <div className="eyebrow">Start From A Template</div>
                  <h3>Run one scenario first, then inspect the live scope</h3>
                </div>
                <div className="template-stack-note">The template runner creates state on purpose so the interesting three-layer behavior becomes visible.</div>
              </div>
              <article className="template-card template-card-active template-card-selected">
                <div className="template-card-header">
                  <div>
                    <h3>{selectedTemplate.title}</h3>
                    <div className="template-card-description">{selectedTemplate.description}</div>
                  </div>
                  <span className="template-scope-name">{selectedTemplate.scopeName}</span>
                </div>
                <div className="template-selected-banner">
                  <strong>Scenario status:</strong> {scenarioStatusLabel}
                </div>
                <div className="template-watch">
                  <span className="field-label">Watch for</span>
                  <FactPills items={selectedTemplate.watch} />
                </div>
                <div className="template-turns template-turns-static">
                  {selectedTemplate.turns.map((turn) => (
                    <div className="template-turn-readonly" key={`${selectedTemplate.id}-${turn.label}`}>
                      {turn.label}: {turn.prompt}
                    </div>
                  ))}
                </div>
                <div className="template-actions">
                  <button
                    type="button"
                    onClick={() => onRunTemplateScenario(selectedTemplate)}
                    disabled={Boolean(runningTemplateId)}
                  >
                    {runningTemplateId === selectedTemplate.id ? "Running scenario..." : "Run template"}
                  </button>
                </div>
              </article>
              <details className="chat-secondary-details template-browser-details">
                <summary>Browse other templates</summary>
                <div className="template-grid template-grid-compact">
                  {otherTemplates.map((template) => (
                    <article className="template-card template-card-compact" key={template.id}>
                      <div className="template-card-header">
                        <div>
                          <h3>{template.title}</h3>
                          <div className="template-card-description">{template.description}</div>
                        </div>
                        <span className="template-scope-name">{template.scopeName}</span>
                      </div>
                      <div className="template-watch">
                        <span className="field-label">Watch for</span>
                        <FactPills items={template.watch} />
                      </div>
                      <div className="template-actions">
                        <button className="ghost" type="button" onClick={() => onPrepareTemplate(template)}>
                          Select template
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </details>
            </div>
          ) : null}
          <div className="hero-card hero-card-compact">
            <div className="hero-row">
              <div>
                <div className="eyebrow">Active Scope</div>
                <h3 className="hero-title">{activeScope?.name || "No scope selected."}</h3>
              </div>
              <span className="hero-stage">{activeScope?.stage ? `Stage: ${activeScope.stage}` : "Unknown stage"}</span>
            </div>
            <div className="hero-goal">{goal}</div>
            <div className="hero-facts">
              <span className="hero-pill">Answer: {answerMode}</span>
              <span className="hero-pill">Retrieval: {retrievalMode}</span>
              <span className="hero-pill">Working: {String(workingVersion)}</span>
              <span className="hero-pill">Stable: {stableVersion}</span>
              <span className="hero-pill">Alignment {goalAligned === true ? "aligned" : goalAligned === false ? "drift" : "unknown"}</span>
            </div>
          </div>
          <div className="chat-status-row">
            <span className="chat-status-pill">{activeScope ? `${activeScope.name} (${activeScope.stage})` : "No active scope"}</span>
            <span className="chat-status-pill">
              {history.length} {history.length === 1 ? "message" : "messages"}
            </span>
            <span className="chat-status-pill">
              {runningTemplateId === selectedTemplateId
                ? "Template run in progress"
                : isCompletedScenarioVisible
                  ? `Template completed at ${completedScenario?.completedAt}`
                  : latestMeta?.answerMode
                    ? `Last answer: ${latestMeta.answerMode}`
                    : activeScopeId
                      ? "Run the selected template to build visible state"
                      : "Create a scope to begin the demo"}
            </span>
            <span className="chat-status-pill">
              {inspector.working?.view?.goal || inspector.stable?.view?.goal
                ? `Current goal: ${inspector.stable?.view?.goal || inspector.working?.view?.goal}`
                : "No memory snapshot yet"}
            </span>
          </div>
          <div className="transcript-header">
            <div className="eyebrow">Live Transcript</div>
            <h3>What the selected template actually sent through the runtime</h3>
          </div>
          <div className="messages">
            {!history.length ? (
              <div className="empty-state">
                <strong>No turns yet for this scope.</strong>
                {EMPTY_CHAT_HINTS.map((hint) => (
                  <div className="empty-state-detail" key={hint}>
                    {hint}
                  </div>
                ))}
              </div>
            ) : (
              [...history].reverse().map((entry, index) => (
                <article className={`message message-${entry.role}`} key={`${entry.role}-${index}`}>
                  <div className="message-label">{entry.role === "user" ? "You" : DEMO_BRAND.eyebrow}</div>
                  <div className="message-body">{entry.content}</div>
                  {entry.meta ? <pre className="message-meta">{pretty(entry.meta)}</pre> : null}
                </article>
              ))
            )}
          </div>
        </div>

        <aside className="pipeline-focus-card">
          <div className="story-card story-card-compact">
            <span className="story-label">Turn Story</span>
            <strong className="story-headline">{turnStoryHeadline}</strong>
            <div className="story-detail">
              Retrieval ran in {retrievalMode} mode. Working Memory changed in {diff.working.length} field
              {diff.working.length === 1 ? "" : "s"} and State Layer changed in {diff.stable.length} field
              {diff.stable.length === 1 ? "" : "s"}.
            </div>
            <div className="story-facts">
              <FactPills
                items={[
                  `Working: ${workingCaughtUp ? "ready" : "pending"}`,
                  `Stable: ${stableCaughtUp ? "ready" : "pending"}`,
                  `Working diff: ${diff.working.length}`,
                  `Stable diff: ${diff.stable.length}`
                ]}
              />
            </div>
          </div>
          <div className="pipeline-focus-header">
            <div>
              <div className="eyebrow">Turn Pipeline</div>
              <h3>What happens after you send a turn</h3>
            </div>
            <div className="pipeline-legend pipeline-legend-compact">{PIPELINE_LEGEND}</div>
          </div>
          <PipelineView pipeline={pipeline} />
        </aside>
      </div>
      <details className="chat-secondary-details">
        <summary>Suggested walkthrough</summary>
        <div className="demo-flow">
          {DEMO_FLOW_STEPS.map(([step, title, detail]) => (
            <article className="demo-flow-card" key={step}>
              <span className="demo-flow-step">{step}</span>
              <div>
                <strong>{title}</strong>
                <div className="demo-flow-detail">{detail}</div>
              </div>
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}
