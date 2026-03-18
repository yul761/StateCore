#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { fileURLToPath } from "url";

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    process.env[key] = value;
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnvFile(path.join(root, ".env"));

const cfg = {
  apiBaseUrl: process.env.API_BASE_URL || "http://localhost:3000",
  userId: process.env.REPLAY_USER_ID || "replay-user",
  timeoutMs: Number(process.env.REPLAY_TIMEOUT_MS || 180000),
  fixture: process.env.REPLAY_FIXTURE || "benchmark-fixtures/basic.json",
  outputDir: process.env.REPLAY_OUTPUT_DIR || "benchmark-results"
};

const headers = { "Content-Type": "application/json", "x-user-id": cfg.userId };

function msNow() {
  return new Date().toISOString();
}

async function apiFetch(method, endpoint, body) {
  const t0 = performance.now();
  const response = await fetch(`${cfg.apiBaseUrl}${endpoint}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    json,
    latencyMs: performance.now() - t0
  };
}

function loadFixture(fixturePath) {
  const fullPath = path.isAbsolute(fixturePath) ? fixturePath : path.join(root, fixturePath);
  const raw = readFileSync(fullPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.events)) throw new Error("invalid_fixture: missing events array");
  return { events: parsed.events, source: fullPath };
}

async function waitForNewDigest(scopeId, previousCount, rebuildGroupId) {
  const start = Date.now();
  while (Date.now() - start <= cfg.timeoutMs) {
    const suffix = rebuildGroupId ? `&rebuildGroupId=${encodeURIComponent(rebuildGroupId)}` : "";
    const result = await apiFetch("GET", `/memory/digests?scopeId=${scopeId}&limit=20${suffix}`);
    if (!result.ok) return { ok: false, error: `digest_list_failed:${result.status}` };
    const items = result.json.items || [];
    if (items.length > previousCount) return { ok: true, items };
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return { ok: false, error: "digest_timeout" };
}

async function waitForStateHistory(scopeId, rebuildGroupId) {
  const start = Date.now();
  let stableRepeats = 0;
  let lastCount = -1;
  while (Date.now() - start <= cfg.timeoutMs) {
    const result = await apiFetch(
      "GET",
      `/memory/state/history?scopeId=${scopeId}&limit=50&rebuildGroupId=${encodeURIComponent(rebuildGroupId)}`
    );
    if (!result.ok) return { ok: false, error: `state_history_failed:${result.status}` };
    const items = result.json.items || [];
    if (items.length > 0) {
      if (items.length === lastCount) {
        stableRepeats += 1;
      } else {
        stableRepeats = 0;
      }
      lastCount = items.length;
      if (stableRepeats >= 1) {
        return { ok: true, items };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return { ok: false, error: "state_history_timeout" };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonicalize);
    if (items.every((item) => typeof item === "string")) {
      return [...items].sort();
    }
    return items;
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function toStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const typed = item;
        return [typed.sourceType, typed.id, typed.key, typed.kind].filter(Boolean).join(":").trim();
      }
      return "";
    })
    .filter(Boolean);
}

function diffStringLists(before, after) {
  const baseline = [...new Set(toStringList(before))].sort();
  const rebuilt = [...new Set(toStringList(after))].sort();
  const baselineSet = new Set(baseline);
  const rebuiltSet = new Set(rebuilt);
  return {
    match: JSON.stringify(baseline) === JSON.stringify(rebuilt),
    missingFromReplay: baseline.filter((item) => !rebuiltSet.has(item)),
    addedInReplay: rebuilt.filter((item) => !baselineSet.has(item)),
    baseline,
    rebuilt
  };
}

function diffScalar(before, after) {
  return {
    match: before === after,
    baseline: before ?? null,
    rebuilt: after ?? null
  };
}

function flattenValueProvenance(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const value = typeof entry.value === "string" ? entry.value.trim() : "";
      const refs = toStringList(entry.refs);
      if (!value) return [];
      return [`${value}<=${refs.sort().join("|")}`];
    })
    .filter(Boolean);
}

function flattenGoalProvenance(refs) {
  const normalized = toStringList(refs);
  return normalized.length ? [`goal<=${normalized.sort().join("|")}`] : [];
}

function flattenConfidenceList(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const value = typeof entry.value === "string" ? entry.value.trim() : "";
      const score = typeof entry.score === "number" ? entry.score : null;
      if (!value || score === null) return [];
      return [`${value}<=${score}`];
    })
    .filter(Boolean);
}

function flattenRecentChanges(changes) {
  if (!Array.isArray(changes)) return [];
  return changes
    .map((change) => {
      if (!change || typeof change !== "object") return "";
      const evidence = toStringList(change.evidence ? [change.evidence] : []);
      const field = typeof change.field === "string" ? change.field : "";
      const action = typeof change.action === "string" ? change.action : "";
      const value = typeof change.value === "string" ? change.value.trim() : "";
      if (!field || !action || !value) return "";
      return `${field}:${action}:${value}${evidence.length ? `<=${evidence.join("|")}` : ""}`;
    })
    .filter(Boolean);
}

function summarizeTransitionTaxonomy(changes) {
  const counts = {};
  if (!Array.isArray(changes)) return counts;
  for (const change of changes) {
    if (!change || typeof change !== "object") continue;
    const field = typeof change.field === "string" ? change.field.trim() : "";
    const action = typeof change.action === "string" ? change.action.trim() : "";
    if (!field || !action) continue;
    const key = `${field}:${action}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function diffTransitionTaxonomy(beforeChanges, afterChanges) {
  const baseline = summarizeTransitionTaxonomy(beforeChanges);
  const rebuilt = summarizeTransitionTaxonomy(afterChanges);
  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(rebuilt)])].sort();
  const mismatchedKeys = keys.filter((key) => (baseline[key] || 0) !== (rebuilt[key] || 0));
  const matchedKeys = keys.filter((key) => !mismatchedKeys.includes(key));
  return {
    match: mismatchedKeys.length === 0,
    baseline,
    rebuilt,
    matchedKeys,
    mismatchedKeys,
    mismatchRate: Number((mismatchedKeys.length / Math.max(1, keys.length)).toFixed(3))
  };
}

