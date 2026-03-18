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
  userId: process.env.DRIFT_USER_ID || "drift-user",
  runs: Number(process.env.DRIFT_RUNS || 50),
  timeoutMs: Number(process.env.DRIFT_TIMEOUT_MS || 180000),
  fixture: process.env.DRIFT_FIXTURE || "benchmark-fixtures/decision-heavy.json",
  outputDir: process.env.DRIFT_OUTPUT_DIR || "benchmark-results"
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
  if (!Array.isArray(parsed.events)) {
    throw new Error("invalid_fixture: missing events array");
  }
  return {
    events: parsed.events,
    gold: parsed.gold ?? null,
    source: fullPath
  };
}

function normalizeText(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseGoldFacts(events) {
  const goal = [];
  const constraints = [];
  const decisions = [];
  const todos = [];

  for (const event of events) {
    const text = String(event.content || "");
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^goal\s*:/i.test(line)) goal.push(line.replace(/^goal\s*:\s*/i, "").trim());
      if (/^constraint\s*:/i.test(line)) constraints.push(line.replace(/^constraint\s*:\s*/i, "").trim());
      if (/^todo\s*:/i.test(line)) todos.push(line.replace(/^todo\s*:\s*/i, "").trim());
    }
    if (/\b(decide|decision|we will|agreed)\b/i.test(text)) {
      decisions.push(text.trim());
    }
  }

  const uniq = (items) => [...new Set(items.filter(Boolean))];
  return {
    goal: uniq(goal),
    constraints: uniq(constraints),
    decisions: uniq(decisions),
    todos: uniq(todos)
  };
}

function loadGoldFacts(fixture) {
  if (fixture.gold && typeof fixture.gold === "object") {
    return {
      goal: Array.isArray(fixture.gold.goal) ? fixture.gold.goal : [],
      constraints: Array.isArray(fixture.gold.constraints) ? fixture.gold.constraints : [],
      decisions: Array.isArray(fixture.gold.decisions) ? fixture.gold.decisions : [],
      todos: Array.isArray(fixture.gold.todos) ? fixture.gold.todos : [],
      contradictions: fixture.gold.contradictions && typeof fixture.gold.contradictions === "object"
        ? {
            goal: Array.isArray(fixture.gold.contradictions.goal) ? fixture.gold.contradictions.goal : [],
            constraints: Array.isArray(fixture.gold.contradictions.constraints) ? fixture.gold.contradictions.constraints : [],
            decisions: Array.isArray(fixture.gold.contradictions.decisions) ? fixture.gold.contradictions.decisions : [],
            todos: Array.isArray(fixture.gold.contradictions.todos) ? fixture.gold.contradictions.todos : []
          }
        : { goal: [], constraints: [], decisions: [], todos: [] }
    };
  }
  return {
    ...parseGoldFacts(fixture.events),
    contradictions: { goal: [], constraints: [], decisions: [], todos: [] }
  };
}

function factRecall(text, facts) {
  if (!facts.length) return 1;
  const normalized = normalizeText(text);
  const hits = facts.filter((f) => normalized.includes(normalizeText(f))).length;
  return hits / facts.length;
}

function driftRateFromRecall(recall) {
  return Number((1 - recall).toFixed(3));
}

function contradictionRate(text, contradictions) {
  if (!contradictions.length) return 0;
  const normalized = normalizeText(text);
  const hits = contradictions.filter((item) => normalized.includes(normalizeText(item))).length;
  return Number((hits / contradictions.length).toFixed(3));
}

function countMatches(text, facts) {
  const normalized = normalizeText(text);
  return facts.filter((item) => normalized.includes(normalizeText(item))).length;
}

function linearSlope(values) {
  const n = values.length;
  if (!n) return 0;
  const xs = values.map((_, i) => i + 1);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * values[i], 0);
  const sumX2 = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

