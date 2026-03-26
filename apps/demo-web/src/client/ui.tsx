import { pretty, type PipelineState } from "./lib";

export type SummarySection = {
  label: string;
  value: string | string[] | null | undefined;
  limit?: number;
};

export function SummarySections({ sections, emptyText }: { sections: SummarySection[]; emptyText: string }) {
  const visibleSections = sections.filter((section) => {
    if (Array.isArray(section.value)) {
      return section.value.length > 0;
    }
    return section.value !== null && section.value !== undefined && section.value !== "";
  });

  if (!visibleSections.length) {
    return <div>{emptyText}</div>;
  }

  return (
    <>
      {visibleSections.map((section) => (
        <div className="summary-block" key={section.label}>
          <span className="summary-chip-label">{section.label}</span>
          {Array.isArray(section.value) ? (
            <div className="summary-chip-row">
              {section.value.slice(0, section.limit || 4).map((item) => (
                <span className="summary-chip" key={`${section.label}-${item}`}>
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <div className="summary-block-value">{section.value}</div>
          )}
        </div>
      ))}
    </>
  );
}

export function FactPills({ items }: { items: string[] }) {
  return (
    <>
      {items.map((item) => (
        <span className="fact-pill" key={item}>
          {item}
        </span>
      ))}
    </>
  );
}

export function CodeDetails({ value }: { value: unknown }) {
  return (
    <details className="code-details">
      <summary>Raw JSON</summary>
      <pre className="code-block">{pretty(value)}</pre>
    </details>
  );
}

export function PipelineView({ pipeline }: { pipeline: PipelineState }) {
  const stageOrder: Array<keyof PipelineState> = ["fast", "working", "stable"];
  const activeIndex = stageOrder.findIndex(
    (stage) => pipeline[stage].status === "running" || pipeline[stage].status === "pending"
  );
  const completeIndex = stageOrder.reduce((lastIndex, stage, index) => {
    if (pipeline[stage].status === "complete") return index;
    return lastIndex;
  }, -1);

  const cards = [
    { key: "fast" as const, title: "Fast Layer", step: 1, stepLabel: "Respond now" },
    { key: "working" as const, title: "Working Memory", step: 2, stepLabel: "Update short-term state" },
    { key: "stable" as const, title: "State Layer", step: 3, stepLabel: "Commit durable truth" }
  ];

  return (
    <div className="pipeline-stack">
      {cards.map((card, index) => {
        const value = pipeline[card.key];
        const stepClass =
          activeIndex === index
            ? "step-node step-node-active"
            : (activeIndex === -1 && completeIndex >= index) || (completeIndex >= index && index < activeIndex)
              ? "step-node step-node-complete"
              : "step-node";

        return (
          <article className="pipeline-card" key={card.key}>
            <div className="pipeline-header">
              <span className="pipeline-title">{card.title}</span>
              <span className={`status-pill status-${value.status}`}>{value.label}</span>
            </div>
            <div className="pipeline-detail">{value.detail}</div>
            <div className="pipeline-stepper">
              <span className={stepClass}>{card.step}</span>
              <span className="step-label">{card.stepLabel}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
