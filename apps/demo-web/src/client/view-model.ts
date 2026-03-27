import { createHealthSummarySections, type HealthShape, type InspectorBundle, type RuntimeSnapshot, type ScopeSummary, type StoredDiff } from "./lib";
import { latestAssistantMeta, latestUserTurn, readHistory } from "./storage";

export function buildDemoViewModel(params: {
  scopesCache: ScopeSummary[];
  activeScopeId: string | null;
  inspector: InspectorBundle;
  runtimeSnapshot: RuntimeSnapshot;
  health: HealthShape | null;
  diff: StoredDiff;
}) {
  const { scopesCache, activeScopeId, inspector, runtimeSnapshot, health, diff } = params;

  const activeScope = scopesCache.find((scope) => scope.id === activeScopeId) || null;
  const latestMeta = latestAssistantMeta(activeScopeId);
  const goal = inspector.stable?.view?.goal || inspector.working?.view?.goal || "Create or select a scope to see the current goal and three-layer status.";
  const answerMode = runtimeSnapshot.answerMode || latestMeta?.answerMode || "no turns yet";
  const retrievalMode = runtimeSnapshot.retrievalMode || latestMeta?.retrievalPlan?.mode || inspector.layer?.retrievalPlan?.mode || "unknown";
  const workingVersion = inspector.layer?.workingMemoryVersion ?? "none";
  const stableVersion = inspector.layer?.stableStateVersion || "none";
  const workingCaughtUp = Boolean(inspector.layer?.freshness?.workingMemoryCaughtUp);
  const stableCaughtUp = Boolean(inspector.layer?.freshness?.stableStateCaughtUp);
  const hasStableSnapshot = Boolean(inspector.stable?.digestId || inspector.layer?.stableStateVersion);
  const goalAligned = inspector.layer?.layerAlignment?.goalAligned;

  const healthSummarySections = createHealthSummarySections(health);
  const whyAnswerHeadline =
    answerMode === "direct_state_fast_path"
      ? "The reply came straight from tracked state, not a slower free-form generation path."
      : "The reply used the Fast Layer LLM path because the turn needed fresh synthesis.";
  const whyAnswerDetail =
    answerMode === "direct_state_fast_path"
      ? `The Fast Layer recognized a state lookup around "${goal}" and answered directly from compiled memory views.`
      : `The runtime built a compact prompt around "${goal}" and used ${retrievalMode} retrieval to answer this turn.`;
  const whyAnswerFacts = [
    `Answer: ${answerMode}`,
    `Retrieval: ${retrievalMode}`,
    `Goal alignment: ${goalAligned === true ? "aligned" : goalAligned === false ? "drift" : "unknown"}`,
    `Working: ${workingCaughtUp ? "caught up" : "lagging"}`,
    `Stable: ${hasStableSnapshot ? (stableCaughtUp ? "caught up" : "pending") : "no snapshot"}`,
    `Warnings: ${inspector.layer?.warnings?.length || 0}`
  ];

  const turnOutcomeHeadline =
    answerMode === "direct_state_fast_path"
      ? "The last turn used the direct fast path and returned before any heavy background work."
      : "The last turn used the Fast Layer LLM path and then handed off background memory updates.";
  const turnOutcomeDetail = `${diff.working.length ? `Working Memory changed in ${diff.working.length} field${diff.working.length === 1 ? "" : "s"}.` : "Working Memory did not materially change."} ${
    diff.stable.length
      ? `State Layer changed in ${diff.stable.length} field${diff.stable.length === 1 ? "" : "s"}.`
      : "State Layer did not record a new visible diff on the last refresh."
  } ${hasStableSnapshot
    ? (stableCaughtUp ? "The authoritative state is caught up." : "The authoritative state is still waiting on the latest digest boundary.")
    : "The authoritative state has not recorded a committed snapshot yet."}`;
  const turnOutcomeFacts = [
    `Answer: ${answerMode}`,
    `Retrieval: ${retrievalMode}`,
    `Working diff: ${diff.working.length}`,
    `Stable diff: ${diff.stable.length}`,
    `Working: ${workingCaughtUp ? "caught up" : "pending"}`,
    `Stable: ${hasStableSnapshot ? (stableCaughtUp ? "caught up" : "digesting") : "no snapshot"}`
  ];

  const scopeCards = scopesCache.map((scope) => {
    const scopeHistory = readHistory(scope.id);
    return {
      ...scope,
      messageCount: scopeHistory.length,
      latestTurn: latestUserTurn(scope.id)
    };
  });

  return {
    activeScope,
    latestMeta,
    goal,
    answerMode,
    retrievalMode,
    workingVersion,
    stableVersion,
    workingCaughtUp,
    stableCaughtUp,
    goalAligned,
    healthSummarySections,
    whyAnswerHeadline,
    whyAnswerDetail,
    whyAnswerFacts,
    turnOutcomeHeadline,
    turnOutcomeDetail,
    turnOutcomeFacts,
    scopeCards
  };
}
