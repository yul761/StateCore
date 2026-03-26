export type HealthShape = {
  status: string;
  featureLlm?: boolean;
  model?: {
    runtimeModel?: string;
    chatModel?: string;
    runtimeReasoningEffort?: string;
    runtimeMaxOutputTokens?: number;
  };
};

export type RetrievalPlanShape = {
  mode?: "none" | "light" | "full" | string;
  reason?: string;
  limit?: number;
  query?: string;
  cacheHit?: boolean;
};

export type RuntimeTurnShape = {
  answer: string;
  answerMode?: "direct_state_fast_path" | "llm_fast_path";
  digestTriggered: boolean;
  workingMemoryVersion?: number | null;
  stableStateVersion?: string | null;
  usedFastLayerContextSummary?: string;
  retrievalPlan?: RetrievalPlanShape;
  layerAlignment?: {
    goalAligned: boolean;
    sharedConstraintCount: number;
    sharedDecisionCount: number;
    fastPathReady: boolean;
  };
  warnings?: string[];
  notes?: string[];
};

export type WorkingMemoryOutputShape = {
  version?: number | null;
  updatedAt?: string | null;
  view?: {
    goal?: string;
    constraints?: string[];
    decisions?: string[];
    progressSummary?: string;
    openQuestions?: string[];
    taskFrame?: string;
  };
};

export type StableStateOutputShape = {
  snapshotId?: string | null;
  createdAt?: string | null;
  view?: {
    goal?: string;
    constraints?: string[];
    decisions?: string[];
    todos?: string[];
    openQuestions?: string[];
    risks?: string[];
  };
};

export type FastLayerViewOutputShape = {
  fastLayerContext?: {
    summary?: string;
    recentTurns?: unknown[];
    retrievalSnippets?: unknown[];
  };
};

export type LayerStatusOutputShape = {
  workingMemoryVersion?: number | null;
  stableStateVersion?: string | null;
  workingMemoryView?: { goal?: string };
  stableStateView?: { goal?: string };
  retrievalPlan?: RetrievalPlanShape;
  layerAlignment?: {
    goalAligned: boolean;
    sharedConstraintCount: number;
    sharedDecisionCount: number;
    fastPathReady: boolean;
  };
  freshness?: {
    workingMemoryCaughtUp?: boolean;
    stableStateCaughtUp?: boolean;
    workingMemoryLagMs?: number;
    stableStateLagMs?: number;
  };
  warnings?: string[];
};

export type DemoHistoryEntry = {
  role: "user" | "assistant";
  content: string;
  meta?: {
    answerMode?: RuntimeTurnShape["answerMode"];
    retrievalPlan?: RuntimeTurnShape["retrievalPlan"];
    workingMemoryVersion?: RuntimeTurnShape["workingMemoryVersion"];
    stableStateVersion?: RuntimeTurnShape["stableStateVersion"];
    layerAlignment?: RuntimeTurnShape["layerAlignment"];
    warnings?: RuntimeTurnShape["warnings"];
  };
};

export type TimelineEntry = {
  title: string;
  detail: string;
  time: string;
};

export type DiffEntry = {
  field: string;
  detail: string;
};

export type StoredDiff = {
  working: DiffEntry[];
  stable: DiffEntry[];
};

export type PipelineStage = {
  status: "idle" | "running" | "pending" | "complete" | "warning";
  label: string;
  detail: string;
};

export type PipelineState = {
  fast: PipelineStage;
  working: PipelineStage;
  stable: PipelineStage;
};

export type RuntimeSnapshot = {
  answerMode: RuntimeTurnShape["answerMode"] | null;
  retrievalMode: RetrievalPlanShape["mode"] | null;
};

export type InspectorBundle = {
  working: WorkingMemoryOutputShape | null;
  stable: StableStateOutputShape | null;
  fast: FastLayerViewOutputShape | null;
  layer: LayerStatusOutputShape | null;
};

export type ScopeSummary = {
  id: string;
  name: string;
  goal: string | null;
  stage: string;
  createdAt: string;
};

export const USER_ID = "demo-web-user";

export function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function formatClockTime(value = new Date()) {
  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function cloneView<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function normalizeList(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function diffViews(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
  labelMap: Record<string, string>
) {
  const diffs: DiffEntry[] = [];
  for (const [key, label] of Object.entries(labelMap)) {
    const previousValue = previous?.[key];
    const nextValue = next?.[key];

    if (Array.isArray(previousValue) || Array.isArray(nextValue)) {
      const previousItems = normalizeList(previousValue);
      const nextItems = normalizeList(nextValue);
      const added = nextItems.filter((item) => !previousItems.includes(item));
      const removed = previousItems.filter((item) => !nextItems.includes(item));
      if (added.length || removed.length) {
        diffs.push({
          field: label,
          detail: [
            added.length ? `added: ${added.join(" | ")}` : null,
            removed.length ? `removed: ${removed.join(" | ")}` : null
          ]
            .filter(Boolean)
            .join(" ; ")
        });
      }
      continue;
    }

    const normalizedPrevious = previousValue ?? null;
    const normalizedNext = nextValue ?? null;
    if (normalizedPrevious !== normalizedNext) {
      diffs.push({
        field: label,
        detail: `from ${normalizedPrevious || "none"} -> ${normalizedNext || "none"}`
      });
    }
  }
  return diffs;
}

export function compactCountLabel(items: unknown[], singular: string, plural = `${singular}s`) {
  return `${items.length} ${items.length === 1 ? singular : plural}`;
}

export function createInitialPipelineState(): PipelineState {
  return {
    fast: { status: "idle", label: "Idle", detail: "Waiting for a turn." },
    working: { status: "idle", label: "Idle", detail: "No active turn." },
    stable: { status: "idle", label: "Idle", detail: "No active digest." }
  };
}

export async function apiFetch<T>(apiBaseUrl: string, route: string, method: string, body?: unknown) {
  const response = await fetch(`${apiBaseUrl}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": USER_ID
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!response.ok || (json && typeof json === "object" && "error" in (json as Record<string, unknown>))) {
    const payload = json as Record<string, unknown>;
    const message = String(payload.message || payload.error || `request_failed:${response.status}`);
    throw new Error(message);
  }

  return json as T;
}

export function createHealthSummarySections(health: HealthShape | null) {
  const fastLayerDetails = [
    health?.model?.runtimeReasoningEffort ? `reasoning ${health.model.runtimeReasoningEffort}` : null,
    health?.model?.runtimeMaxOutputTokens ? `max ${health.model.runtimeMaxOutputTokens} tokens` : null
  ].filter((value): value is string => Boolean(value));

  return [
    { label: "API", value: health?.status === "ok" ? "Healthy" : health?.status || "Unknown" },
    { label: "LLM", value: health?.featureLlm ? "Enabled" : "Disabled" },
    { label: "Runtime Model", value: health?.model?.runtimeModel || health?.model?.chatModel || null },
    {
      label: "Fast Layer",
      value: fastLayerDetails.length ? fastLayerDetails : null
    }
  ];
}
