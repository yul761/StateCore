import { useEffect, useRef, useState } from "react";

import type { getDemoConfig } from "./config";
import { activateScopeRemote, createScopeRemote, fetchHealth, fetchInspectorBundle, fetchScopesAndActive, sendRuntimeTurn } from "./api";
import {
  cloneView,
  createInitialPipelineState,
  diffViews,
  formatClockTime,
  type DemoHistoryEntry,
  type HealthShape,
  type InspectorBundle,
  type PipelineState,
  type RuntimeSnapshot,
  type RuntimeTurnShape,
  type ScopeSummary,
  type StoredDiff,
  type TimelineEntry,
  type StableStateOutputShape,
  type WorkingMemoryOutputShape,
} from "./lib";
import { getOrCreateGuestUserId, latestAssistantMeta, readDiff, readHistory, readTimeline, resetGuestUserId, writeDiff, writeHistory, writeTimeline } from "./storage";
import { buildDemoViewModel } from "./view-model";

type DemoConfig = ReturnType<typeof getDemoConfig>;

export function useDemoRuntime(config: DemoConfig) {
  const lifecycleTokenRef = useRef(0);
  const activeScopeIdRef = useRef<string | null>(null);
  const guestUserIdRef = useRef<string>(getOrCreateGuestUserId());
  const [guestUserId, setGuestUserId] = useState<string>(guestUserIdRef.current);

  const [scopesCache, setScopesCache] = useState<ScopeSummary[]>([]);
  const [activeScopeId, setActiveScopeId] = useState<string | null>(null);
  const [scopeName, setScopeName] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [health, setHealth] = useState<HealthShape | null>(null);
  const [history, setHistory] = useState<DemoHistoryEntry[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [diff, setDiff] = useState<StoredDiff>({ working: [], stable: [] });
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<RuntimeSnapshot>({
    answerMode: null,
    retrievalMode: null
  });
  const [inspector, setInspector] = useState<InspectorBundle>({
    working: null,
    stable: null,
    fast: null,
    layer: null
  });
  const [lastInspectorSnapshots, setLastInspectorSnapshots] = useState<{
    working: WorkingMemoryOutputShape["view"] | null;
    stable: StableStateOutputShape["view"] | null;
  }>({
    working: null,
    stable: null
  });
  const [pipeline, setPipeline] = useState<PipelineState>(createInitialPipelineState());

  useEffect(() => {
    activeScopeIdRef.current = activeScopeId;
  }, [activeScopeId]);

  function syncLocalScopeState(scopeId: string | null) {
    const nextHistory = readHistory(scopeId);
    const nextTimeline = readTimeline(scopeId);
    const nextDiff = readDiff(scopeId);
    const latestMeta = latestAssistantMeta(scopeId);

    setHistory(nextHistory);
    setTimeline(nextTimeline);
    setDiff(nextDiff);
    setRuntimeSnapshot({
      answerMode: latestMeta?.answerMode || null,
      retrievalMode: latestMeta?.retrievalPlan?.mode || null
    });
  }

  function writeHistoryState(scopeId: string | null, items: DemoHistoryEntry[]) {
    writeHistory(scopeId, items);
    if (scopeId === activeScopeIdRef.current) {
      setHistory(items);
    }
  }

  function writeTimelineState(scopeId: string | null, items: TimelineEntry[]) {
    writeTimeline(scopeId, items);
    if (scopeId === activeScopeIdRef.current) {
      setTimeline(items);
    }
  }

  function writeDiffState(scopeId: string | null, value: StoredDiff) {
    writeDiff(scopeId, value);
    if (scopeId === activeScopeIdRef.current) {
      setDiff(value);
    }
  }

  function pushTimeline(scopeId: string | null, title: string, detail: string) {
    const nextItems = [
      {
        title,
        detail,
        time: formatClockTime()
      },
      ...readTimeline(scopeId)
    ].slice(0, 20);
    writeTimelineState(scopeId, nextItems);
  }

  function resetTimeline(scopeId: string | null, message: string) {
    const nextItems: TimelineEntry[] = [
      {
        title: "User Turn Started",
        detail: `Message queued for the three-layer runtime: ${message}`,
        time: formatClockTime()
      }
    ];
    writeTimelineState(scopeId, nextItems);
  }

  function setPipelineStage(stage: keyof PipelineState, status: PipelineState[keyof PipelineState]["status"], label: string, detail: string) {
    setPipeline((current) => ({
      ...current,
      [stage]: { status, label, detail }
    }));
  }

  function resetPipeline() {
    setPipeline(createInitialPipelineState());
  }

  async function loadHealth() {
    try {
      setHealth(await fetchHealth(config, guestUserIdRef.current));
    } catch (error) {
      setHealth({
        status: String((error as Error).message || error)
      });
    }
  }

  async function loadInspector(scopeId = activeScopeIdRef.current, message = "What is the current goal?") {
    if (!scopeId) {
      const emptyBundle: InspectorBundle = {
        working: null,
        stable: null,
        fast: null,
        layer: null
      };
      setInspector(emptyBundle);
      setLastInspectorSnapshots({ working: null, stable: null });
      return emptyBundle;
    }

      const nextBundle = await fetchInspectorBundle(config, guestUserIdRef.current, scopeId, message);
    if (scopeId === activeScopeIdRef.current) {
      setInspector(nextBundle);
      setLastInspectorSnapshots({
        working: cloneView(nextBundle.working?.view || null),
        stable: cloneView(nextBundle.stable?.view || null)
      });
    }
    return nextBundle;
  }

  async function loadScopes() {
    const { scopesResponse, state } = await fetchScopesAndActive(config, guestUserIdRef.current);
    setScopesCache(scopesResponse.items);
    const nextActiveScopeId = state.activeScopeId || activeScopeIdRef.current || scopesResponse.items[0]?.id || null;
    setActiveScopeId(nextActiveScopeId);
    syncLocalScopeState(nextActiveScopeId);
    return nextActiveScopeId;
  }

  async function activateScope(scopeId: string) {
    lifecycleTokenRef.current += 1;
    const result = await activateScopeRemote(config, guestUserIdRef.current, scopeId);
    setActiveScopeId(result.activeScopeId);
    syncLocalScopeState(result.activeScopeId);
    resetPipeline();
    await loadInspector(result.activeScopeId);
    return result.activeScopeId;
  }

  async function monitorLifecycle(scopeId: string, message: string, runtimeResult: RuntimeTurnShape) {
    const token = ++lifecycleTokenRef.current;
    const digestTriggered = Boolean(runtimeResult.digestTriggered);
    const deadline = Date.now() + 30_000;
    let lastWorkingVersion: number | null = null;
    let lastStableVersion: string | null = null;

    while (token === lifecycleTokenRef.current && Date.now() < deadline) {
      const nextBundle = await loadInspector(scopeId, message);
      const layer = nextBundle.layer;
      const workingCaughtUp = Boolean(layer?.freshness?.workingMemoryCaughtUp);
      const stableCaughtUp = Boolean(layer?.freshness?.stableStateCaughtUp);
      const hasStableSnapshot = Boolean(nextBundle.stable?.digestId || layer?.stableStateVersion);

      if (workingCaughtUp) {
        setPipelineStage(
          "working",
          "complete",
          "Caught Up",
          `Version ${layer?.workingMemoryVersion ?? "none"} is synced with the latest event stream.`
        );
        if (lastWorkingVersion !== (layer?.workingMemoryVersion ?? null)) {
          pushTimeline(scopeId, "Working Memory Updated", `Working Memory caught up at version ${layer?.workingMemoryVersion ?? "none"}.`);
        }
      } else {
        setPipelineStage(
          "working",
          "pending",
          "Updating",
          `Background update in progress. Lag: ${layer?.freshness?.workingMemoryLagMs ?? "unknown"} ms.`
        );
      }

      if (digestTriggered) {
        if (stableCaughtUp) {
          setPipelineStage(
            "stable",
            "complete",
            "Committed",
            `Stable state ${layer?.stableStateVersion ?? "none"} is caught up to the latest event stream.`
          );
          if (lastStableVersion !== (layer?.stableStateVersion ?? null)) {
            pushTimeline(scopeId, "State Layer Committed", `Authoritative state caught up at snapshot ${layer?.stableStateVersion ?? "none"}.`);
          }
        } else {
          setPipelineStage(
            "stable",
            "pending",
            "Digesting",
            `Authoritative state is consolidating in the background. Lag: ${layer?.freshness?.stableStateLagMs ?? "unknown"} ms.`
          );
        }
      } else {
        setPipelineStage(
          "stable",
          hasStableSnapshot && stableCaughtUp ? "complete" : "idle",
          hasStableSnapshot && stableCaughtUp ? "Ready" : "No Snapshot",
          hasStableSnapshot
            ? "No digest triggered on this turn. Stable state remains on the latest committed snapshot."
            : "No digest triggered on this turn, and there is no committed stable snapshot yet."
        );
      }

      if (workingCaughtUp && (!digestTriggered || stableCaughtUp)) {
        return;
      }

      lastWorkingVersion = layer?.workingMemoryVersion ?? null;
      lastStableVersion = layer?.stableStateVersion ?? null;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (token === lifecycleTokenRef.current) {
      setPipelineStage("working", "warning", "Timed Out", "Working Memory did not report caught-up status within the polling window.");
      pushTimeline(scopeId, "Working Memory Timeout", "Working Memory did not report caught-up status within the polling window.");
      if (runtimeResult.digestTriggered) {
        setPipelineStage("stable", "warning", "Timed Out", "State Layer did not report caught-up status within the polling window.");
        pushTimeline(scopeId, "State Layer Timeout", "State Layer did not report caught-up status within the polling window.");
      }
    }
  }

  useEffect(() => {
    void (async () => {
      await loadHealth();
      const nextScopeId = await loadScopes();
      await loadInspector(nextScopeId);
    })();
  }, []);

  const {
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
  } = buildDemoViewModel({
    scopesCache,
    activeScopeId,
    inspector,
    runtimeSnapshot,
    health,
    diff
  });

  async function createScope() {
    const name = scopeName.trim();
    if (!name) return;

    const scope = await createScopeRemote(config, guestUserIdRef.current, name);
    await activateScope(scope.id);
    await loadScopes();
    setScopeName("");
  }

  async function selectScope(scopeId: string) {
    if (!scopeId || scopeId === activeScopeId) return;
    await activateScope(scopeId);
  }

  async function sendMessage(message: string) {
    if (!activeScopeId) return;
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    lifecycleTokenRef.current += 1;
    const previousWorkingVersion = inspector.layer?.workingMemoryVersion ?? null;
    const previousStableVersion = inspector.layer?.stableStateVersion ?? null;
    const previousWorkingView = cloneView(lastInspectorSnapshots.working || null);
    const previousStableView = cloneView(lastInspectorSnapshots.stable || null);

    resetTimeline(activeScopeId, trimmedMessage);

    const nextUserHistory = [...readHistory(activeScopeId), { role: "user", content: trimmedMessage } as DemoHistoryEntry];
    writeHistoryState(activeScopeId, nextUserHistory);
    setMessageInput("");

    setPipelineStage("fast", "running", "Responding", "Fast Layer is building prompt context and generating the synchronous reply.");
    setPipelineStage("working", "pending", "Queued", "Working Memory will refresh after the current answer returns.");
    setPipelineStage("stable", "idle", "Waiting", "State Layer will only run if this turn triggers digest consolidation.");
    pushTimeline(
      activeScopeId,
      "Fast Layer Started",
      `Fast Layer is answering from the current prompt context. Previous versions: working=${previousWorkingVersion ?? "none"}, stable=${previousStableVersion ?? "none"}.`
    );

    try {
      const result = await sendRuntimeTurn(config, guestUserIdRef.current, activeScopeId, trimmedMessage);

      setRuntimeSnapshot({
        answerMode: result.answerMode || null,
        retrievalMode: result.retrievalPlan?.mode || null
      });

      setPipelineStage(
        "fast",
        "complete",
        result.answerMode === "direct_state_fast_path" ? "Direct" : "LLM",
        `Answered on the Fast Layer via ${result.answerMode || "unknown mode"} with ${result.retrievalPlan?.mode || "unknown"} retrieval.`
      );

      pushTimeline(
        activeScopeId,
        "Fast Layer Answered",
        `Answer mode: ${result.answerMode || "unknown"}. Retrieval: ${result.retrievalPlan?.mode || "unknown"}. Versions after reply: working=${result.workingMemoryVersion ?? "none"}, stable=${result.stableStateVersion ?? "none"}.`
      );

      const nextAssistantHistory = [
        ...nextUserHistory,
        {
          role: "assistant",
          content: result.answer,
          meta: {
            answerMode: result.answerMode,
            retrievalPlan: result.retrievalPlan,
            workingMemoryVersion: result.workingMemoryVersion,
            stableStateVersion: result.stableStateVersion,
            layerAlignment: result.layerAlignment,
            warnings: result.warnings
          }
        } satisfies DemoHistoryEntry
      ];
      writeHistoryState(activeScopeId, nextAssistantHistory);

      const nextInspector = await loadInspector(activeScopeId, trimmedMessage);
      const nextWorkingView = cloneView(nextInspector.working?.view || null);
      const nextStableView = cloneView(nextInspector.stable?.view || null);

      writeDiffState(activeScopeId, {
        working: diffViews(previousWorkingView as Record<string, unknown> | null, nextWorkingView as Record<string, unknown> | null, {
          goal: "Goal",
          constraints: "Constraints",
          decisions: "Decisions",
          progressSummary: "Progress",
          openQuestions: "Open Questions",
          taskFrame: "Task Frame"
        }),
        stable: diffViews(previousStableView as Record<string, unknown> | null, nextStableView as Record<string, unknown> | null, {
          goal: "Goal",
          constraints: "Constraints",
          decisions: "Decisions",
          todos: "Todos",
          openQuestions: "Open Questions",
          risks: "Risks"
        })
      });

      pushTimeline(
        activeScopeId,
        "Inspector Refreshed",
        `Layer status now shows working=${nextInspector.layer?.workingMemoryVersion ?? "none"} and stable=${nextInspector.layer?.stableStateVersion ?? "none"}.`
      );

      if (!result.digestTriggered) {
        const hasStableSnapshot = Boolean(nextInspector.stable?.digestId || nextInspector.layer?.stableStateVersion);
        const stableCaughtUp = Boolean(nextInspector.layer?.freshness?.stableStateCaughtUp);
        setPipelineStage(
          "stable",
          hasStableSnapshot && stableCaughtUp ? "complete" : "idle",
          hasStableSnapshot && stableCaughtUp ? "Ready" : "No Snapshot",
          hasStableSnapshot
            ? "No digest triggered on this turn. Stable state remains on the latest committed snapshot."
            : "No digest triggered on this turn, and there is no committed stable snapshot yet."
        );
        pushTimeline(
          activeScopeId,
          "State Layer Not Triggered",
          "This turn did not enqueue a new State Layer digest. The UI is still showing the latest committed authoritative snapshot."
        );
      }

      void monitorLifecycle(activeScopeId, trimmedMessage, result);
    } catch (error) {
      const messageText = String((error as Error).message || error);
      setPipelineStage("fast", "warning", "Error", `Fast Layer request failed: ${messageText}`);
      setPipelineStage("working", "idle", "Idle", "No background update was confirmed for this failed turn.");
      setPipelineStage("stable", "idle", "Idle", "No digest ran because the turn failed.");
      pushTimeline(activeScopeId, "Fast Layer Error", `The runtime turn failed before the pipeline could complete: ${messageText}`);
      writeHistoryState(activeScopeId, [...nextUserHistory, { role: "assistant", content: `Error: ${messageText}` }]);
    }
  }

  async function refreshScopesAndInspector() {
    const scopeId = await loadScopes();
    await loadInspector(scopeId);
  }

  async function resetGuestSession() {
    lifecycleTokenRef.current += 1;
    const nextGuestUserId = resetGuestUserId();
    guestUserIdRef.current = nextGuestUserId;
    setGuestUserId(nextGuestUserId);

    setScopesCache([]);
    setActiveScopeId(null);
    activeScopeIdRef.current = null;
    setScopeName("");
    setMessageInput("");
    setHistory([]);
    setTimeline([]);
    setDiff({ working: [], stable: [] });
    setRuntimeSnapshot({
      answerMode: null,
      retrievalMode: null
    });
    setInspector({
      working: null,
      stable: null,
      fast: null,
      layer: null
    });
    setLastInspectorSnapshots({
      working: null,
      stable: null
    });
    resetPipeline();

    await loadHealth();
    const nextScopeId = await loadScopes();
    await loadInspector(nextScopeId);
  }

  return {
    scopeName,
    setScopeName,
    guestUserId,
    activeScope,
    activeScopeId,
    scopeCards,
    createScope,
    selectScope,
    refreshScopesAndInspector,
    resetGuestSession,
    health,
    healthSummarySections,
    turnOutcomeHeadline,
    turnOutcomeDetail,
    turnOutcomeFacts,
    whyAnswerHeadline,
    whyAnswerDetail,
    whyAnswerFacts,
    pipeline,
    timeline,
    diff,
    goal,
    answerMode,
    retrievalMode,
    workingVersion,
    stableVersion,
    workingCaughtUp,
    stableCaughtUp,
    goalAligned,
    history,
    latestMeta,
    messageInput,
    setMessageInput,
    sendMessage,
    inspector
  };
}