function buildStateDiff(baselineState, rebuiltState) {
  const baselineStable = baselineState?.stableFacts ?? {};
  const rebuiltStable = rebuiltState?.stableFacts ?? {};
  const baselineWorking = baselineState?.workingNotes ?? {};
  const rebuiltWorking = rebuiltState?.workingNotes ?? {};
  const baselineProvenance = baselineState?.provenance ?? {};
  const rebuiltProvenance = rebuiltState?.provenance ?? {};
  const baselineConfidence = baselineState?.confidence ?? {};
  const rebuiltConfidence = rebuiltState?.confidence ?? {};

  return {
    goal: diffScalar(baselineStable.goal ?? null, rebuiltStable.goal ?? null),
    constraints: diffStringLists(baselineStable.constraints, rebuiltStable.constraints),
    decisions: diffStringLists(baselineStable.decisions, rebuiltStable.decisions),
    todos: diffStringLists(baselineState?.todos, rebuiltState?.todos),
    volatileContext: diffStringLists(baselineState?.volatileContext, rebuiltState?.volatileContext),
    evidenceRefs: diffStringLists(baselineState?.evidenceRefs, rebuiltState?.evidenceRefs),
    goalProvenance: diffStringLists(flattenGoalProvenance(baselineProvenance.goal), flattenGoalProvenance(rebuiltProvenance.goal)),
    constraintProvenance: diffStringLists(flattenValueProvenance(baselineProvenance.constraints), flattenValueProvenance(rebuiltProvenance.constraints)),
    decisionProvenance: diffStringLists(flattenValueProvenance(baselineProvenance.decisions), flattenValueProvenance(rebuiltProvenance.decisions)),
    todoProvenance: diffStringLists(flattenValueProvenance(baselineProvenance.todos), flattenValueProvenance(rebuiltProvenance.todos)),
    goalConfidence: diffScalar(baselineConfidence.goal ?? null, rebuiltConfidence.goal ?? null),
    constraintConfidence: diffStringLists(flattenConfidenceList(baselineConfidence.constraints), flattenConfidenceList(rebuiltConfidence.constraints)),
    decisionConfidence: diffStringLists(flattenConfidenceList(baselineConfidence.decisions), flattenConfidenceList(rebuiltConfidence.decisions)),
    todoConfidence: diffStringLists(flattenConfidenceList(baselineConfidence.todos), flattenConfidenceList(rebuiltConfidence.todos)),
    volatileContextConfidence: diffStringLists(flattenConfidenceList(baselineConfidence.volatileContext), flattenConfidenceList(rebuiltConfidence.volatileContext)),
    openQuestionConfidence: diffStringLists(flattenConfidenceList(baselineConfidence.openQuestions), flattenConfidenceList(rebuiltConfidence.openQuestions)),
    riskConfidence: diffStringLists(flattenConfidenceList(baselineConfidence.risks), flattenConfidenceList(rebuiltConfidence.risks)),
    recentChanges: diffStringLists(flattenRecentChanges(baselineState?.recentChanges), flattenRecentChanges(rebuiltState?.recentChanges)),
    transitionTaxonomy: diffTransitionTaxonomy(baselineState?.recentChanges, rebuiltState?.recentChanges),
    openQuestions: diffStringLists(baselineWorking.openQuestions, rebuiltWorking.openQuestions),
    risks: diffStringLists(baselineWorking.risks, rebuiltWorking.risks),
    workingContext: diffScalar(baselineWorking.context ?? null, rebuiltWorking.context ?? null)
  };
}

