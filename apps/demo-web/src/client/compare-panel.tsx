import type { DemoTemplate } from "./content";
import { FactPills } from "./ui";

export function ComparePanel(props: {
  templates: readonly DemoTemplate[];
  selectedTemplateId: string;
  onSelectTemplate: (template: DemoTemplate) => void;
  template: DemoTemplate;
  runningTemplateId: string | null;
  completedScenario: {
    templateId: string;
    scopeId: string;
    scopeName: string;
    completedAt: string;
  } | null;
  activeScopeName: string | null;
  onRunTemplateScenario: (template: DemoTemplate) => void;
}) {
  const { templates, selectedTemplateId, onSelectTemplate, template, runningTemplateId, completedScenario, activeScopeName, onRunTemplateScenario } = props;
  const compare = template.compare;

  if (!compare) return null;

  const isRunning = runningTemplateId === template.id;
  const isCompleted = completedScenario?.templateId === template.id;

  return (
    <section className="panel compare-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Low-Drift Evidence</div>
          <h2>Project Memory vs plain LLM</h2>
        </div>
      </div>

      <div className="compare-template-switcher">
        {templates.map((item) => (
          <button
            className={`ghost compare-template-pill${item.id === selectedTemplateId ? " compare-template-pill-active" : ""}`}
            key={item.id}
            type="button"
            onClick={() => onSelectTemplate(item)}
          >
            {item.title}
          </button>
        ))}
      </div>

      <div className="compare-panel-header">
        <div>
          <h3>{template.title}</h3>
          <div className="compare-preview-body">{template.description}</div>
        </div>
        <div className="compare-panel-actions">
          <button type="button" onClick={() => onRunTemplateScenario(template)} disabled={Boolean(runningTemplateId)}>
            {runningTemplateId === template.id ? "Running compare..." : "Replay compare scenario"}
          </button>
        </div>
      </div>

      <div className="compare-panel-facts compare-panel-facts-top">
        <span className="compare-score-pill">Same model</span>
        <span className="compare-score-pill">Same input sequence</span>
        <span className="compare-score-pill">{activeScopeName ? `Live replay scope: ${activeScopeName}` : "No active replay scope"}</span>
        <span className="compare-score-pill">
          {isRunning ? "Replay running" : isCompleted ? `Replay completed at ${completedScenario?.completedAt}` : "No compare run yet"}
        </span>
      </div>

      {isCompleted ? (
        <>
          {compare.score ? (
            <div className="compare-result-strip">
              <article className="compare-result-pill compare-result-pill-project-memory">
                <span className="compare-checkpoint-label">Project Memory</span>
                <strong>{compare.score.projectMemory}</strong>
              </article>
              <article className="compare-result-pill compare-result-pill-plain-llm">
                <span className="compare-checkpoint-label">Plain LLM</span>
                <strong>{compare.score.plainLlm}</strong>
              </article>
              <article className="compare-result-pill">
                <span className="compare-checkpoint-label">Scenario</span>
                <strong>{compare.score.rounds}</strong>
              </article>
            </div>
          ) : null}

          <div className="compare-checkpoints">
            <div className="compare-checkpoint-header">
              <div>
                <div className="compare-checkpoint-label">Live Compare Transcript</div>
                <h3>Ask the same question at each checkpoint and read both answers side by side</h3>
              </div>
            </div>

            {compare.checkpoints?.map((checkpoint, index) => (
              <article className="compare-step-card" key={`${template.id}-${checkpoint.label}`}>
                <div className="compare-step-header">
                  <div>
                    <div className="compare-checkpoint-label">{checkpoint.label}</div>
                    <div className="compare-checkpoint-question">{checkpoint.question}</div>
                  </div>
                  {template.turns[index] ? (
                    <div className="compare-step-source">
                      <span className="compare-preview-label">{template.turns[index]?.label}</span>
                      <div className="compare-step-source-text">{template.turns[index]?.prompt}</div>
                    </div>
                  ) : null}
                </div>

                <div className="compare-checkpoint-grid">
                  <div className="compare-checkpoint-answer compare-checkpoint-answer-project-memory">
                    <span className="compare-preview-label">Project Memory Answer</span>
                    <div className="compare-preview-body">{checkpoint.projectMemoryAnswer}</div>
                  </div>
                  <div className="compare-checkpoint-answer compare-checkpoint-answer-plain-llm">
                    <span className="compare-preview-label">Plain LLM Answer</span>
                    <div className="compare-preview-body">{checkpoint.plainLlmAnswer}</div>
                  </div>
                </div>

                <div className="compare-step-takeaway">
                  <FactPills items={[checkpoint.takeaway]} />
                </div>
              </article>
            ))}
          </div>

          <div className="compare-transcript-grid">
            <article className="compare-transcript-card">
              <div className="compare-checkpoint-label">Scenario Transcript</div>
              <h3>The exact sequence both sides receive</h3>
              <div className="compare-transcript-list">
                {template.turns.map((turn) => (
                  <div className="compare-transcript-item" key={`${template.id}-${turn.label}`}>
                    <div className="compare-transcript-step">{turn.label}</div>
                    <div className="compare-transcript-text">{turn.prompt}</div>
                  </div>
                ))}
              </div>
            </article>

            <article className="compare-transcript-card">
              <div className="compare-checkpoint-label">What To Watch</div>
              <h3>Where drift becomes visible</h3>
              <div className="compare-watch-list">
                {template.watch.map((item) => (
                  <div className="compare-watch-item" key={`${template.id}-${item}`}>
                    {item}
                  </div>
                ))}
              </div>
              <div className="compare-preview-footer">{compare.whyItMatters}</div>
            </article>
          </div>
        </>
      ) : (
        <div className="compare-empty-state">
          <div className="compare-checkpoint-label">No Compare Result Yet</div>
          <h3>{isRunning ? "The compare scenario is running now." : "Run the scenario to reveal the side-by-side result."}</h3>
          <div className="compare-preview-body">
            {isRunning
              ? "Once the replay completes, this page will expand into per-step answer comparisons, score cards, and result takeaways."
              : "The transcript above shows the exact scenario. Click replay to unlock the result view and see where Project Memory and a plain LLM start to diverge."}
          </div>
        </div>
      )}
    </section>
  );
}
