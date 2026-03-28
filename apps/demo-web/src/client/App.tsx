import { useState } from "react";

import type { getDemoConfig } from "./config";
import { AgentDemoPanel, ChatPanel, ComparePanel, InspectorPanel, OverviewPanel, Sidebar } from "./components";
import { useDemoRuntime } from "./hooks";
import type { DemoTemplate } from "./content";

type DemoConfig = ReturnType<typeof getDemoConfig>;
type DemoPage = "overview" | "chat" | "compare" | "agents";

export function App({ config }: { config: DemoConfig }) {
  const demo = useDemoRuntime(config);
  const [page, setPage] = useState<DemoPage>("overview");
  const compareTemplates = demo.templates.filter((template) => Boolean(template.compare));
  const compareTemplate = compareTemplates.find((template) => template.id === demo.selectedTemplateId) || compareTemplates[0] || null;
  const selectedTemplate = demo.templates.find((template) => template.id === demo.selectedTemplateId) || null;
  const compareStatus =
    page === "compare"
      ? demo.runningCompareTemplateId === demo.selectedTemplateId
        ? "Replay running"
        : demo.completedCompareScenario?.templateId === demo.selectedTemplateId
          ? `Replay completed at ${demo.completedCompareScenario.completedAt}`
          : "No compare run yet"
      : "Guided runtime mode";

  return (
    <div className="app-shell">
      <Sidebar
        guestUserId={demo.guestUserId}
        onResetGuestSession={() => {
          void demo.resetGuestSession();
        }}
        scopeName={demo.scopeName}
        onScopeNameChange={demo.setScopeName}
        onCreateScope={(event) => {
          event.preventDefault();
          void demo.createScope();
        }}
        scopeCards={demo.scopeCards}
        activeScopeId={demo.activeScopeId}
        onSelectScope={(scopeId) => {
          void demo.selectScope(scopeId);
        }}
        onRefreshScopes={() => {
          void demo.refreshScopesAndInspector();
        }}
        healthSummarySections={demo.healthSummarySections}
        health={demo.health}
        turnOutcomeHeadline={demo.turnOutcomeHeadline}
        turnOutcomeDetail={demo.turnOutcomeDetail}
        turnOutcomeFacts={demo.turnOutcomeFacts}
        whyAnswerHeadline={demo.whyAnswerHeadline}
        whyAnswerDetail={demo.whyAnswerDetail}
        whyAnswerFacts={demo.whyAnswerFacts}
        timeline={demo.timeline}
        diff={demo.diff}
        page={page}
        selectedTemplate={selectedTemplate as DemoTemplate | null}
        compareStatus={compareStatus}
      />

      <main className="main-stack">
        <section className="panel surface-tabs">
          <div className="eyebrow">Demo Modes</div>
          <div className="surface-tab-row">
            <button className={`ghost surface-tab${page === "overview" ? " surface-tab-active" : ""}`} type="button" onClick={() => setPage("overview")}>
              Overview
            </button>
            <button className={`ghost surface-tab${page === "chat" ? " surface-tab-active" : ""}`} type="button" onClick={() => setPage("chat")}>
              Chat Demo
            </button>
            <button className={`ghost surface-tab${page === "compare" ? " surface-tab-active" : ""}`} type="button" onClick={() => setPage("compare")}>
              Baseline Compare
            </button>
            <button className={`ghost surface-tab${page === "agents" ? " surface-tab-active" : ""}`} type="button" onClick={() => setPage("agents")}>
              Agent Demo
            </button>
          </div>
        </section>

        {page === "overview" ? (
          <OverviewPanel onOpenChat={() => setPage("chat")} onOpenCompare={() => setPage("compare")} onOpenAgents={() => setPage("agents")} />
        ) : null}

        {page === "chat" ? (
          <>
            <ChatPanel
              activeScope={demo.activeScope}
              activeScopeId={demo.activeScopeId}
              templates={demo.templates}
              selectedTemplateId={demo.selectedTemplateId}
              runningTemplateId={demo.runningCompareTemplateId}
              completedScenario={demo.completedCompareScenario}
              onPrepareTemplate={demo.prepareTemplate}
              onCreateScopeFromTemplate={(template) => {
                void demo.createScopeFromTemplate(template);
              }}
              onRunTemplateScenario={(template) => {
                void demo.runCompareScenario(template);
              }}
              goal={demo.goal}
              answerMode={demo.answerMode}
              retrievalMode={demo.retrievalMode}
              workingVersion={demo.workingVersion}
              stableVersion={demo.stableVersion}
              workingCaughtUp={demo.workingCaughtUp}
              stableCaughtUp={demo.stableCaughtUp}
              goalAligned={demo.goalAligned}
              diff={demo.diff}
              pipeline={demo.pipeline}
              history={demo.history}
              latestMeta={demo.latestMeta}
              inspector={demo.inspector}
            />
            <InspectorPanel
              inspector={demo.inspector}
              retrievalMode={demo.retrievalMode}
              goalAligned={demo.goalAligned}
              workingCaughtUp={demo.workingCaughtUp}
              stableCaughtUp={demo.stableCaughtUp}
            />
          </>
        ) : null}

        {page === "compare" && compareTemplate ? (
          <ComparePanel
            templates={compareTemplates}
            selectedTemplateId={demo.selectedTemplateId}
            onSelectTemplate={demo.prepareTemplate}
            template={compareTemplate}
            runningTemplateId={demo.runningCompareTemplateId}
            completedScenario={demo.completedCompareScenario}
            activeScopeName={demo.activeScope?.name || null}
            onRunTemplateScenario={(template) => {
              void demo.runCompareScenario(template);
            }}
          />
        ) : null}

        {page === "agents" ? (
          <AgentDemoPanel onOpenChat={() => setPage("chat")} onOpenCompare={() => setPage("compare")} />
        ) : null}
      </main>
    </div>
  );
}
