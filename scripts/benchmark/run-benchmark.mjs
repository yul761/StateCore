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
  digestRuns: Number(process.env.BENCH_DIGEST_RUNS || 2),
  timeoutMs: Number(process.env.BENCH_TIMEOUT_MS || 180000),
  outputDir: process.env.BENCH_OUTPUT_DIR || "benchmark-results",
  featureLlm: process.env.FEATURE_LLM === "true",
  profile: process.env.BENCH_PROFILE || "balanced",
  seed: Number(process.env.BENCH_SEED || 42),
  fixture: process.env.BENCH_FIXTURE || ""
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

  for (const event of events) {
    const text = String(event.content || "");
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
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
    todos: uniq(todos),
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
    cfg.digestRuns = Number(process.env.BENCH_DIGEST_RUNS || profiles[cfg.profile].digestRuns);
  }

  const startedAt = msNow();
  const report = {
    startedAt,
    commit: getGitCommit(),
    describe: getGitDescribe(),
    environment: getEnvSnapshot(),
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
    avgLatencyMs: 0,
    failureTaxonomy: {},
    goldRetention: null
  };

  if (cfg.featureLlm) {
    const durations = [];
    const consistencyPass = [];
    const failureTaxonomy = {};
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
      avgLatencyMs: Number((durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length)).toFixed(2)),
      failureTaxonomy,
      goldRetention
    };
  } else {
    report.notes.push("FEATURE_LLM=false; digest/answer benchmarking skipped.");
  }
  report.metrics.digest = digestMetrics;

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

  report.scores = {
    ingest: Number(ingestScore.toFixed(2)),
    retrieve: Number(retrieveScore.toFixed(2)),
    digest: Number(digestScore.toFixed(2)),
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
    "",
    "## Scores",
    "",
    `- Overall: **${report.scores.overall}** / 100`,
    `- Ingest: ${report.scores.ingest}`,
    `- Retrieve: ${report.scores.retrieve}`,
    `- Digest: ${report.scores.digest}${cfg.featureLlm ? "" : " (skipped)"}`,
    `- Reminder: ${report.scores.reminder}`,
    "",
    "## Metrics",
    "",
    `- Ingest throughput: ${report.metrics.ingest.throughputEventsPerSec} events/s (p95 ${report.metrics.ingest.p95Ms} ms)`,
    `- Retrieve semantic hit rate: ${report.metrics.retrieve.hitRate}, strict hit rate: ${report.metrics.retrieve.strictHitRate} (p95 ${report.metrics.retrieve.p95Ms} ms)`,
    `- Digest success: ${report.metrics.digest.success}/${report.metrics.digest.runs}, consistency pass ${report.metrics.digest.consistencyPassRate}, avg latency ${report.metrics.digest.avgLatencyMs} ms`,
    `- Reminder sent: ${report.metrics.reminder.success === 1 ? "yes" : "no"}, delay ${report.metrics.reminder.delayMs} ms`,
    ...(report.metrics.digest.goldRetention
      ? [
          `- Digest gold recall: goal ${report.metrics.digest.goldRetention.recallGoal}, constraints ${report.metrics.digest.goldRetention.recallConstraints}, decisions ${report.metrics.digest.goldRetention.recallDecisions}, todos ${report.metrics.digest.goldRetention.recallTodos}`,
          `- Digest contradiction rates: goal ${report.metrics.digest.goldRetention.goalContradictionRate}, constraints ${report.metrics.digest.goldRetention.constraintContradictionRate}, decisions ${report.metrics.digest.goldRetention.decisionContradictionRate}, todos ${report.metrics.digest.goldRetention.todoContradictionRate}`
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