function summarizeStateDiff(diff) {
  const categories = Object.entries(diff).map(([key, value]) => ({
    key,
    match: value.match
  }));
  const mismatches = categories.filter((item) => !item.match).map((item) => item.key);
  return {
    stateMatch: mismatches.length === 0,
    matchedCategories: categories.filter((item) => item.match).map((item) => item.key),
    mismatchedCategories: mismatches
  };
}

async function run() {
  const startedAt = msNow();
  const report = {
    startedAt,
    config: cfg,
    summary: {}
  };

  const fixture = loadFixture(cfg.fixture);
  const scopeResp = await apiFetch("POST", "/scopes", { name: `Replay ${Date.now()}` });
  if (!scopeResp.ok || !scopeResp.json.id) {
    throw new Error(`failed_create_scope:${scopeResp.status}:${JSON.stringify(scopeResp.json)}`);
  }
  const scopeId = scopeResp.json.id;

  for (const event of fixture.events) {
    const res = await apiFetch("POST", "/memory/events", { scopeId, source: "sdk", ...event });
    if (!res.ok) throw new Error(`ingest_failed:${res.status}`);
  }

  const before = await apiFetch("GET", `/memory/digests?scopeId=${scopeId}&limit=5`);
  const beforeCount = (before.json.items || []).length;
  const enqueue = await apiFetch("POST", "/memory/digest", { scopeId });
  if (!enqueue.ok) throw new Error(`digest_enqueue_failed:${enqueue.status}`);
  const waited = await waitForNewDigest(scopeId, beforeCount, null);
  if (!waited.ok) throw new Error(waited.error);

  const baselineState = await apiFetch("GET", `/memory/state?scopeId=${scopeId}`);
  if (!baselineState.ok || !baselineState.json.state) {
    throw new Error(`baseline_state_failed:${baselineState.status}`);
  }

  const rebuild = await apiFetch("POST", "/memory/digest/rebuild", { scopeId, strategy: "full" });
  if (!rebuild.ok || !rebuild.json.rebuildGroupId) {
    throw new Error(`rebuild_enqueue_failed:${rebuild.status}`);
  }

  const rebuildHistory = await waitForStateHistory(scopeId, rebuild.json.rebuildGroupId);
  if (!rebuildHistory.ok) throw new Error(rebuildHistory.error);

  const latestRebuildState = rebuildHistory.items[0]?.state ?? null;
  const baselineCanonical = canonicalize(baselineState.json.state);
  const rebuildCanonical = canonicalize(latestRebuildState);
  const stateMatch = JSON.stringify(baselineCanonical) === JSON.stringify(rebuildCanonical);
  const stateDiff = buildStateDiff(baselineState.json.state, latestRebuildState);
  const diffSummary = summarizeStateDiff(stateDiff);

  report.endedAt = msNow();
  report.summary = {
    scopeId,
    rebuildGroupId: rebuild.json.rebuildGroupId,
    rebuildSnapshots: rebuildHistory.items.length,
    stateMatch,
    matchedCategories: diffSummary.matchedCategories,
    mismatchedCategories: diffSummary.mismatchedCategories,
    transitionTaxonomy: summarizeTransitionTaxonomy(baselineState.json.state?.recentChanges),
    transitionTaxonomyMatch: stateDiff.transitionTaxonomy?.match ?? false,
    transitionTaxonomyMismatchRate: stateDiff.transitionTaxonomy?.mismatchRate ?? 0
  };
  report.diff = stateDiff;

  const outDir = path.join(root, cfg.outputDir);
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `replay-${stamp}.json`);
  const mdPath = path.join(outDir, `replay-${stamp}.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, [
    "# Replay Check Report",
    "",
    `- Started: ${report.startedAt}`,
    `- Ended: ${report.endedAt}`,
    `- Fixture: ${cfg.fixture}`,
    `- Scope: ${scopeId}`,
    `- Rebuild group: ${rebuild.json.rebuildGroupId}`,
    "",
    "## Summary",
    "",
    `- Rebuild snapshots: ${report.summary.rebuildSnapshots}`,
    `- State match: ${report.summary.stateMatch ? "yes" : "no"}`,
    `- Matched categories: ${report.summary.matchedCategories.length > 0 ? report.summary.matchedCategories.join(", ") : "none"}`,
    `- Mismatched categories: ${report.summary.mismatchedCategories.length > 0 ? report.summary.mismatchedCategories.join(", ") : "none"}`,
    `- Transition taxonomy match: ${report.summary.transitionTaxonomyMatch ? "yes" : "no"} (${report.summary.transitionTaxonomyMismatchRate} mismatch rate)`,
    `- Baseline transition taxonomy: ${Object.keys(report.summary.transitionTaxonomy || {}).length > 0 ? Object.entries(report.summary.transitionTaxonomy).map(([name, count]) => `${name}=${count}`).join(", ") : "none"}`,
    "",
    "## Category Diff",
    "",
    ...Object.entries(report.diff).flatMap(([key, value]) => {
      const lines = [`### ${key}`, "", `- Match: ${value.match ? "yes" : "no"}`];
      if ("missingFromReplay" in value) {
        lines.push(`- Missing from replay: ${value.missingFromReplay.length > 0 ? value.missingFromReplay.join(" | ") : "none"}`);
        lines.push(`- Added in replay: ${value.addedInReplay.length > 0 ? value.addedInReplay.join(" | ") : "none"}`);
      } else if ("mismatchedKeys" in value) {
        lines.push(`- Matched transitions: ${value.matchedKeys.length > 0 ? value.matchedKeys.join(" | ") : "none"}`);
        lines.push(`- Mismatched transitions: ${value.mismatchedKeys.length > 0 ? value.mismatchedKeys.join(" | ") : "none"}`);
        lines.push(`- Baseline taxonomy: ${Object.keys(value.baseline || {}).length ? Object.entries(value.baseline).map(([name, count]) => `${name}=${count}`).join(" | ") : "none"}`);
        lines.push(`- Replay taxonomy: ${Object.keys(value.rebuilt || {}).length ? Object.entries(value.rebuilt).map(([name, count]) => `${name}=${count}`).join(" | ") : "none"}`);
      } else {
        lines.push(`- Baseline: ${value.baseline ?? "null"}`);
        lines.push(`- Rebuilt: ${value.rebuilt ?? "null"}`);
      }
      lines.push("");
      return lines;
    }),
    "",
    `JSON source: ${path.basename(jsonPath)}`
  ].join("\n"));

  // eslint-disable-next-line no-console
  console.log(`Replay check complete. State match: ${stateMatch ? "yes" : "no"}`);
  // eslint-disable-next-line no-console
  console.log(`Report: ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`Report: ${mdPath}`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Replay check failed:", err.message || err);
  process.exit(1);
});
