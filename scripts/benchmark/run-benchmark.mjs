#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { fileURLToPath } from "url";
import os from "os";
import { execSync } from "child_process";

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
  userId: process.env.BENCH_USER_ID || "benchmark-user",
  events: Number(process.env.BENCH_EVENTS || 300),
  concurrency: Number(process.env.BENCH_INGEST_CONCURRENCY || 20),
  retrieveQueries: Number(process.env.BENCH_RETRIEVE_QUERIES || 12),
  runtimeRuns: Number(process.env.BENCH_RUNTIME_RUNS || 4),
  runtimePolicyProfile: process.env.BENCH_RUNTIME_POLICY_PROFILE || "default",
  runtimeRecallLimit: process.env.BENCH_RUNTIME_RECALL_LIMIT ? Number(process.env.BENCH_RUNTIME_RECALL_LIMIT) : null,
  runtimePromoteLongForm: process.env.BENCH_RUNTIME_PROMOTE_LONG_FORM === "true",
  runtimeDigestOnCandidate: process.env.BENCH_RUNTIME_DIGEST_ON_CANDIDATE === "true",
  digestRuns: Number(process.env.BENCH_DIGEST_RUNS || 2),
  timeoutMs: Number(process.env.BENCH_TIMEOUT_MS || 180000),
  outputDir: process.env.BENCH_OUTPUT_DIR || "benchmark-results",
  featureLlm: process.env.FEATURE_LLM === "true",
  profile: process.env.BENCH_PROFILE || "balanced",
  seed: Number(process.env.BENCH_SEED || 42),
  fixture: process.env.BENCH_FIXTURE || "",
  includeReplay: process.env.BENCH_INCLUDE_REPLAY !== "false"
};

const modelConfig = {
  provider: process.env.MODEL_PROVIDER || "openai-compatible",
  baseUrl: process.env.MODEL_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  model: process.env.MODEL_NAME || process.env.OPENAI_MODEL || "gpt-4o-mini"
};

const headers = { "Content-Type": "application/json", "x-user-id": cfg.userId };

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function msNow() {
  return new Date().toISOString();
}

function getGitCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.GIT_COMMIT || "unknown";
  }
}

function getGitDescribe() {
  try {
    const base = execSync("git describe --tags --always --dirty", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return base || "unknown";
  } catch {
    return process.env.GIT_DESCRIBE || "unknown";
  }
}

function getEnvSnapshot() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model || "unknown",
    cores: os.cpus().length,
    memoryGb: Number((os.totalmem() / (1024 ** 3)).toFixed(2))
  };
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

async function withConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: limit }).map(async () => {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function loadFixture(fixturePath) {
  if (!fixturePath) return null;
  const fullPath = path.isAbsolute(fixturePath) ? fixturePath : path.join(root, fixturePath);
  const raw = readFileSync(fullPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.events)) {
    throw new Error("invalid_fixture: missing events array");
  }
  return {
    events: parsed.events,
    gold: parsed.gold ?? null,
    retrieveCases: Array.isArray(parsed.retrieveCases) ? parsed.retrieveCases : null,
    source: fullPath
  };
}

function parseGoldFacts(events) {
  const goal = [];
  const constraints = [];
  const decisions = [];
  const todos = [];
  const allTodos = [];

  for (const event of events) {
    const text = String(event.content || "");
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^goal\s*:/i.test(line)) goal.push(line.replace(/^goal\s*:\s*/i, "").trim());
      if (/^constraint\s*:/i.test(line)) constraints.push(line.replace(/^constraint\s*:\s*/i, "").trim());
      if (/^todo\s*:/i.test(line)) {
        const todo = line.replace(/^todo\s*:\s*/i, "").trim();
        todos.push(todo);
        allTodos.push(todo);
      }
    }
    if (/\b(decide|decision|we will|agreed)\b/i.test(text)) {
      decisions.push(text.trim());
    }
    if (/^todo\s*:/i.test(text.trim())) {
      allTodos.push(text.replace(/^todo\s*:\s*/i, "").trim());
    }
  }

  const uniq = (items) => [...new Set(items.filter(Boolean))];
  return {
    goal: uniq(goal),
    constraints: uniq(constraints),
    decisions: uniq(decisions),
    todos: uniq(todos),
    transientTodos: uniq(allTodos.filter((item) => !todos.includes(item))),
    contradictions: { goal: [], constraints: [], decisions: [], todos: [] }
  };
}

