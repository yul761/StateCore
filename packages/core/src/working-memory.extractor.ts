export interface WorkingMemoryState {
  currentGoal?: string;
  activeConstraints: string[];
  recentDecisions: string[];
  progressSummary?: string;
  openQuestions: string[];
  taskFrame?: string;
  sourceEventIds: string[];
}

export interface WorkingMemoryEventLike {
  id: string;
  type: "stream" | "document";
  key?: string | null;
  content: string;
  createdAt: Date;
  role?: "user" | "assistant" | "system";
}

export interface WorkingMemoryExtractorOptions {
  maxItemsPerField?: number;
}

function uniq(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function normalizeContent(content: string) {
  if (content.includes("\n")) {
    return content.replace(/\r\n/g, "\n");
  }
  if (content.includes("\\n")) {
    return content.replace(/\\n/g, "\n");
  }
  return content;
}

function splitContentLines(content: string) {
  return normalizeContent(content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeLineValue(line: string, prefix: RegExp) {
  return line.replace(prefix, "").trim();
}

function extractGoalFromContent(content: string) {
  const lines = splitContentLines(content);
  for (const line of lines) {
    if (/^goal\s*:/i.test(line)) {
      return normalizeLineValue(line, /^goal\s*:/i);
    }
  }
  return null;
}

function extractConstraintsFromContent(content: string) {
  const lines = splitContentLines(content);
  const constraints = [];
  for (const line of lines) {
    if (/^constraint\s*:/i.test(line)) {
      constraints.push(normalizeLineValue(line, /^constraint\s*:/i));
      continue;
    }
    if (/^constraint reminder\s*:/i.test(line)) {
      constraints.push(normalizeLineValue(line, /^constraint reminder\s*:/i));
    }
  }
  return constraints;
}

function extractQuestionsFromContent(content: string) {
  const lines = splitContentLines(content);
  return lines
    .filter((line) => /^question\s*:/i.test(line) || /^open question\s*:/i.test(line) || line.endsWith("?"))
    .map((line) => normalizeLineValue(line, /^(question|open question)\s*:/i))
    .filter((line) => !/^would you like me to\b/i.test(line));
}

function extractDecisionsFromContent(content: string) {
  const lines = splitContentLines(content);
  const decisions = [];
  for (const line of lines) {
    if (/\b(decide|decision|we will|agreed)\b/i.test(line)) {
      decisions.push(line.trim());
    }
  }
  return decisions;
}

function extractProgressFromContent(content: string) {
  const lines = splitContentLines(content);
  for (const line of lines) {
    if (/^(status update|status)\s*:/i.test(line)) {
      return normalizeLineValue(line, /^(status update|status)\s*:/i);
    }
    if (/^(progress|progress summary)\s*:/i.test(line)) {
      return normalizeLineValue(line, /^(progress|progress summary)\s*:/i);
    }
  }
  return null;
}

function shouldUseForWorkingMemory(event: WorkingMemoryEventLike) {
  if (event.role === "assistant") {
    return false;
  }
  if (/^assistant reply:/i.test(event.content.trim())) {
    return false;
  }
  return true;
}

export function selectWorkingMemoryEvents(
  events: WorkingMemoryEventLike[],
  maxEvents: number
) {
  const cappedMaxEvents = Math.max(1, maxEvents);
  const ordered = [...events]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .filter(shouldUseForWorkingMemory);
  const recent = ordered.slice(-cappedMaxEvents);
  const selected = new Map(recent.map((event) => [event.id, event]));

  const latestGoalEvent = [...ordered]
    .reverse()
    .find((event) => extractGoalFromContent(event.content));

  if (latestGoalEvent) {
    selected.set(latestGoalEvent.id, latestGoalEvent);
  }

  return [...selected.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function extractWorkingMemoryState(
  events: WorkingMemoryEventLike[],
  options?: WorkingMemoryExtractorOptions
): WorkingMemoryState {
  const maxItems = Math.max(1, options?.maxItemsPerField ?? 5);
  const ordered = selectWorkingMemoryEvents(events, events.length);
  const reversed = [...ordered].reverse();

  let currentGoal: string | undefined;
  const constraints = [];
  const decisions = [];
  const openQuestions = [];
  const progress = [];
  const sourceEventIds = [];

  for (const event of ordered) {
    sourceEventIds.push(event.id);
    constraints.push(...extractConstraintsFromContent(event.content));
    openQuestions.push(...extractQuestionsFromContent(event.content));
    decisions.push(...extractDecisionsFromContent(event.content));
    const progressEntry = extractProgressFromContent(event.content);
    if (progressEntry) progress.push(progressEntry);
  }

  for (const event of reversed) {
    const goal = extractGoalFromContent(event.content);
    if (goal) {
      currentGoal = goal;
      break;
    }
  }

  const dedupedConstraints = uniq(constraints).slice(-maxItems);
  const dedupedDecisions = uniq(decisions).slice(-maxItems);
  const dedupedQuestions = uniq(openQuestions).slice(-maxItems);
  const dedupedProgress = uniq(progress).slice(-2);

  const fallbackTaskFrame = currentGoal
    || dedupedProgress[dedupedProgress.length - 1]
    || dedupedDecisions[dedupedDecisions.length - 1]
    || dedupedConstraints[0]
    || undefined;

  return {
    currentGoal,
    activeConstraints: dedupedConstraints,
    recentDecisions: dedupedDecisions,
    progressSummary: dedupedProgress.length ? dedupedProgress.join(" | ") : undefined,
    openQuestions: dedupedQuestions,
    taskFrame: fallbackTaskFrame,
    sourceEventIds: uniq(sourceEventIds).slice(-Math.max(maxItems * 2, 10))
  };
}
