import { compactCountLabel, type InspectorBundle } from "./lib";
import { CodeDetails, SummarySections } from "./ui";

export function InspectorPanel(props: {
  inspector: InspectorBundle;
  retrievalMode: string;
  goalAligned: boolean | undefined;
  workingCaughtUp: boolean;
  stableCaughtUp: boolean;
}) {
  const { inspector, retrievalMode, goalAligned, workingCaughtUp, stableCaughtUp } = props;

  return (
    <section className="panel inspector-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Three Layers</div>
          <h2>Inspector</h2>
        </div>
      </div>
      <div className="inspector-grid">
        <article className="inspector-card">
          <h3>Working Memory</h3>
          <div className="summary-inline">
            <SummarySections
              sections={[
                { label: "Goal", value: inspector.working?.view?.goal },
                { label: "Task Frame", value: inspector.working?.view?.taskFrame },
                { label: "Constraints", value: inspector.working?.view?.constraints || [], limit: 3 },
                { label: "Decisions", value: inspector.working?.view?.decisions || [], limit: 3 },
                { label: "Open Questions", value: inspector.working?.view?.openQuestions || [], limit: 3 }
              ]}
              emptyText="No working memory snapshot."
            />
          </div>
          <CodeDetails value={inspector.working} />
        </article>

        <article className="inspector-card">
          <h3>Stable State</h3>
          <div className="summary-inline">
            <SummarySections
              sections={[
                { label: "Goal", value: inspector.stable?.view?.goal },
                { label: "Constraints", value: inspector.stable?.view?.constraints || [], limit: 3 },
                { label: "Decisions", value: inspector.stable?.view?.decisions || [], limit: 3 },
                { label: "Todos", value: inspector.stable?.view?.todos || [], limit: 3 },
                { label: "Risks", value: inspector.stable?.view?.risks || [], limit: 3 }
              ]}
              emptyText="No stable state snapshot."
            />
          </div>
          <CodeDetails value={inspector.stable} />
        </article>

        <article className="inspector-card">
          <h3>Fast View</h3>
          <div className="summary-inline">
            <SummarySections
              sections={[
                { label: "Summary", value: inspector.fast?.fastLayerContext?.summary },
                { label: "Retrieval", value: retrievalMode },
                {
                  label: "Recent Turns",
                  value: Array.isArray(inspector.fast?.fastLayerContext?.recentTurns)
                    ? compactCountLabel(inspector.fast.fastLayerContext.recentTurns, "turn")
                    : null
                },
                {
                  label: "Snippets",
                  value: Array.isArray(inspector.fast?.fastLayerContext?.retrievalSnippets)
                    ? compactCountLabel(inspector.fast.fastLayerContext.retrievalSnippets, "snippet")
                    : null
                }
              ]}
              emptyText="No fast-layer summary yet."
            />
          </div>
          <CodeDetails value={inspector.fast} />
        </article>

        <article className="inspector-card">
          <h3>Layer Status</h3>
          <div className="summary-inline">
            <SummarySections
              sections={[
                {
                  label: "Alignment",
                  value: goalAligned === true ? "Goal aligned" : goalAligned === false ? "Goal drift detected" : null
                },
                {
                  label: "Freshness",
                  value: [workingCaughtUp ? "Working caught up" : "Working pending", stableCaughtUp ? "Stable caught up" : "Stable pending"]
                },
                {
                  label: "Warnings",
                  value: inspector.layer?.warnings && inspector.layer.warnings.length ? inspector.layer.warnings : ["No warnings"]
                }
              ]}
              emptyText="Send a turn to inspect diagnostics."
            />
          </div>
          <CodeDetails value={inspector.layer} />
        </article>
      </div>
    </section>
  );
}
