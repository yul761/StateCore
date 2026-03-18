#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "benchmark-results");
mkdirSync(outDir, { recursive: true });

const baseEnv = {
  BENCH_SEED: process.env.BENCH_SEED || "42",
  BENCH_FIXTURE: process.env.BENCH_FIXTURE || "benchmark-fixtures/basic.json",
  BENCH_PROFILE: process.env.BENCH_PROFILE || "balanced"
};

const matrix = [
  { name: "baseline", env: {} },
  { name: "no_classifier", env: { DIGEST_USE_LLM_CLASSIFIER: "false" } },
  { name: "high_novelty", env: { DIGEST_NOVELTY_THRESHOLD: "0.3" } },
  { name: "low_novelty", env: { DIGEST_NOVELTY_THRESHOLD: "0.05" } },
  { name: "small_budget", env: { DIGEST_EVENT_BUDGET_TOTAL: "20", DIGEST_EVENT_BUDGET_STREAM: "15", DIGEST_EVENT_BUDGET_DOCS: "5" } },
  { name: "large_budget", env: { DIGEST_EVENT_BUDGET_TOTAL: "60", DIGEST_EVENT_BUDGET_STREAM: "45", DIGEST_EVENT_BUDGET_DOCS: "15" } },
  { name: "runtime_conservative", env: { BENCH_RUNTIME_POLICY_PROFILE: "conservative" } },
  { name: "runtime_document_heavy", env: { BENCH_RUNTIME_POLICY_PROFILE: "document-heavy" } },
  {
    name: "runtime_conservative_long_form",
    env: {
      BENCH_RUNTIME_POLICY_PROFILE: "conservative",
      BENCH_RUNTIME_PROMOTE_LONG_FORM: "true",
      BENCH_RUNTIME_RECALL_LIMIT: "8"
    }
  },
  {
    name: "runtime_candidate_digest",
    env: {
      BENCH_RUNTIME_POLICY_PROFILE: "default",
      BENCH_RUNTIME_DIGEST_ON_CANDIDATE: "true"
    }
  }
];

function runCase(entry) {
  const env = { ...process.env, ...baseEnv, ...entry.env };
  const result = spawnSync("node", ["scripts/benchmark/run-benchmark.mjs"], {
    cwd: root,
    env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`ablation_failed:${entry.name}`);
  }
}

