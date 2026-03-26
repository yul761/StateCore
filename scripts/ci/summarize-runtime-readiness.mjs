#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const doctorPath = process.argv[2] || "runtime-doctor.json";
const benchmarkPath = process.argv[3] || "runtime-benchmark.json";
const driftPath = process.argv[4] || "runtime-drift.json";
const summaryJsonPath = process.argv[5] || "runtime-readiness-summary.json";
const summaryMdPath = process.argv[6] || "runtime-readiness-summary.md";

const doctor = loadJson(doctorPath);
const benchmark = loadJson(benchmarkPath);
const drift = loadJson(driftPath);

const runtime = benchmark.metrics?.runtime || {};
const summary = {
  generatedAt: new Date().toISOString(),
  doctor: {
    diagnosisStatus: doctor.diagnosisStatus || "unknown",
    answerMode: doctor.runtimeProbe?.answerMode || null,
    fastPathReady: doctor.layerAlignment?.fastPathReady ?? null,
    goalAligned: doctor.layerAlignment?.goalAligned ?? null,
    warnings: doctor.layerWarnings || [],
    freshness: doctor.layerFreshness || null
  },
  benchmark: {
    fixture: benchmark.fixture?.source || benchmark.fixture?.name || benchmark.fixture || null,
    overall: benchmark.scores?.overall ?? null,
    reliability: benchmark.scores?.reliability ?? null,
    fastPathAvgLatencyMs: runtime.fastPathAvgLatencyMs ?? null,
    workingMemoryUpdateAvgLatencyMs: runtime.workingMemoryUpdateAvgLatencyMs ?? null,
    stableStateUpdateAvgLatencyMs: runtime.stableStateUpdateAvgLatencyMs ?? null,
    directStateFastPathRate: runtime.directStateFastPathRate ?? null,
    runtimeLayerStatusConsistencyRate: runtime.runtimeLayerStatusConsistencyRate ?? null,
    workingMemoryCaughtUpRate: runtime.layerStatusWorkingMemoryCaughtUpRate ?? null,
    stableStateCaughtUpRate: runtime.layerStatusStableStateCaughtUpRate ?? null
  },
  drift: {
    fixture: drift.config?.fixture || null,
    runs: drift.summary?.runs ?? null,
    success: drift.summary?.success ?? null,
    avgRecall: drift.summary?.avgRecall ?? null,
    goalDriftRate: drift.summary?.goalDriftRate ?? null,
    constraintDriftRate: drift.summary?.constraintDriftRate ?? null,
    decisionDriftRate: drift.summary?.decisionDriftRate ?? null,
    todoDriftRate: drift.summary?.todoDriftRate ?? null,
    digestDriftRate: drift.summary?.digestDriftRate ?? null,
    temporaryTodoIntrusionRate: drift.summary?.temporaryTodoIntrusionRate ?? null,
    status: drift.summary?.status || null
  }
};

writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);

const lines = [
  "# Runtime Readiness Summary",
  "",
  `- Generated: ${summary.generatedAt}`,
  "",
  "## Doctor",
  "",
  `- Diagnosis status: ${summary.doctor.diagnosisStatus}`,
  `- Answer mode: ${summary.doctor.answerMode ?? "(none)"}`,
  `- Fast path ready: ${summary.doctor.fastPathReady}`,
  `- Goal aligned: ${summary.doctor.goalAligned}`,
  `- Warning count: ${(summary.doctor.warnings || []).length}`,
  "",
  "## Benchmark",
  "",
  `- Overall score: ${summary.benchmark.overall}`,
  `- Reliability: ${summary.benchmark.reliability}`,
  `- Fast path avg latency: ${summary.benchmark.fastPathAvgLatencyMs} ms`,
  `- Working Memory update avg latency: ${summary.benchmark.workingMemoryUpdateAvgLatencyMs} ms`,
  `- State Layer update avg latency: ${summary.benchmark.stableStateUpdateAvgLatencyMs} ms`,
  `- direct-state fast-path rate: ${summary.benchmark.directStateFastPathRate}`,
  `- runtime/layer-status consistency rate: ${summary.benchmark.runtimeLayerStatusConsistencyRate}`,
  `- Working Memory caught-up rate: ${summary.benchmark.workingMemoryCaughtUpRate}`,
  `- Stable State caught-up rate: ${summary.benchmark.stableStateCaughtUpRate}`,
  "",
  "## Drift",
  "",
  `- Runs: ${summary.drift.success}/${summary.drift.runs}`,
  `- Avg recall: ${summary.drift.avgRecall}`,
  `- Goal drift: ${summary.drift.goalDriftRate}`,
  `- Constraint drift: ${summary.drift.constraintDriftRate}`,
  `- Decision drift: ${summary.drift.decisionDriftRate}`,
  `- Todo drift: ${summary.drift.todoDriftRate}`,
  `- Digest drift: ${summary.drift.digestDriftRate}`,
  `- Temporary todo intrusion: ${summary.drift.temporaryTodoIntrusionRate}`,
  `- Status: ${summary.drift.status}`
];

writeFileSync(summaryMdPath, `${lines.join("\n")}\n`);
