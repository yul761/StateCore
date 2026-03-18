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
    model: {
      provider: data.environment?.model?.provider || "unknown",
      name: data.environment?.model?.model || "unknown",
      baseUrl: data.environment?.model?.baseUrl || "unknown"
    },
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
    digestOmissionWarningRate: data.metrics?.digest?.omissionWarningRate ?? 0,
    digestDriftRate: data.metrics?.digest?.goldRetention?.digestDriftRate ?? 0,
    stateDriftRate: data.metrics?.digest?.goldRetention?.stateDriftRate ?? 0,
    temporaryTodoIntrusionRate: data.metrics?.digest?.goldRetention?.temporaryTodoIntrusionRate ?? 0,
    latestDocumentRetentionRate: data.metrics?.digest?.goldRetention?.latestDocumentRetentionRate ?? 0,
    stateLatestDocumentRetentionRate: data.metrics?.digest?.goldRetention?.stateLatestDocumentRetentionRate ?? 0,
    supersededDocumentIntrusionRate: data.metrics?.digest?.goldRetention?.supersededDocumentIntrusionRate ?? 0,
    stateSupersededDocumentIntrusionRate: data.metrics?.digest?.goldRetention?.stateSupersededDocumentIntrusionRate ?? 0,
    stateFactRetentionRate: data.metrics?.digest?.goldRetention?.stateFactRetentionRate ?? 0,
    stateGoalRetentionRate: data.metrics?.digest?.goldRetention?.stateGoalRetentionRate ?? 0,
    stateConstraintPreservationRate: data.metrics?.digest?.goldRetention?.stateConstraintPreservationRate ?? 0,
    stateDecisionContinuityRate: data.metrics?.digest?.goldRetention?.stateDecisionContinuityRate ?? 0,
    stateTodoContinuityRate: data.metrics?.digest?.goldRetention?.stateTodoContinuityRate ?? 0,
    runtimeEvidenceCoverage: data.metrics?.runtime?.evidenceCoverageRate ?? 0,
    runtimeDigestSummaryRate: data.metrics?.runtime?.evidenceDigestSummaryRate ?? 0,
    runtimeStateProvenanceRate: data.metrics?.runtime?.evidenceStateProvenanceRate ?? 0,
    runtimeRecentStateChangesRate: data.metrics?.runtime?.evidenceRecentStateChangesRate ?? 0,
    replayRebuildConsistencyRate: data.metrics?.replay?.rebuildConsistencyRate ?? 0,
    replayCrossRunStateDivergenceRate: data.metrics?.replay?.crossRunStateDivergenceRate ?? 0,
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
    digestOmissionWarningRate: Math.round((last.digestOmissionWarningRate - first.digestOmissionWarningRate) * 1000) / 1000,
    digestDriftRate: Math.round((last.digestDriftRate - first.digestDriftRate) * 1000) / 1000,
    stateDriftRate: Math.round((last.stateDriftRate - first.stateDriftRate) * 1000) / 1000,
    temporaryTodoIntrusionRate: Math.round((last.temporaryTodoIntrusionRate - first.temporaryTodoIntrusionRate) * 1000) / 1000,
    latestDocumentRetentionRate: Math.round((last.latestDocumentRetentionRate - first.latestDocumentRetentionRate) * 1000) / 1000,
    supersededDocumentIntrusionRate: Math.round((last.supersededDocumentIntrusionRate - first.supersededDocumentIntrusionRate) * 1000) / 1000,
    stateFactRetentionRate: Math.round((last.stateFactRetentionRate - first.stateFactRetentionRate) * 1000) / 1000,
    runtimeEvidenceCoverage: Math.round((last.runtimeEvidenceCoverage - first.runtimeEvidenceCoverage) * 1000) / 1000,
    runtimeStateProvenanceRate: Math.round((last.runtimeStateProvenanceRate - first.runtimeStateProvenanceRate) * 1000) / 1000,
    runtimeRecentStateChangesRate: Math.round((last.runtimeRecentStateChangesRate - first.runtimeRecentStateChangesRate) * 1000) / 1000,
    replayRebuildConsistencyRate: Math.round((last.replayRebuildConsistencyRate - first.replayRebuildConsistencyRate) * 1000) / 1000,
    replayCrossRunStateDivergenceRate: Math.round((last.replayCrossRunStateDivergenceRate - first.replayCrossRunStateDivergenceRate) * 1000) / 1000
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
  `- Model provider: ${latest.model.provider}, model ${latest.model.name}, base ${latest.model.baseUrl}`,
  `- Overall: ${latest.overall}`,
  `- Reliability: ${latest.reliability}`,
  `- Reliability breakdown: consistency ${latest.reliabilityBreakdown.consistency}, retention ${latest.reliabilityBreakdown.retention}, contradiction control ${latest.reliabilityBreakdown.contradictionControl}, replay ${latest.reliabilityBreakdown.replay}, runtime grounding ${latest.reliabilityBreakdown.runtimeGrounding}`,
  `- Digest consistency: ${latest.digestConsistency}`,
  `- Digest omission warning rate: ${latest.digestOmissionWarningRate}`,
  `- Drift rates: digest ${latest.digestDriftRate}, state ${latest.stateDriftRate}`,
  `- Latest document retention: digest ${latest.latestDocumentRetentionRate}, state ${latest.stateLatestDocumentRetentionRate}`,
  `- Intrusion rates: temporary todos ${latest.temporaryTodoIntrusionRate}, superseded docs digest ${latest.supersededDocumentIntrusionRate}, superseded docs state ${latest.stateSupersededDocumentIntrusionRate}`,
  `- State retention: fact ${latest.stateFactRetentionRate}, goal ${latest.stateGoalRetentionRate}, constraints ${latest.stateConstraintPreservationRate}, decisions ${latest.stateDecisionContinuityRate}, todos ${latest.stateTodoContinuityRate}`,
  `- Runtime evidence coverage: ${latest.runtimeEvidenceCoverage}`,
  `- Runtime digest summary rate: ${latest.runtimeDigestSummaryRate}`,
  `- Runtime state-provenance rate: ${latest.runtimeStateProvenanceRate}`,
  `- Runtime recent-state-changes rate: ${latest.runtimeRecentStateChangesRate}`,
  `- Replay: state match ${latest.replayStateMatch ? "yes" : "no"}, rebuild consistency ${latest.replayRebuildConsistencyRate}, cross-run divergence ${latest.replayCrossRunStateDivergenceRate}`,
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
        `- Digest omission warning delta: ${formatDelta(deltaSummary.digestOmissionWarningRate)}`,
        `- Digest drift delta: ${formatDelta(deltaSummary.digestDriftRate)}`,
        `- State drift delta: ${formatDelta(deltaSummary.stateDriftRate)}`,
        `- Temporary todo intrusion delta: ${formatDelta(deltaSummary.temporaryTodoIntrusionRate)}`,
        `- Latest document retention delta: ${formatDelta(deltaSummary.latestDocumentRetentionRate)}`,
        `- Superseded document intrusion delta: ${formatDelta(deltaSummary.supersededDocumentIntrusionRate)}`,
        `- State fact retention delta: ${formatDelta(deltaSummary.stateFactRetentionRate)}`,
        `- Runtime evidence coverage delta: ${formatDelta(deltaSummary.runtimeEvidenceCoverage)}`,
        `- Runtime state-provenance delta: ${formatDelta(deltaSummary.runtimeStateProvenanceRate)}`,
        `- Runtime recent-state-changes delta: ${formatDelta(deltaSummary.runtimeRecentStateChangesRate)}`,
        `- Replay rebuild consistency delta: ${formatDelta(deltaSummary.replayRebuildConsistencyRate)}`,
        `- Replay cross-run divergence delta: ${formatDelta(deltaSummary.replayCrossRunStateDivergenceRate)}`
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
      `- Model provider: ${item.model.provider}, model ${item.model.name}, base ${item.model.baseUrl}`,
      `- Overall: ${item.overall}`,
      `- Reliability: ${item.reliability}`,
      `- Reliability breakdown: consistency ${item.reliabilityBreakdown.consistency}, retention ${item.reliabilityBreakdown.retention}, contradiction control ${item.reliabilityBreakdown.contradictionControl}, replay ${item.reliabilityBreakdown.replay}, runtime grounding ${item.reliabilityBreakdown.runtimeGrounding}`,
      `- Digest consistency: ${item.digestConsistency}`,
      `- Digest omission warning rate: ${item.digestOmissionWarningRate}`,
      `- Drift rates: digest ${item.digestDriftRate}, state ${item.stateDriftRate}`,
      `- Latest document retention: digest ${item.latestDocumentRetentionRate}, state ${item.stateLatestDocumentRetentionRate}`,
      `- Intrusion rates: temporary todos ${item.temporaryTodoIntrusionRate}, superseded docs digest ${item.supersededDocumentIntrusionRate}, superseded docs state ${item.stateSupersededDocumentIntrusionRate}`,
      `- State retention: fact ${item.stateFactRetentionRate}, goal ${item.stateGoalRetentionRate}, constraints ${item.stateConstraintPreservationRate}, decisions ${item.stateDecisionContinuityRate}, todos ${item.stateTodoContinuityRate}`,
      `- Runtime evidence coverage: ${item.runtimeEvidenceCoverage}`,
      `- Runtime digest summary rate: ${item.runtimeDigestSummaryRate}`,
      `- Runtime state-provenance rate: ${item.runtimeStateProvenanceRate}`,
      `- Runtime recent-state-changes rate: ${item.runtimeRecentStateChangesRate}`,
      `- Replay: state match ${item.replayStateMatch ? "yes" : "no"}, rebuild consistency ${item.replayRebuildConsistencyRate}, cross-run divergence ${item.replayCrossRunStateDivergenceRate}`,
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
