#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, process.env.BENCH_OUTPUT_DIR || "benchmark-results");
mkdirSync(outDir, { recursive: true });

const limit = Number(process.env.BENCH_TREND_LIMIT || 10);
const fixtureFilter = process.env.BENCH_TREND_FIXTURE || "";

function formatDelta(value) {
  const normalized = Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
  return normalized > 0 ? `+${normalized}` : `${normalized}`;
}

function latestBenchmarks() {
  return readdirSync(outDir)
    .filter((name) => name.startsWith("benchmark-") && name.endsWith(".json"))
    .map((name) => {
      const fullPath = path.join(outDir, name);
      return {
        name,
        fullPath,
        mtime: statSync(fullPath).mtimeMs
      };
    })
    .sort((a, b) => a.mtime - b.mtime)
    .slice(-Math.max(1, limit));
}

function readBenchmark(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (fixtureFilter && parsed.config?.fixture !== fixtureFilter) return null;
    return parsed;
  } catch {
    return null;
  }
}

function summarizeBenchmark(data, fileName) {
  return {
    file: fileName,
    commit: data.commit || "unknown",
    describe: data.describe || "unknown",
    fixture: data.config?.fixture || "(none)",
    profile: data.config?.profile || "unknown",
    overall: data.scores?.overall ?? 0,
    reliability: data.scores?.reliability ?? 0,
    reliabilityBreakdown: {
      consistency: data.scores?.reliabilityBreakdown?.consistency ?? 0,
      retention: data.scores?.reliabilityBreakdown?.retention ?? 0,
      contradictionControl: data.scores?.reliabilityBreakdown?.contradictionControl ?? 0,
      replay: data.scores?.reliabilityBreakdown?.replay ?? 0,
      runtimeGrounding: data.scores?.reliabilityBreakdown?.runtimeGrounding ?? 0
    },
    digestConsistency: data.metrics?.digest?.consistencyPassRate ?? 0,
    runtimeEvidenceCoverage: data.metrics?.runtime?.evidenceCoverageRate ?? 0,
    runtimeDigestSummaryRate: data.metrics?.runtime?.evidenceDigestSummaryRate ?? 0,
    replayStateMatch: Boolean(data.metrics?.replay?.stateMatch),
    startedAt: data.startedAt || null
  };
}

function buildDeltaSummary(items) {
  if (items.length < 2) return null;
  const first = items[0];
  const last = items[items.length - 1];
  return {
    from: first.file,
    to: last.file,
    overall: Math.round((last.overall - first.overall) * 1000) / 1000,
    reliability: Math.round((last.reliability - first.reliability) * 1000) / 1000,
    consistency: Math.round((last.reliabilityBreakdown.consistency - first.reliabilityBreakdown.consistency) * 1000) / 1000,
    retention: Math.round((last.reliabilityBreakdown.retention - first.reliabilityBreakdown.retention) * 1000) / 1000,
    contradictionControl: Math.round((last.reliabilityBreakdown.contradictionControl - first.reliabilityBreakdown.contradictionControl) * 1000) / 1000,
    replay: Math.round((last.reliabilityBreakdown.replay - first.reliabilityBreakdown.replay) * 1000) / 1000,
    runtimeGrounding: Math.round((last.reliabilityBreakdown.runtimeGrounding - first.reliabilityBreakdown.runtimeGrounding) * 1000) / 1000,
    digestConsistency: Math.round((last.digestConsistency - first.digestConsistency) * 1000) / 1000,
    runtimeEvidenceCoverage: Math.round((last.runtimeEvidenceCoverage - first.runtimeEvidenceCoverage) * 1000) / 1000
  };
}

const benchmarks = latestBenchmarks()
  .map((entry) => {
    const parsed = readBenchmark(entry.fullPath);
    return parsed ? summarizeBenchmark(parsed, entry.name) : null;
  })
  .filter(Boolean);

if (!benchmarks.length) {
  throw new Error("missing_benchmark_inputs");
}

