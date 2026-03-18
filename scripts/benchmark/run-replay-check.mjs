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
  return value.filter((item) => typeof item === "string");
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

function buildStateDiff(baselineState, rebuiltState) {
  const baselineStable = baselineState?.stableFacts ?? {};
  const rebuiltStable = rebuiltState?.stableFacts ?? {};
  const baselineWorking = baselineState?.workingNotes ?? {};
  const rebuiltWorking = rebuiltState?.workingNotes ?? {};

  return {
    goal: diffScalar(baselineStable.goal ?? null, rebuiltStable.goal ?? null),
    constraints: diffStringLists(baselineStable.constraints, rebuiltStable.constraints),
    decisions: diffStringLists(baselineStable.decisions, rebuiltStable.decisions),
    todos: diffStringLists(baselineState?.todos, rebuiltState?.todos),
    volatileContext: diffStringLists(baselineState?.volatileContext, rebuiltState?.volatileContext),
    evidenceRefs: diffStringLists(baselineState?.evidenceRefs, rebuiltState?.evidenceRefs),
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
    mismatchedCategories: diffSummary.mismatchedCategories
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
    "",
    "## Category Diff",
    "",
    ...Object.entries(report.diff).flatMap(([key, value]) => {
      const lines = [`### ${key}`, "", `- Match: ${value.match ? "yes" : "no"}`];
      if ("missingFromReplay" in value) {
        lines.push(`- Missing from replay: ${value.missingFromReplay.length > 0 ? value.missingFromReplay.join(" | ") : "none"}`);
        lines.push(`- Added in replay: ${value.addedInReplay.length > 0 ? value.addedInReplay.join(" | ") : "none"}`);
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
