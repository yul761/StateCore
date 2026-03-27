import type { getDemoConfig } from "./config";
import { ChatPanel, InspectorPanel, Sidebar } from "./components";
import { useDemoRuntime } from "./hooks";

type DemoConfig = ReturnType<typeof getDemoConfig>;

export function App({ config }: { config: DemoConfig }) {
  const demo = useDemoRuntime(config);

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
        <ChatPanel
          activeScope={demo.activeScope}
          activeScopeId={demo.activeScopeId}
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
          messageInput={demo.messageInput}
          onMessageInputChange={demo.setMessageInput}
          onSubmit={(event) => {
            event.preventDefault();
            void demo.sendMessage(demo.messageInput);
          }}
        />

        <InspectorPanel
          inspector={demo.inspector}
          retrievalMode={demo.retrievalMode}
          goalAligned={demo.goalAligned}
          workingCaughtUp={demo.workingCaughtUp}
          stableCaughtUp={demo.stableCaughtUp}
        />
      </main>
    </div>
  );
}
