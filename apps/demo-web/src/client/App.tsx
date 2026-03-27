import type { getDemoConfig } from "./config";
import { ComparePanel, Sidebar } from "./components";
import { useDemoRuntime } from "./hooks";

type DemoConfig = ReturnType<typeof getDemoConfig>;

export function App({ config }: { config: DemoConfig }) {
  const demo = useDemoRuntime(config);
  const compareTemplates = demo.templates.filter((template) => Boolean(template.compare));
  const compareTemplate = compareTemplates.find((template) => template.id === demo.selectedTemplateId) || compareTemplates[0] || null;

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
      />

      <main className="main-stack">
        {compareTemplate ? (
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
      </main>
    </div>
  );
}