const deltaSummary = buildDeltaSummary(benchmarks);
const latest = benchmarks[benchmarks.length - 1];
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = path.join(outDir, `trend-${stamp}.json`);
const mdPath = path.join(outDir, `trend-${stamp}.md`);

const report = {
  generatedAt: new Date().toISOString(),
  config: {
    limit,
    fixtureFilter: fixtureFilter || null
  },
  latest,
  deltaSummary,
  series: benchmarks
};

const md = [
  "# Benchmark Trend Report",
  "",
  `- Window: ${benchmarks.length} benchmark run(s)`,
  `- Fixture filter: ${fixtureFilter || "none"}`,
  `- Latest report: ${latest.file}`,
  "",
  "## Latest Snapshot",
  "",
  `- Commit: ${latest.commit}`,
  `- Describe: ${latest.describe}`,
  `- Fixture: ${latest.fixture}`,
  `- Profile: ${latest.profile}`,
  `- Overall: ${latest.overall}`,
  `- Reliability: ${latest.reliability}`,
  `- Reliability breakdown: consistency ${latest.reliabilityBreakdown.consistency}, retention ${latest.reliabilityBreakdown.retention}, contradiction control ${latest.reliabilityBreakdown.contradictionControl}, replay ${latest.reliabilityBreakdown.replay}, runtime grounding ${latest.reliabilityBreakdown.runtimeGrounding}`,
  `- Digest consistency: ${latest.digestConsistency}`,
  `- Runtime evidence coverage: ${latest.runtimeEvidenceCoverage}`,
  `- Runtime digest summary rate: ${latest.runtimeDigestSummaryRate}`,
  `- Replay state match: ${latest.replayStateMatch ? "yes" : "no"}`,
  "",
  "## Window Delta",
  "",
  ...(deltaSummary
    ? [
        `- Range: ${deltaSummary.from} -> ${deltaSummary.to}`,
        `- Overall delta: ${formatDelta(deltaSummary.overall)}`,
        `- Reliability delta: ${formatDelta(deltaSummary.reliability)}`,
        `- Reliability breakdown delta: consistency ${formatDelta(deltaSummary.consistency)}, retention ${formatDelta(deltaSummary.retention)}, contradiction control ${formatDelta(deltaSummary.contradictionControl)}, replay ${formatDelta(deltaSummary.replay)}, runtime grounding ${formatDelta(deltaSummary.runtimeGrounding)}`,
        `- Digest consistency delta: ${formatDelta(deltaSummary.digestConsistency)}`,
        `- Runtime evidence coverage delta: ${formatDelta(deltaSummary.runtimeEvidenceCoverage)}`
      ]
    : ["- Not enough benchmark runs to compute a delta window."]),
  "",
  "## Series",
  "",
  ...benchmarks.map((item) =>
    [
      `### ${item.file}`,
      "",
      `- Commit: ${item.commit}`,
      `- Fixture: ${item.fixture}`,
      `- Profile: ${item.profile}`,
      `- Overall: ${item.overall}`,
      `- Reliability: ${item.reliability}`,
      `- Reliability breakdown: consistency ${item.reliabilityBreakdown.consistency}, retention ${item.reliabilityBreakdown.retention}, contradiction control ${item.reliabilityBreakdown.contradictionControl}, replay ${item.reliabilityBreakdown.replay}, runtime grounding ${item.reliabilityBreakdown.runtimeGrounding}`,
      `- Digest consistency: ${item.digestConsistency}`,
      `- Runtime evidence coverage: ${item.runtimeEvidenceCoverage}`,
      `- Runtime digest summary rate: ${item.runtimeDigestSummaryRate}`,
      `- Replay state match: ${item.replayStateMatch ? "yes" : "no"}`,
      `- Started: ${item.startedAt || "unknown"}`,
      ""
    ].join("\n")
  )
].join("\n");

writeFileSync(jsonPath, JSON.stringify(report, null, 2));
writeFileSync(mdPath, md);
// eslint-disable-next-line no-console
console.log(`Trend data: ${jsonPath}`);
// eslint-disable-next-line no-console
console.log(`Trend summary: ${mdPath}`);