function loadGoldFacts(fixture) {
  if (!fixture) return null;
  if (fixture.gold && typeof fixture.gold === "object") {
    return {
      goal: Array.isArray(fixture.gold.goal) ? fixture.gold.goal : [],
      constraints: Array.isArray(fixture.gold.constraints) ? fixture.gold.constraints : [],
      decisions: Array.isArray(fixture.gold.decisions) ? fixture.gold.decisions : [],
      todos: Array.isArray(fixture.gold.todos) ? fixture.gold.todos : [],
      transientTodos: Array.isArray(fixture.gold.transientTodos) ? fixture.gold.transientTodos : [],
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
  return parseGoldFacts(fixture.events);
}

function generateEvents(total, rng) {
  const events = [];
  for (let i = 0; i < total; i += 1) {
    if (i % 60 === 0) {
      events.push({ type: "document", key: "doc:goal", content: `goal: ship benchmarkable memory engine v${Math.floor(i / 60) + 1}` });
      continue;
    }
    if (i % 45 === 0) {
      events.push({ type: "document", key: "doc:constraints", content: "constraint: no hosted dependency\nconstraint: keep api stable" });
      continue;
    }
    if (i % 25 === 0) {
      events.push({ type: "stream", content: `We decide to prioritize ingestion throughput batch ${i}` });
      continue;
    }
    if (i % 17 === 0) {
      events.push({ type: "stream", content: `Blocked by queue visibility timeout around item ${i}` });
      continue;
    }
    if (i % 9 === 0) {
      events.push({ type: "stream", content: `TODO: add benchmark assertion for p95 latency group ${i}` });
      continue;
    }
    if (i % 7 === 0) {
      events.push({ type: "stream", content: `Status update: processed event ${i}` });
      continue;
    }
    const noise = rng ? Math.floor(rng() * 1000) : Math.floor(i / 3);
    events.push({ type: "stream", content: `noise ping ${noise}` });
  }
  return events;
}

function scoreIngest(throughput, p95) {
  const throughputScore = clamp((throughput / 80) * 70);
  const latencyScore = clamp(30 - Math.max(0, (p95 - 180) / 8));
  return clamp(throughputScore + latencyScore);
}

function scoreRetrieve(hitRate, p95) {
  const hitScore = clamp(hitRate * 70);
  const latencyScore = clamp(30 - Math.max(0, (p95 - 250) / 10));
  return clamp(hitScore + latencyScore);
}

function scoreDigest(successRate, consistencyRate, avgLatencyMs) {
  const successScore = clamp(successRate * 45);
  const consistencyScore = clamp(consistencyRate * 35);
  const latencyScore = clamp(20 - Math.max(0, (avgLatencyMs - 15000) / 1500));
  return clamp(successScore + consistencyScore + latencyScore);
}

function scoreReminder(successRate, avgDelayMs) {
  const successScore = clamp(successRate * 70);
  const delayScore = clamp(30 - Math.max(0, (avgDelayMs - 60000) / 5000));
  return clamp(successScore + delayScore);
}

function omissionWarningRate(consistencyTaxonomy) {
  const warnings = consistencyTaxonomy?.warnings || {};
  const omissionKeys = ["goal_omission", "constraint_omission", "decision_omission", "todo_omission"];
  const omissionTotal = omissionKeys.reduce((sum, key) => sum + (warnings[key] || 0), 0);
  const warningTotal = Object.values(warnings).reduce((sum, count) => sum + count, 0);
  if (warningTotal === 0) return 0;
  return Number((omissionTotal / warningTotal).toFixed(3));
}

function buildLongTermMemoryReliabilityBreakdown(digestMetrics, replayMetrics, runtimeMetrics) {
  if (!digestMetrics?.enabled) {
    return {
      consistency: 0,
      retention: 0,
      contradictionControl: 0,
      replay: 0,
      runtimeGrounding: 0,
      total: 0
    };
  }

  const consistencyScore = clamp((digestMetrics.consistencyPassRate || 0) * 30);
  const retention = digestMetrics.goldRetention
    ? (
        (digestMetrics.goldRetention.recallGoal || 0) +
        (digestMetrics.goldRetention.recallConstraints || 0) +
        (digestMetrics.goldRetention.recallDecisions || 0) +
        (digestMetrics.goldRetention.recallTodos || 0)
      ) / 4
    : digestMetrics.consistencyPassRate || 0;
  const contradiction = digestMetrics.goldRetention
    ? (
        (digestMetrics.goldRetention.goalContradictionRate || 0) +
        (digestMetrics.goldRetention.constraintContradictionRate || 0) +
        (digestMetrics.goldRetention.decisionContradictionRate || 0) +
        (digestMetrics.goldRetention.todoContradictionRate || 0) +
        (digestMetrics.goldRetention.temporaryTodoIntrusionRate || 0)
      ) / 5
    : 0;
  const retentionScore = clamp(retention * 35);
  const contradictionScore = clamp((1 - contradiction) * 20);

  let replayScore = 15;
  if (replayMetrics?.enabled) {
    if (!replayMetrics.success) {
      replayScore = 0;
    } else if (replayMetrics.stateMatch) {
      replayScore = 15;
    } else {
      const totalCategories = (replayMetrics.matchedCategories?.length || 0) + (replayMetrics.mismatchedCategories?.length || 0);
      const matchedRatio = totalCategories > 0 ? (replayMetrics.matchedCategories?.length || 0) / totalCategories : 0;
      replayScore = clamp(matchedRatio * 15);
    }
  }

  let runtimeScore = 0;
  if (runtimeMetrics?.enabled) {
    runtimeScore = clamp(((runtimeMetrics.evidenceCoverageRate || 0) * 7.5) + ((1 - Math.max(0, 1 - (runtimeMetrics.success / Math.max(1, runtimeMetrics.runs)))) * 7.5));
  } else {
    runtimeScore = 15;
  }

  return {
    consistency: Number(consistencyScore.toFixed(2)),
    retention: Number(retentionScore.toFixed(2)),
    contradictionControl: Number(contradictionScore.toFixed(2)),
    replay: Number(replayScore.toFixed(2)),
    runtimeGrounding: Number((runtimeScore - 15).toFixed(2)),
    total: Number(clamp(consistencyScore + retentionScore + contradictionScore + replayScore + runtimeScore - 15).toFixed(2))
  };
}

function scoreLongTermMemoryReliability(digestMetrics, replayMetrics, runtimeMetrics) {
  return buildLongTermMemoryReliabilityBreakdown(digestMetrics, replayMetrics, runtimeMetrics).total;
}

function computeOverallScore(parts, featureLlm) {
  if (featureLlm) {
    return clamp(parts.ingest * 0.3 + parts.retrieve * 0.2 + parts.digest * 0.3 + parts.reminder * 0.2);
  }
  return clamp(parts.ingest * 0.45 + parts.retrieve * 0.35 + parts.reminder * 0.2);
}

function isActionable(step) {
  return /^(add|analyze|build|create|define|deliver|document|fix|implement|investigate|measure|monitor|plan|prioritize|refactor|review|ship|test|update|validate|write)\b/i.test(step.trim());
}

function normalizeText(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

function incrementCounter(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function classifyDigestIssues(digest) {
  const issues = [];
  const changes = String(digest.changes || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const nextSteps = Array.isArray(digest.nextSteps) ? digest.nextSteps : [];
  const summaryWords = String(digest.summary || "").split(/\s+/).filter(Boolean).length;

  if (summaryWords > 120) issues.push("summary_too_long");
  if (changes.length > 3) issues.push("too_many_changes");
  if (nextSteps.length < 1 || nextSteps.length > 3) issues.push("invalid_next_steps_count");
  if (changes.length > 0) {
    const normalizedChanges = changes.map((line) => normalizeText(line.replace(/^-\s*/, ""))).filter(Boolean);
    if (new Set(normalizedChanges).size !== normalizedChanges.length) {
      issues.push("duplicate_changes");
    }
  }
  if (nextSteps.some((step) => !isActionable(step))) {
    issues.push("non_actionable_next_step");
  }

  return {
    issues,
    valid: issues.length === 0
  };
}

function factRecall(text, facts) {
  if (!facts.length) return 1;
  const normalized = normalizeText(text);
  const hits = facts.filter((item) => normalized.includes(normalizeText(item))).length;
  return hits / facts.length;
}

function contradictionRate(text, contradictions) {
  if (!contradictions.length) return 0;
  const normalized = normalizeText(text);
  const hits = contradictions.filter((item) => normalized.includes(normalizeText(item))).length;
  return hits / contradictions.length;
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
    addedInReplay: rebuilt.filter((item) => !baselineSet.has(item))
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
  const mismatchedCategories = Object.entries(diff)
    .filter(([, value]) => !value.match)
    .map(([key]) => key);
  const matchedCategories = Object.entries(diff)
    .filter(([, value]) => value.match)
    .map(([key]) => key);
  return {
    stateMatch: mismatchedCategories.length === 0,
    matchedCategories,
    mismatchedCategories
  };
}

function containsAny(text, terms) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term).trim()));
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

async function waitForReminderSent(reminderId, dueAtIso) {
  const start = Date.now();
  while (Date.now() - start <= cfg.timeoutMs) {
    const result = await apiFetch("GET", "/reminders?status=sent&limit=20");
    if (result.ok) {
      const found = (result.json.items || []).find((item) => item.id === reminderId);
      if (found) {
        const delayMs = Date.now() - new Date(dueAtIso).getTime();
        return { ok: true, delayMs };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return { ok: false, delayMs: cfg.timeoutMs };
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

async function run() {
  const profiles = {
    quick: { events: 50, concurrency: 8, retrieveQueries: 8, digestRuns: 1 },
    balanced: { events: 120, concurrency: 12, retrieveQueries: 16, digestRuns: 2 },
    stress: { events: 300, concurrency: 20, retrieveQueries: 24, digestRuns: 3 }
  };
  if (profiles[cfg.profile]) {
    cfg.events = Number(process.env.BENCH_EVENTS || profiles[cfg.profile].events);
    cfg.concurrency = Number(process.env.BENCH_INGEST_CONCURRENCY || profiles[cfg.profile].concurrency);
    cfg.retrieveQueries = Number(process.env.BENCH_RETRIEVE_QUERIES || profiles[cfg.profile].retrieveQueries);
    cfg.runtimeRuns = Number(process.env.BENCH_RUNTIME_RUNS || Math.max(2, Math.floor(profiles[cfg.profile].retrieveQueries / 4)));
    cfg.digestRuns = Number(process.env.BENCH_DIGEST_RUNS || profiles[cfg.profile].digestRuns);
  }

  const startedAt = msNow();
  const report = {
    startedAt,
    commit: getGitCommit(),
    describe: getGitDescribe(),
    environment: {
      ...getEnvSnapshot(),
      model: modelConfig
    },
    config: cfg,
    metrics: {},
    scores: {},
    notes: []
  };
  if (process.env.ABLATION_NAME) {
    report.config.ablationName = process.env.ABLATION_NAME;
  }

  const scopeResp = await apiFetch("POST", "/scopes", { name: `Benchmark ${Date.now()}` });
  if (!scopeResp.ok || !scopeResp.json.id) {
    throw new Error(`failed_create_scope:${scopeResp.status}:${JSON.stringify(scopeResp.json)}`);
  }
  const scopeId = scopeResp.json.id;
  report.metrics.scopeId = scopeId;

  const rng = mulberry32(cfg.seed);
  const fixture = loadFixture(cfg.fixture);
  const goldFacts = loadGoldFacts(fixture);
  if (fixture?.source) {
    report.notes.push(`Using fixture: ${fixture.source}`);
    if (fixture.gold) report.notes.push("Fixture includes explicit gold labels.");
  }
  const events = fixture?.events ?? generateEvents(cfg.events, rng);
  const ingestStart = performance.now();
  const ingestResults = await withConcurrency(events, cfg.concurrency, async (item) => {
    const body = { scopeId, source: "sdk", ...item };
    return apiFetch("POST", "/memory/events", body);
  });
  const ingestDurationSec = (performance.now() - ingestStart) / 1000;
  const ingestLatencies = ingestResults.map((r) => r.latencyMs);
  const ingestSuccess = ingestResults.filter((r) => r.ok).length;
  const ingestThroughput = ingestSuccess / Math.max(0.001, ingestDurationSec);
  report.metrics.ingest = {
    total: events.length,
    success: ingestSuccess,
    failure: events.length - ingestSuccess,
    throughputEventsPerSec: Number(ingestThroughput.toFixed(2)),
    p50Ms: Number(percentile(ingestLatencies, 50).toFixed(2)),
    p95Ms: Number(percentile(ingestLatencies, 95).toFixed(2))
  };

  const retrieveCases = fixture?.retrieveCases ?? [
    { query: "What did we decide?", expected: "decide", aliases: ["decision", "agreed", "we decide", "we will"] },
    { query: "What constraints exist?", expected: "constraint", aliases: ["limitation", "must", "cannot", "blocked"] },
    { query: "Any blockers?", expected: "blocked", aliases: ["blocker", "constraint", "risk"] },
    { query: "What todos are pending?", expected: "todo", aliases: ["next step", "action item", "pending", "follow up"] }
  ];
  const retrieveRuns = Array.from({ length: cfg.retrieveQueries }).map((_, i) => retrieveCases[i % retrieveCases.length]);
  const retrieveResults = [];
  for (const item of retrieveRuns) {
    const res = await apiFetch("POST", "/memory/retrieve", { scopeId, query: item.query, limit: 20 });
    const combined = `${res.json.digest || ""}\n${(res.json.events || []).map((e) => e.content).join("\n")}`.toLowerCase();
    retrieveResults.push({
      ok: res.ok,
      latencyMs: res.latencyMs,
      strictHit: combined.includes(item.expected),
      hit: containsAny(combined, [item.expected, ...item.aliases])
    });
  }
  const retrieveLatencies = retrieveResults.map((r) => r.latencyMs);
  const retrieveHitRate = retrieveResults.filter((r) => r.hit).length / Math.max(1, retrieveResults.length);
  const retrieveStrictHitRate = retrieveResults.filter((r) => r.strictHit).length / Math.max(1, retrieveResults.length);
  report.metrics.retrieve = {
    total: retrieveResults.length,
    success: retrieveResults.filter((r) => r.ok).length,
    strictHitRate: Number(retrieveStrictHitRate.toFixed(3)),
    hitRate: Number(retrieveHitRate.toFixed(3)),
    p50Ms: Number(percentile(retrieveLatencies, 50).toFixed(2)),
    p95Ms: Number(percentile(retrieveLatencies, 95).toFixed(2))
  };

  let digestMetrics = {
    enabled: cfg.featureLlm,
    runs: 0,
    success: 0,
    consistencyPassRate: 0,
    omissionWarningRate: 0,
    avgLatencyMs: 0,
    failureTaxonomy: {},
    consistencyTaxonomy: { errors: {}, warnings: {} },
    goldRetention: null
  };
  let replayMetrics = {
    enabled: cfg.featureLlm && cfg.includeReplay,
    success: 0,
    rebuildSnapshots: 0,
    stateMatch: false,
    matchedCategories: [],
    mismatchedCategories: [],
    diff: null,
    error: null
  };
  let runtimeMetrics = {
    enabled: cfg.featureLlm,
    runs: 0,
    success: 0,
    avgLatencyMs: 0,
    evidenceCoverageRate: 0,
    evidenceDigestSummaryRate: 0,
    evidenceEventSnippetRate: 0,
    evidenceStateSummaryRate: 0,
    digestTriggerRate: 0,
    writeTierCounts: {},
    noteTaxonomy: {},
    policyProfile: cfg.runtimePolicyProfile
  };

  if (cfg.featureLlm) {
    const durations = [];
    const consistencyPass = [];
    const failureTaxonomy = {};
    const consistencyTaxonomy = { errors: {}, warnings: {} };
    const goldRetentionRuns = [];
    for (let i = 0; i < cfg.digestRuns; i += 1) {
      const before = await apiFetch("GET", `/memory/digests?scopeId=${scopeId}&limit=5`);
      const beforeCount = (before.json.items || []).length;
      const enqueue = await apiFetch("POST", "/memory/digest", { scopeId });
      if (!enqueue.ok) {
        incrementCounter(failureTaxonomy, `enqueue_failed_${enqueue.status}`);
        continue;
      }
      const t0 = performance.now();
      const waited = await waitForNewDigest(scopeId, beforeCount);
      durations.push(performance.now() - t0);
      if (!waited.ok) {
        incrementCounter(failureTaxonomy, waited.error || "digest_wait_failed");
        continue;
      }
      const digest = waited.digest;
      const classified = classifyDigestIssues(digest);
      consistencyPass.push(classified.valid);
      if (!classified.valid) {
        for (const issue of classified.issues) incrementCounter(failureTaxonomy, issue);
      }

      const stateSnapshot = await apiFetch("GET", `/memory/state?scopeId=${scopeId}`);
      if (stateSnapshot.ok && stateSnapshot.json?.consistency) {
        const errors = Array.isArray(stateSnapshot.json.consistency.errors)
          ? stateSnapshot.json.consistency.errors
          : [];
        const warnings = Array.isArray(stateSnapshot.json.consistency.warnings)
          ? stateSnapshot.json.consistency.warnings
          : [];
        for (const error of errors) incrementCounter(consistencyTaxonomy.errors, error);
        for (const warning of warnings) incrementCounter(consistencyTaxonomy.warnings, warning);
      }

      if (goldFacts) {
        const combined = [
          String(digest.summary || ""),
          String(digest.changes || ""),
          ...(Array.isArray(digest.nextSteps) ? digest.nextSteps : [])
        ].join("\n");
        goldRetentionRuns.push({
          recallGoal: factRecall(combined, goldFacts.goal),
          recallConstraints: factRecall(combined, goldFacts.constraints),
          recallDecisions: factRecall(combined, goldFacts.decisions),
          recallTodos: factRecall(combined, goldFacts.todos),
          temporaryTodoIntrusionRate: goldFacts.transientTodos.length
            ? Number((countMatches(combined, goldFacts.transientTodos) / goldFacts.transientTodos.length).toFixed(3))
            : 0,
          goalContradictionRate: contradictionRate(combined, goldFacts.contradictions.goal),
          constraintContradictionRate: contradictionRate(combined, goldFacts.contradictions.constraints),
          decisionContradictionRate: contradictionRate(combined, goldFacts.contradictions.decisions),
          todoContradictionRate: contradictionRate(combined, goldFacts.contradictions.todos)
        });
      }
    }
    const goldRetention = goldRetentionRuns.length
      ? {
          recallGoal: Number((goldRetentionRuns.reduce((sum, run) => sum + run.recallGoal, 0) / goldRetentionRuns.length).toFixed(3)),
          recallConstraints: Number((goldRetentionRuns.reduce((sum, run) => sum + run.recallConstraints, 0) / goldRetentionRuns.length).toFixed(3)),
          recallDecisions: Number((goldRetentionRuns.reduce((sum, run) => sum + run.recallDecisions, 0) / goldRetentionRuns.length).toFixed(3)),
          recallTodos: Number((goldRetentionRuns.reduce((sum, run) => sum + run.recallTodos, 0) / goldRetentionRuns.length).toFixed(3)),
          temporaryTodoIntrusionRate: Number((goldRetentionRuns.reduce((sum, run) => sum + run.temporaryTodoIntrusionRate, 0) / goldRetentionRuns.length).toFixed(3)),
          goalContradictionRate: Number((goldRetentionRuns.reduce((sum, run) => sum + run.goalContradictionRate, 0) / goldRetentionRuns.length).toFixed(3)),
          constraintContradictionRate: Number((goldRetentionRuns.reduce((sum, run) => sum + run.constraintContradictionRate, 0) / goldRetentionRuns.length).toFixed(3)),
          decisionContradictionRate: Number((goldRetentionRuns.reduce((sum, run) => sum + run.decisionContradictionRate, 0) / goldRetentionRuns.length).toFixed(3)),
          todoContradictionRate: Number((goldRetentionRuns.reduce((sum, run) => sum + run.todoContradictionRate, 0) / goldRetentionRuns.length).toFixed(3))
        }
      : null;
    digestMetrics = {
      enabled: true,
      runs: cfg.digestRuns,
      success: durations.length,
      consistencyPassRate: Number((consistencyPass.filter(Boolean).length / Math.max(1, consistencyPass.length)).toFixed(3)),
      omissionWarningRate: omissionWarningRate(consistencyTaxonomy),
      avgLatencyMs: Number((durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length)).toFixed(2)),
      failureTaxonomy,
      consistencyTaxonomy,
      goldRetention
    };
  } else {
    report.notes.push("FEATURE_LLM=false; digest/answer benchmarking skipped.");
  }
  report.metrics.digest = digestMetrics;

  if (cfg.featureLlm && cfg.includeReplay) {
    const baselineState = await apiFetch("GET", `/memory/state?scopeId=${scopeId}`);
    if (!baselineState.ok || !baselineState.json.state) {
      replayMetrics.error = `baseline_state_failed:${baselineState.status}`;
    } else {
      const rebuild = await apiFetch("POST", "/memory/digest/rebuild", { scopeId, strategy: "full" });
      if (!rebuild.ok || !rebuild.json.rebuildGroupId) {
        replayMetrics.error = `rebuild_enqueue_failed:${rebuild.status}`;
      } else {
        const rebuildHistory = await waitForStateHistory(scopeId, rebuild.json.rebuildGroupId);
        if (!rebuildHistory.ok) {
          replayMetrics.error = rebuildHistory.error;
        } else {
          const latestRebuildState = rebuildHistory.items[0]?.state ?? null;
          const baselineCanonical = canonicalize(baselineState.json.state);
          const rebuildCanonical = canonicalize(latestRebuildState);
          const diff = buildStateDiff(baselineState.json.state, latestRebuildState);
          const diffSummary = summarizeStateDiff(diff);
          replayMetrics = {
            enabled: true,
            success: 1,
            rebuildSnapshots: rebuildHistory.items.length,
            stateMatch: JSON.stringify(baselineCanonical) === JSON.stringify(rebuildCanonical),
            matchedCategories: diffSummary.matchedCategories,
            mismatchedCategories: diffSummary.mismatchedCategories,
            diff,
            error: null
          };
        }
      }
    }
  } else if (!cfg.includeReplay) {
    report.notes.push("Replay check skipped because BENCH_INCLUDE_REPLAY=false.");
  }
  report.metrics.replay = replayMetrics;

  if (cfg.featureLlm) {
    const runtimeCases = (fixture?.retrieveCases ?? retrieveCases)
      .slice(0, Math.max(1, cfg.runtimeRuns))
      .map((item, index) => ({
        message: cfg.runtimePromoteLongForm && index === 0
          ? `${item.query}\nLong-form runtime note for profile benchmarking.\nThis text is intentionally extended to exercise documented promotion and runtime evidence handling.`
          : item.query,
        digestMode: index === 0 ? "force" : "skip",
        writeTier: "candidate"
      }));
    const runtimeResults = [];
    for (const item of runtimeCases) {
      const res = await apiFetch("POST", "/memory/runtime/turn", {
        scopeId,
        message: item.message,
        source: "sdk",
        policyProfile: cfg.runtimePolicyProfile,
        ...(cfg.runtimeRecallLimit || cfg.runtimePromoteLongForm || cfg.runtimeDigestOnCandidate
          ? {
              policyOverrides: {
                ...(cfg.runtimeRecallLimit ? { recallLimit: cfg.runtimeRecallLimit } : {}),
                ...(cfg.runtimePromoteLongForm ? { promoteLongFormToDocumented: true } : {}),
                ...(cfg.runtimeDigestOnCandidate ? { digestOnCandidate: true } : {})
              }
            }
          : {}),
        writeTier: item.writeTier,
        digestMode: item.digestMode
      });
      const evidence = res.json?.evidence ?? {};
      const evidenceCoverage = Boolean(
        (typeof evidence.digestSummary === "string" && evidence.digestSummary.length > 0) ||
        (Array.isArray(evidence.eventSnippets) && evidence.eventSnippets.length > 0) ||
        (typeof evidence.stateSummary === "string" && evidence.stateSummary.length > 0)
      );
      runtimeResults.push({
        ok: res.ok && typeof res.json?.answer === "string",
        latencyMs: res.latencyMs,
        evidenceCoverage,
        hasDigestSummary: typeof evidence.digestSummary === "string" && evidence.digestSummary.length > 0,
        hasEventSnippets: Array.isArray(evidence.eventSnippets) && evidence.eventSnippets.length > 0,
        hasStateSummary: typeof evidence.stateSummary === "string" && evidence.stateSummary.length > 0,
        digestTriggered: Boolean(res.json?.digestTriggered),
        writeTier: typeof res.json?.writeTier === "string" ? res.json.writeTier : "unknown",
        notes: Array.isArray(res.json?.notes) ? res.json.notes : []
      });
    }
    const runtimeLatencies = runtimeResults.map((result) => result.latencyMs);
    const writeTierCounts = {};
    const noteTaxonomy = {};
    for (const result of runtimeResults) {
      incrementCounter(writeTierCounts, result.writeTier);
      for (const note of Array.isArray(result.notes) ? result.notes : []) {
        incrementCounter(noteTaxonomy, note);
      }
    }
    runtimeMetrics = {
      enabled: true,
      runs: runtimeResults.length,
      success: runtimeResults.filter((result) => result.ok).length,
      avgLatencyMs: Number((runtimeLatencies.reduce((sum, value) => sum + value, 0) / Math.max(1, runtimeLatencies.length)).toFixed(2)),
      evidenceCoverageRate: Number((runtimeResults.filter((result) => result.evidenceCoverage).length / Math.max(1, runtimeResults.length)).toFixed(3)),
      evidenceDigestSummaryRate: Number((runtimeResults.filter((result) => result.hasDigestSummary).length / Math.max(1, runtimeResults.length)).toFixed(3)),
      evidenceEventSnippetRate: Number((runtimeResults.filter((result) => result.hasEventSnippets).length / Math.max(1, runtimeResults.length)).toFixed(3)),
      evidenceStateSummaryRate: Number((runtimeResults.filter((result) => result.hasStateSummary).length / Math.max(1, runtimeResults.length)).toFixed(3)),
      digestTriggerRate: Number((runtimeResults.filter((result) => result.digestTriggered).length / Math.max(1, runtimeResults.length)).toFixed(3)),
      writeTierCounts,
      noteTaxonomy,
      policyProfile: cfg.runtimePolicyProfile,
      overrides: {
        recallLimit: cfg.runtimeRecallLimit,
        promoteLongFormToDocumented: cfg.runtimePromoteLongForm,
        digestOnCandidate: cfg.runtimeDigestOnCandidate
      }
    };
  }
  report.metrics.runtime = runtimeMetrics;

  const dueAt = new Date(Date.now() + 20000).toISOString();
  const reminderCreate = await apiFetch("POST", "/reminders", { scopeId, dueAt, text: "Benchmark reminder" });
  let reminderMetrics = {
    success: 0,
    delayMs: cfg.timeoutMs
  };
  if (reminderCreate.ok && reminderCreate.json.id) {
    const waited = await waitForReminderSent(reminderCreate.json.id, dueAt);
    reminderMetrics = {
      success: waited.ok ? 1 : 0,
      delayMs: Number(waited.delayMs.toFixed ? waited.delayMs.toFixed(2) : waited.delayMs)
    };
  }
  report.metrics.reminder = reminderMetrics;

  const ingestScore = scoreIngest(report.metrics.ingest.throughputEventsPerSec, report.metrics.ingest.p95Ms);
  const retrieveScore = scoreRetrieve(report.metrics.retrieve.hitRate, report.metrics.retrieve.p95Ms);
  const digestScore = cfg.featureLlm
    ? scoreDigest(
        report.metrics.digest.success / Math.max(1, report.metrics.digest.runs),
        report.metrics.digest.consistencyPassRate,
        report.metrics.digest.avgLatencyMs
      )
    : 0;
  const reminderScore = scoreReminder(report.metrics.reminder.success, report.metrics.reminder.delayMs);
  const reliabilityBreakdown = buildLongTermMemoryReliabilityBreakdown(report.metrics.digest, report.metrics.replay, report.metrics.runtime);

  report.scores = {
    ingest: Number(ingestScore.toFixed(2)),
    retrieve: Number(retrieveScore.toFixed(2)),
    digest: Number(digestScore.toFixed(2)),
    reliability: reliabilityBreakdown.total,
    reliabilityBreakdown,
    reminder: Number(reminderScore.toFixed(2)),
    overall: Number(computeOverallScore({ ingest: ingestScore, retrieve: retrieveScore, digest: digestScore, reminder: reminderScore }, cfg.featureLlm).toFixed(2))
  };

  const endedAt = msNow();
  report.endedAt = endedAt;

  const outDir = path.join(root, cfg.outputDir);
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `benchmark-${stamp}.json`);
  const mdPath = path.join(outDir, `benchmark-${stamp}.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = [
    "# Project Memory Benchmark Report",
    "",
    `- Started: ${report.startedAt}`,
    `- Ended: ${report.endedAt}`,
    `- API: ${cfg.apiBaseUrl}`,
    `- Seed: ${cfg.seed}`,
    `- Fixture: ${cfg.fixture || "(none)"}`,
    `- Commit: ${report.commit}`,
    `- Describe: ${report.describe}`,
    `- Node: ${report.environment.node} (${report.environment.platform}/${report.environment.arch})`,
    `- CPU: ${report.environment.cpu} (${report.environment.cores} cores, ${report.environment.memoryGb} GB)` ,
    `- Model provider: ${report.environment.model.provider}, model ${report.environment.model.model}, base ${report.environment.model.baseUrl}`,
    "",
    "## Scores",
    "",
    `- Overall: **${report.scores.overall}** / 100`,
    `- Ingest: ${report.scores.ingest}`,
    `- Retrieve: ${report.scores.retrieve}`,
    `- Digest: ${report.scores.digest}${cfg.featureLlm ? "" : " (skipped)"}`,
    `- Long-term Memory Reliability: ${report.scores.reliability}${cfg.featureLlm ? "" : " (skipped)"}`,
    `- Reminder: ${report.scores.reminder}`,
    "",
    "## Reliability Breakdown",
    "",
    `- Consistency: ${report.scores.reliabilityBreakdown?.consistency ?? 0}`,
    `- Retention: ${report.scores.reliabilityBreakdown?.retention ?? 0}`,
    `- Contradiction control: ${report.scores.reliabilityBreakdown?.contradictionControl ?? 0}`,
    `- Replay: ${report.scores.reliabilityBreakdown?.replay ?? 0}`,
    `- Runtime grounding: ${report.scores.reliabilityBreakdown?.runtimeGrounding ?? 0}`,
    "",
    "## Metrics",
    "",
    `- Ingest throughput: ${report.metrics.ingest.throughputEventsPerSec} events/s (p95 ${report.metrics.ingest.p95Ms} ms)`,
    `- Retrieve semantic hit rate: ${report.metrics.retrieve.hitRate}, strict hit rate: ${report.metrics.retrieve.strictHitRate} (p95 ${report.metrics.retrieve.p95Ms} ms)`,
    `- Digest success: ${report.metrics.digest.success}/${report.metrics.digest.runs}, consistency pass ${report.metrics.digest.consistencyPassRate}, omission warning rate ${report.metrics.digest.omissionWarningRate ?? 0}, avg latency ${report.metrics.digest.avgLatencyMs} ms`,
    `- Replay state match: ${report.metrics.replay.enabled ? (report.metrics.replay.success ? (report.metrics.replay.stateMatch ? "yes" : "no") : `error (${report.metrics.replay.error})`) : "skipped"}${report.metrics.replay.enabled && report.metrics.replay.success ? `, snapshots ${report.metrics.replay.rebuildSnapshots}` : ""}`,
    `- Runtime turn success: ${report.metrics.runtime.enabled ? `${report.metrics.runtime.success}/${report.metrics.runtime.runs}` : "skipped"}, evidence coverage ${report.metrics.runtime.enabled ? report.metrics.runtime.evidenceCoverageRate : "n/a"}, avg latency ${report.metrics.runtime.enabled ? `${report.metrics.runtime.avgLatencyMs} ms` : "n/a"}`,
    `- Reminder sent: ${report.metrics.reminder.success === 1 ? "yes" : "no"}, delay ${report.metrics.reminder.delayMs} ms`,
    ...(report.metrics.digest.goldRetention
      ? [
          `- Digest gold recall: goal ${report.metrics.digest.goldRetention.recallGoal}, constraints ${report.metrics.digest.goldRetention.recallConstraints}, decisions ${report.metrics.digest.goldRetention.recallDecisions}, todos ${report.metrics.digest.goldRetention.recallTodos}`,
          `- Digest contradiction rates: goal ${report.metrics.digest.goldRetention.goalContradictionRate}, constraints ${report.metrics.digest.goldRetention.constraintContradictionRate}, decisions ${report.metrics.digest.goldRetention.decisionContradictionRate}, todos ${report.metrics.digest.goldRetention.todoContradictionRate}`,
          `- Temporary todo intrusion rate: ${report.metrics.digest.goldRetention.temporaryTodoIntrusionRate ?? 0}`
        ]
      : []),
    "",
    "## Digest Failure Taxonomy",
    ...(cfg.featureLlm
      ? Object.keys(report.metrics.digest.failureTaxonomy || {}).length
        ? Object.entries(report.metrics.digest.failureTaxonomy)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => `- ${name}: ${count}`)
        : ["- none"]
      : ["- skipped"]),
    "",
    "## Digest Consistency Taxonomy",
    ...(cfg.featureLlm
      ? [
          "- Errors:",
          ...(Object.keys(report.metrics.digest.consistencyTaxonomy?.errors || {}).length
            ? Object.entries(report.metrics.digest.consistencyTaxonomy.errors)
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => `  - ${name}: ${count}`)
            : ["  - none"]),
          "- Warnings:",
          ...(Object.keys(report.metrics.digest.consistencyTaxonomy?.warnings || {}).length
            ? Object.entries(report.metrics.digest.consistencyTaxonomy.warnings)
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => `  - ${name}: ${count}`)
            : ["  - none"])
        ]
      : ["- skipped"]),
    "",
    "## Assistant Runtime",
    ...(report.metrics.runtime.enabled
      ? [
          `- Success: ${report.metrics.runtime.success}/${report.metrics.runtime.runs}`,
          `- Policy profile: ${report.metrics.runtime.policyProfile}`,
          `- Overrides: recallLimit=${report.metrics.runtime.overrides?.recallLimit ?? "default"}, promoteLongForm=${report.metrics.runtime.overrides?.promoteLongFormToDocumented ? "yes" : "no"}, digestOnCandidate=${report.metrics.runtime.overrides?.digestOnCandidate ? "yes" : "no"}`,
          `- Avg latency: ${report.metrics.runtime.avgLatencyMs} ms`,
          `- Evidence coverage rate: ${report.metrics.runtime.evidenceCoverageRate}`,
          `- Evidence digest summary rate: ${report.metrics.runtime.evidenceDigestSummaryRate}`,
          `- Evidence event snippet rate: ${report.metrics.runtime.evidenceEventSnippetRate}`,
          `- Evidence state summary rate: ${report.metrics.runtime.evidenceStateSummaryRate}`,
          `- Digest trigger rate: ${report.metrics.runtime.digestTriggerRate}`,
          `- Write tiers: ${Object.keys(report.metrics.runtime.writeTierCounts || {}).length ? Object.entries(report.metrics.runtime.writeTierCounts).map(([name, count]) => `${name}=${count}`).join(", ") : "none"}`,
          `- Note taxonomy: ${Object.keys(report.metrics.runtime.noteTaxonomy || {}).length ? Object.entries(report.metrics.runtime.noteTaxonomy).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}=${count}`).join(", ") : "none"}`
        ]
      : ["- skipped"]),
    "",
    "## Replay Consistency",
    ...(report.metrics.replay.enabled
      ? report.metrics.replay.success
        ? [
            `- State match: ${report.metrics.replay.stateMatch ? "yes" : "no"}`,
            `- Rebuild snapshots: ${report.metrics.replay.rebuildSnapshots}`,
            `- Matched categories: ${report.metrics.replay.matchedCategories.length ? report.metrics.replay.matchedCategories.join(", ") : "none"}`,
            `- Mismatched categories: ${report.metrics.replay.mismatchedCategories.length ? report.metrics.replay.mismatchedCategories.join(", ") : "none"}`,
            ...Object.entries(report.metrics.replay.diff || {}).flatMap(([key, value]) => {
              const lines = [`- ${key}: ${value.match ? "match" : "mismatch"}`];
              if ("missingFromReplay" in value) {
                lines.push(`  missing=${value.missingFromReplay.length ? value.missingFromReplay.join(" | ") : "none"}`);
                lines.push(`  added=${value.addedInReplay.length ? value.addedInReplay.join(" | ") : "none"}`);
              } else {
                lines.push(`  baseline=${value.baseline ?? "null"}`);
                lines.push(`  rebuilt=${value.rebuilt ?? "null"}`);
              }
              return lines;
            })
          ]
        : [`- Error: ${report.metrics.replay.error}`]
      : ["- skipped"]),
    "",
    "## Notes",
    ...(report.notes.length ? report.notes.map((note) => `- ${note}`) : ["- none"]),
    "",
    `JSON source: ${path.basename(jsonPath)}`
  ].join("\n");

  writeFileSync(mdPath, md);

  // eslint-disable-next-line no-console
  console.log(`Benchmark complete. Overall score: ${report.scores.overall}/100`);
  // eslint-disable-next-line no-console
  console.log(`Report: ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`Report: ${mdPath}`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Benchmark failed:", err.message || err);
  process.exit(1);
});