function latestBenchmarkJson() {
  const files = readdirSync(outDir)
    .filter((name) => name.startsWith("benchmark-") && name.endsWith(".json"))
    .map((name) => ({ name, mtime: statSync(path.join(outDir, name)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
  const latest = files[files.length - 1];
  if (!latest) throw new Error("missing_benchmark_json");
  return path.join(outDir, latest.name);
}

function collectSummary(jsonPath) {
  const raw = readFileSync(jsonPath, "utf8");
  const data = JSON.parse(raw);
  const runtimeOverrides = data.metrics?.runtime?.overrides ?? {};
  return {
    name: data.config?.ablationName || "unknown",
    overall: data.scores?.overall ?? 0,
    reliability: data.scores?.reliability ?? 0,
    ingest: data.scores?.ingest ?? 0,
    retrieve: data.scores?.retrieve ?? 0,
    digest: data.scores?.digest ?? 0,
    reminder: data.scores?.reminder ?? 0,
    runtimeSuccess: data.metrics?.runtime?.success ?? 0,
    runtimeRuns: data.metrics?.runtime?.runs ?? 0,
    runtimeEvidenceCoverageRate: data.metrics?.runtime?.evidenceCoverageRate ?? 0,
    runtimeEvidenceDigestSummaryRate: data.metrics?.runtime?.evidenceDigestSummaryRate ?? 0,
    runtimeEvidenceEventSnippetRate: data.metrics?.runtime?.evidenceEventSnippetRate ?? 0,
    runtimeEvidenceStateSummaryRate: data.metrics?.runtime?.evidenceStateSummaryRate ?? 0,
    runtimeDigestTriggerRate: data.metrics?.runtime?.digestTriggerRate ?? 0,
    runtimePolicyProfile: data.metrics?.runtime?.policyProfile ?? data.config?.runtimePolicyProfile ?? "default",
    runtimeOverrides: {
      recallLimit: runtimeOverrides.recallLimit ?? null,
      promoteLongFormToDocumented: Boolean(runtimeOverrides.promoteLongFormToDocumented),
      digestOnCandidate: Boolean(runtimeOverrides.digestOnCandidate)
    },
    file: path.basename(jsonPath)
  };
}

function roundDelta(value) {
  return Math.round(value * 1000) / 1000;
}

function compareAgainstBaseline(baseline, item) {
  return {
    overall: roundDelta((item.overall ?? 0) - (baseline.overall ?? 0)),
    reliability: roundDelta((item.reliability ?? 0) - (baseline.reliability ?? 0)),
    runtimeEvidenceCoverageRate: roundDelta((item.runtimeEvidenceCoverageRate ?? 0) - (baseline.runtimeEvidenceCoverageRate ?? 0)),
    runtimeEvidenceDigestSummaryRate: roundDelta((item.runtimeEvidenceDigestSummaryRate ?? 0) - (baseline.runtimeEvidenceDigestSummaryRate ?? 0)),
    runtimeEvidenceEventSnippetRate: roundDelta((item.runtimeEvidenceEventSnippetRate ?? 0) - (baseline.runtimeEvidenceEventSnippetRate ?? 0)),
    runtimeEvidenceStateSummaryRate: roundDelta((item.runtimeEvidenceStateSummaryRate ?? 0) - (baseline.runtimeEvidenceStateSummaryRate ?? 0)),
    runtimeDigestTriggerRate: roundDelta((item.runtimeDigestTriggerRate ?? 0) - (baseline.runtimeDigestTriggerRate ?? 0))
  };
}

function summarizeDeltas(cases) {
  const baseline = cases.find((item) => item.name === "baseline");
  if (!baseline) return null;
  const compared = cases
    .filter((item) => item.name !== baseline.name)
    .map((item) => ({
      name: item.name,
      runtimePolicyProfile: item.runtimePolicyProfile,
      runtimeOverrides: item.runtimeOverrides,
      deltas: compareAgainstBaseline(baseline, item)
    }));

  if (!compared.length) {
    return {
      baseline: baseline.name,
      bestReliability: null,
      worstReliability: null,
      bestRuntimeEvidenceCoverage: null,
      worstRuntimeEvidenceCoverage: null
    };
  }

  const byMetric = (metric, direction) =>
    [...compared].sort((a, b) =>
      direction === "desc" ? (b.deltas[metric] ?? 0) - (a.deltas[metric] ?? 0) : (a.deltas[metric] ?? 0) - (b.deltas[metric] ?? 0)
    )[0] ?? null;

  return {
    baseline: baseline.name,
    bestReliability: byMetric("reliability", "desc"),
    worstReliability: byMetric("reliability", "asc"),
    bestRuntimeEvidenceCoverage: byMetric("runtimeEvidenceCoverageRate", "desc"),
    worstRuntimeEvidenceCoverage: byMetric("runtimeEvidenceCoverageRate", "asc")
  };
}

function formatDelta(value) {
  const normalized = Number.isFinite(value) ? value : 0;
  return normalized > 0 ? `+${normalized}` : `${normalized}`;
}

function formatDeltaEntry(label, entry, metric) {
  if (!entry) return `- ${label}: none`;
  return `- ${label}: ${entry.name} (${metric} ${formatDelta(entry.deltas[metric])}, profile ${entry.runtimePolicyProfile}, overrides recallLimit=${entry.runtimeOverrides.recallLimit ?? "default"}, promoteLongForm=${entry.runtimeOverrides.promoteLongFormToDocumented ? "yes" : "no"}, digestOnCandidate=${entry.runtimeOverrides.digestOnCandidate ? "yes" : "no"})`;
}

const summaries = [];
for (const entry of matrix) {
  process.env.ABLATION_NAME = entry.name;
  const env = { ...process.env, ...baseEnv, ...entry.env, ABLATION_NAME: entry.name };
  const result = spawnSync("node", ["scripts/benchmark/run-benchmark.mjs"], {
    cwd: root,
    env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`ablation_failed:${entry.name}`);
  }
  const jsonPath = latestBenchmarkJson();
  const summary = collectSummary(jsonPath);
  summary.name = entry.name;
  summaries.push(summary);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = path.join(outDir, `ablation-${stamp}.md`);
const jsonPath = path.join(outDir, `ablation-${stamp}.json`);
const deltaSummary = summarizeDeltas(summaries);
const report = {
  generatedAt: new Date().toISOString(),
  config: {
    seed: baseEnv.BENCH_SEED,
    fixture: baseEnv.BENCH_FIXTURE,
    profile: baseEnv.BENCH_PROFILE
  },
  deltaSummary,
  cases: summaries
};
const lines = [
  "# Ablation Summary",
  "",
  `Seed: ${baseEnv.BENCH_SEED}`,
  `Fixture: ${baseEnv.BENCH_FIXTURE}`,
  `Profile: ${baseEnv.BENCH_PROFILE}`,
  "",
  "## Baseline Delta Highlights",
  "",
  `- Baseline: ${deltaSummary?.baseline ?? "none"}`,
  formatDeltaEntry("Best reliability delta", deltaSummary?.bestReliability, "reliability"),
  formatDeltaEntry("Worst reliability delta", deltaSummary?.worstReliability, "reliability"),
  formatDeltaEntry("Best runtime evidence delta", deltaSummary?.bestRuntimeEvidenceCoverage, "runtimeEvidenceCoverageRate"),
  formatDeltaEntry("Worst runtime evidence delta", deltaSummary?.worstRuntimeEvidenceCoverage, "runtimeEvidenceCoverageRate"),
  "",
  "## Summary",
  "",
  ...summaries.map(
    (s) => [
      `### ${s.name}`,
      "",
      `- Overall: ${s.overall}`,
      `- Reliability: ${s.reliability}`,
      ...(s.name !== "baseline" && deltaSummary?.baseline
        ? [
            `- Baseline deltas: overall ${formatDelta(compareAgainstBaseline(summaries.find((item) => item.name === deltaSummary.baseline), s).overall)}, reliability ${formatDelta(compareAgainstBaseline(summaries.find((item) => item.name === deltaSummary.baseline), s).reliability)}, evidence ${formatDelta(compareAgainstBaseline(summaries.find((item) => item.name === deltaSummary.baseline), s).runtimeEvidenceCoverageRate)}, digest-trigger ${formatDelta(compareAgainstBaseline(summaries.find((item) => item.name === deltaSummary.baseline), s).runtimeDigestTriggerRate)}`
          ]
        : []),
      `- Component scores: ingest ${s.ingest}, retrieve ${s.retrieve}, digest ${s.digest}, reminder ${s.reminder}`,
      `- Runtime: ${s.runtimeSuccess}/${s.runtimeRuns} success, evidence ${s.runtimeEvidenceCoverageRate}, digest-trigger ${s.runtimeDigestTriggerRate}`,
      `- Runtime evidence detail: digest-summary ${s.runtimeEvidenceDigestSummaryRate}, event-snippet ${s.runtimeEvidenceEventSnippetRate}, state-summary ${s.runtimeEvidenceStateSummaryRate}`,
      `- Runtime policy profile: ${s.runtimePolicyProfile}`,
      `- Runtime overrides: recallLimit=${s.runtimeOverrides.recallLimit ?? "default"}, promoteLongForm=${s.runtimeOverrides.promoteLongFormToDocumented ? "yes" : "no"}, digestOnCandidate=${s.runtimeOverrides.digestOnCandidate ? "yes" : "no"}`,
      `- Report: ${s.file}`,
      ""
    ].join("\n")
  )
];
writeFileSync(jsonPath, JSON.stringify(report, null, 2));
writeFileSync(outPath, lines.join("\n"));
// eslint-disable-next-line no-console
console.log(`Ablation data: ${jsonPath}`);
// eslint-disable-next-line no-console
console.log(`Ablation summary: ${outPath}`);