async function waitForNewDigest(scopeId, previousCount) {
  const start = Date.now();
  while (Date.now() - start <= cfg.timeoutMs) {
    const result = await apiFetch("GET", `/memory/digests?scopeId=${scopeId}&limit=5`);
    if (!result.ok) return { ok: false, error: `digest_list_failed:${result.status}` };
    const items = result.json.items || [];
    if (items.length > previousCount) return { ok: true, digest: items[0] };
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return { ok: false, error: "digest_timeout" };
}

async function run() {
  const startedAt = msNow();
  const report = {
    startedAt,
    config: cfg,
    metrics: [],
    summary: {}
  };

  const fixture = loadFixture(cfg.fixture);
  const gold = loadGoldFacts(fixture);

  const scopeResp = await apiFetch("POST", "/scopes", { name: `Drift ${Date.now()}` });
  if (!scopeResp.ok || !scopeResp.json.id) {
    throw new Error(`failed_create_scope:${scopeResp.status}:${JSON.stringify(scopeResp.json)}`);
  }
  const scopeId = scopeResp.json.id;

  // Ingest fixture events once
  for (const event of fixture.events) {
    const body = { scopeId, source: "sdk", ...event };
    const res = await apiFetch("POST", "/memory/events", body);
    if (!res.ok) throw new Error(`ingest_failed:${res.status}`);
  }

  let prevChanges = "";
  const recalls = [];
  const outDir = path.join(root, cfg.outputDir);
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `drift-${stamp}.json`);
  const mdPath = path.join(outDir, `drift-${stamp}.md`);

  function writeReport(finalize = false) {
    const successful = report.metrics.filter((m) => m.ok);
    const taxonomy = {
      goal: {
        omissionRuns: successful.filter((m) => (m.goalDriftRate ?? 0) > 0).length,
        contradictionRuns: successful.filter((m) => (m.goalContradictionRate ?? 0) > 0).length
      },
      constraint: {
        omissionRuns: successful.filter((m) => (m.constraintDriftRate ?? 0) > 0).length,
        contradictionRuns: successful.filter((m) => (m.constraintContradictionRate ?? 0) > 0).length
      },
      decision: {
        omissionRuns: successful.filter((m) => (m.decisionDriftRate ?? 0) > 0).length,
        contradictionRuns: successful.filter((m) => (m.decisionContradictionRate ?? 0) > 0).length
      },
      todo: {
        omissionRuns: successful.filter((m) => (m.todoDriftRate ?? 0) > 0).length,
        contradictionRuns: successful.filter((m) => (m.todoContradictionRate ?? 0) > 0).length
      }
    };

    report.summary = {
      runs: report.metrics.length,
      success: successful.length,
      avgRecall: Number((recalls.reduce((a, b) => a + b, 0) / Math.max(1, recalls.length)).toFixed(3)),
      goalDriftRate: Number(
        (
          successful
            .reduce((sum, m) => sum + (m.goalDriftRate ?? 0), 0) / Math.max(1, successful.length)
        ).toFixed(3)
      ),
      constraintDriftRate: Number(
        (
          successful
            .reduce((sum, m) => sum + (m.constraintDriftRate ?? 0), 0) / Math.max(1, successful.length)
        ).toFixed(3)
      ),
      decisionDriftRate: Number(
        (
          successful
            .reduce((sum, m) => sum + (m.decisionDriftRate ?? 0), 0) / Math.max(1, successful.length)
        ).toFixed(3)
      ),
      todoDriftRate: Number(
        (
          successful
            .reduce((sum, m) => sum + (m.todoDriftRate ?? 0), 0) / Math.max(1, successful.length)
        ).toFixed(3)
      ),
      goalContradictionRate: Number(
        (
          successful
            .reduce((sum, m) => sum + (m.goalContradictionRate ?? 0), 0) / Math.max(1, successful.length)
        ).toFixed(3)
      ),
      constraintContradictionRate: Number(
        (
          successful
            .reduce((sum, m) => sum + (m.constraintContradictionRate ?? 0), 0) / Math.max(1, successful.length)
        ).toFixed(3)
      ),
      decisionContradictionRate: Number(
        (
          successful
            .reduce((sum, m) => sum + (m.decisionContradictionRate ?? 0), 0) / Math.max(1, successful.length)
        ).toFixed(3)
      ),
      todoContradictionRate: Number(
        (
          successful
            .reduce((sum, m) => sum + (m.todoContradictionRate ?? 0), 0) / Math.max(1, successful.length)
        ).toFixed(3)
      ),
      recallSlope: Number(linearSlope(recalls).toFixed(6)),
      repeatedChangeRate: Number(
        (report.metrics.filter((m) => m.ok && m.repeatedChanges).length / Math.max(1, report.metrics.length)).toFixed(3)
      ),
      taxonomy,
      status: finalize ? "complete" : "in_progress"
    };

    writeFileSync(jsonPath, JSON.stringify(report, null, 2));

    const md = [
      "# Drift Report",
      "",
      `- Started: ${report.startedAt}`,
      `- Ended: ${report.endedAt || "(in progress)"}`,
      `- Fixture: ${cfg.fixture}`,
      `- Runs: ${cfg.runs}`,
      "",
      "## Summary",
      "",
      `- Status: ${report.summary.status}`,
      `- Success runs: ${report.summary.success}/${report.summary.runs}`,
      `- Avg recall: ${report.summary.avgRecall}`,
      `- Goal drift rate: ${report.summary.goalDriftRate}`,
      `- Constraint drift rate: ${report.summary.constraintDriftRate}`,
      `- Decision drift rate: ${report.summary.decisionDriftRate}`,
      `- Todo drift rate: ${report.summary.todoDriftRate}`,
      `- Goal contradiction rate: ${report.summary.goalContradictionRate}`,
      `- Constraint contradiction rate: ${report.summary.constraintContradictionRate}`,
      `- Decision contradiction rate: ${report.summary.decisionContradictionRate}`,
      `- Todo contradiction rate: ${report.summary.todoContradictionRate}`,
      `- Recall slope: ${report.summary.recallSlope}`,
      `- Repeated change rate: ${report.summary.repeatedChangeRate}`,
      "",
      "## Taxonomy",
      "",
      `- Goal omission runs: ${report.summary.taxonomy.goal.omissionRuns}`,
      `- Goal contradiction runs: ${report.summary.taxonomy.goal.contradictionRuns}`,
      `- Constraint omission runs: ${report.summary.taxonomy.constraint.omissionRuns}`,
      `- Constraint contradiction runs: ${report.summary.taxonomy.constraint.contradictionRuns}`,
      `- Decision omission runs: ${report.summary.taxonomy.decision.omissionRuns}`,
      `- Decision contradiction runs: ${report.summary.taxonomy.decision.contradictionRuns}`,
      `- Todo omission runs: ${report.summary.taxonomy.todo.omissionRuns}`,
      `- Todo contradiction runs: ${report.summary.taxonomy.todo.contradictionRuns}`,
      "",
      "## Notes",
      `- Gold facts source: ${fixture.gold ? "fixture.gold labels" : "parsed from fixture events"}.`,
      "- Positive slope indicates improving recall; negative slope indicates drift."
    ].join("\n");

    writeFileSync(mdPath, md);
  }
  for (let i = 0; i < cfg.runs; i += 1) {
    const before = await apiFetch("GET", `/memory/digests?scopeId=${scopeId}&limit=5`);
    const beforeCount = (before.json.items || []).length;
    const enqueue = await apiFetch("POST", "/memory/digest", { scopeId });
    if (!enqueue.ok) {
      report.metrics.push({ run: i + 1, ok: false, error: `enqueue_failed:${enqueue.status}` });
      continue;
    }
    const waited = await waitForNewDigest(scopeId, beforeCount);
    if (!waited.ok) {
      report.metrics.push({ run: i + 1, ok: false, error: waited.error });
      continue;
    }
    const digest = waited.digest;
    const summary = String(digest.summary || "");
    const changes = String(digest.changes || "");
    const nextSteps = Array.isArray(digest.nextSteps) ? digest.nextSteps.join(" ") : "";
    const combined = `${summary}\n${changes}\n${nextSteps}`;

    const recallGoal = factRecall(combined, gold.goal);
    const recallConstraints = factRecall(combined, gold.constraints);
    const recallDecisions = factRecall(combined, gold.decisions);
    const recallTodos = factRecall(combined, gold.todos);
    const goalDriftRate = driftRateFromRecall(recallGoal);
    const constraintDriftRate = driftRateFromRecall(recallConstraints);
    const decisionDriftRate = driftRateFromRecall(recallDecisions);
    const todoDriftRate = driftRateFromRecall(recallTodos);
    const goalContradictionRate = contradictionRate(combined, gold.contradictions.goal);
    const constraintContradictionRate = contradictionRate(combined, gold.contradictions.constraints);
    const decisionContradictionRate = contradictionRate(combined, gold.contradictions.decisions);
    const todoContradictionRate = contradictionRate(combined, gold.contradictions.todos);
    const avgRecall = (recallGoal + recallConstraints + recallDecisions + recallTodos) / 4;
    recalls.push(avgRecall);

    const repeatedChanges = prevChanges && normalizeText(prevChanges) === normalizeText(changes);
    prevChanges = changes;

    report.metrics.push({
      run: i + 1,
      ok: true,
      recallGoal,
      recallConstraints,
      recallDecisions,
      recallTodos,
      goalDriftRate,
      constraintDriftRate,
      decisionDriftRate,
      todoDriftRate,
      goalContradictionRate,
      constraintContradictionRate,
      decisionContradictionRate,
      todoContradictionRate,
      goalMatches: countMatches(combined, gold.goal),
      constraintMatches: countMatches(combined, gold.constraints),
      decisionMatches: countMatches(combined, gold.decisions),
      todoMatches: countMatches(combined, gold.todos),
      avgRecall,
      repeatedChanges
    });

    // eslint-disable-next-line no-console
    console.log(`Run ${i + 1}/${cfg.runs}: avgRecall=${avgRecall.toFixed(3)} repeatedChanges=${repeatedChanges}`);
    writeReport(false);
  }

  const endedAt = msNow();
  report.endedAt = endedAt;
  writeReport(true);

  // eslint-disable-next-line no-console
  console.log(`Drift complete. Avg recall: ${report.summary.avgRecall}`);
  // eslint-disable-next-line no-console
  console.log(`Report: ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`Report: ${mdPath}`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Drift failed:", err.message || err);
  process.exit(1);
});
