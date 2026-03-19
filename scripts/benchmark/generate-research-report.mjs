#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, process.env.BENCH_OUTPUT_DIR || "benchmark-results");
mkdirSync(outDir, { recursive: true });

function latestFile(prefix, suffix) {
  const files = readdirSync(outDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => ({ name, mtime: statSync(path.join(outDir, name)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
  return files[files.length - 1]?.name ?? null;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function formatTopAblations(cases = []) {
  return [...cases]
    .sort((a, b) => (b.reliability ?? 0) - (a.reliability ?? 0))
    .slice(0, 3)
    .map((item) => `- ${item.name}: reliability ${item.reliability}, overall ${item.overall}, runtime profile ${item.runtimePolicyProfile}, overrides ${formatOverrideSummary(item.runtimeOverrides)}`)
    .join("\n");
}

function formatOverrideSummary(overrides = {}) {
  return `recallLimit=${overrides.recallLimit ?? "default"}, promoteLongForm=${overrides.promoteLongFormToDocumented ? "yes" : "no"}, digestOnCandidate=${overrides.digestOnCandidate ? "yes" : "no"}`;
}

function formatDelta(value) {
  const normalized = Number.isFinite(value) ? value : 0;
  return normalized > 0 ? `+${normalized}` : `${normalized}`;
}

function formatDeltaHighlight(label, entry, metric) {
  if (!entry) return `- ${label}: none`;
  return `- ${label}: ${entry.name} (${metric} ${formatDelta(entry.deltas?.[metric] ?? 0)}, profile ${entry.runtimePolicyProfile}, overrides ${formatOverrideSummary(entry.runtimeOverrides)})`;
}

function formatRuntimeComparisons(cases = []) {
  const runtimeCases = cases.filter((item) => item.name.startsWith("runtime_"));
  if (!runtimeCases.length) return "- none";
  return runtimeCases
    .map((item) =>
      `- ${item.name}: success ${item.runtimeSuccess}/${item.runtimeRuns}, evidence ${item.runtimeEvidenceCoverageRate}, digest-summary ${item.runtimeEvidenceDigestSummaryRate ?? 0}, event-snippet ${item.runtimeEvidenceEventSnippetRate ?? 0}, ranking-reason ${item.runtimeEvidenceEventRankingReasonRate ?? 0}, event-score ${item.runtimeEvidenceEventScoreRate ?? 0}, embedding-reason ${item.runtimeEvidenceEventEmbeddingReasonRate ?? 0}, document-source ${item.runtimeEvidenceEventDocumentSourceRate ?? 0}, state-summary ${item.runtimeEvidenceStateSummaryRate ?? 0}, state-confidence ${item.runtimeEvidenceStateConfidenceRate ?? 0}, state-transition-taxonomy ${item.runtimeEvidenceStateTransitionTaxonomyRate ?? 0}, digest-trigger ${item.runtimeDigestTriggerRate}, reliability ${item.reliability}, profile ${item.runtimePolicyProfile}, overrides ${formatOverrideSummary(item.runtimeOverrides)}`
    )
    .join("\n");
}

function formatGroundedResponseComparisons(cases = []) {
  const groundedCases = cases.filter((item) => item.name === "baseline" || item.name.startsWith("runtime_"));
  if (!groundedCases.length) return "- none";
  return groundedCases
    .map((item) =>
      `- ${item.name}: grounded evidence ${item.groundedResponseEvidenceCoverageRate ?? 0}, ranking-reason ${item.groundedResponseRankingReasonRate ?? 0}, event-score ${item.groundedResponseEventScoreRate ?? 0}, state-summary ${item.groundedResponseStateSummaryRate ?? 0}, state-confidence ${item.groundedResponseStateConfidenceRate ?? 0}, state-transition-taxonomy ${item.groundedResponseStateTransitionTaxonomyRate ?? 0}, answer evidence ${item.answerEvidenceCoverageRate ?? 0}, runtime evidence ${item.runtimeEvidenceCoverageRate ?? 0}, profile ${item.runtimePolicyProfile}, overrides ${formatOverrideSummary(item.runtimeOverrides)}`
    )
    .join("\n");
}

const benchmarkName = process.env.RESEARCH_BENCHMARK_JSON || latestFile("benchmark-", ".json");
if (!benchmarkName) {
  throw new Error("missing_benchmark_json");
}
const benchmarkPath = path.isAbsolute(benchmarkName) ? benchmarkName : path.join(outDir, benchmarkName);
if (!existsSync(benchmarkPath)) {
  throw new Error(`benchmark_not_found:${benchmarkPath}`);
}

const ablationName = process.env.RESEARCH_ABLATION_JSON || latestFile("ablation-", ".json");
const ablationPath = ablationName ? (path.isAbsolute(ablationName) ? ablationName : path.join(outDir, ablationName)) : null;
const trendName = process.env.RESEARCH_TREND_JSON || latestFile("trend-", ".json");
const trendPath = trendName ? (path.isAbsolute(trendName) ? trendName : path.join(outDir, trendName)) : null;

const benchmark = readJsonFile(benchmarkPath);
const ablation = ablationPath && existsSync(ablationPath) ? readJsonFile(ablationPath) : null;
const trend = trendPath && existsSync(trendPath) ? readJsonFile(trendPath) : null;

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(outDir, `research-report-${stamp}.md`);

const lines = [
  "# Research Report Draft",
  "",
  "## Title",
  `${benchmark.config?.ablationName ? `Ablation analysis for ${benchmark.config.ablationName}` : "Long-term memory benchmark analysis"}`,
  "",
  "## Abstract",
  `This draft summarizes a benchmark run using fixture \`${benchmark.config?.fixture || "(none)"}\` under profile \`${benchmark.config?.profile || "unknown"}\`. The run produced an overall score of **${benchmark.scores?.overall ?? 0}** and a long-term memory reliability score of **${benchmark.scores?.reliability ?? 0}**.`,
  ablation
    ? `An accompanying ablation sweep is available and highlights the strongest variants by reliability, with runtime policy profile comparisons included.`
    : "No ablation summary was provided for this draft.",
  "",
  "## Methods",
  `- Commit: \`${benchmark.commit || "unknown"}\``,
  `- Benchmark JSON: \`${path.basename(benchmarkPath)}\``,
  `- Environment: Node ${benchmark.environment?.node || "unknown"}, ${benchmark.environment?.platform || "unknown"}/${benchmark.environment?.arch || "unknown"}`,
  `- Model provider: ${benchmark.environment?.model?.provider || "unknown"}, model ${benchmark.environment?.model?.model || "unknown"}, base ${benchmark.environment?.model?.baseUrl || "unknown"}`,
  `- Model roles: chat ${benchmark.environment?.model?.chatModel || benchmark.environment?.model?.model || "unknown"}, structured ${benchmark.environment?.model?.structuredOutputModel || benchmark.environment?.model?.model || "unknown"}, embedding ${benchmark.environment?.model?.embeddingModel || "disabled"}`,
  `- Benchmark config: seed ${benchmark.config?.seed ?? "unknown"}, fixture \`${benchmark.config?.fixture || "(none)"}\`, profile \`${benchmark.config?.profile || "unknown"}\``,
  `- Runtime policy profile: \`${benchmark.metrics?.runtime?.policyProfile || benchmark.config?.runtimePolicyProfile || "default"}\``,
  `- Runtime overrides: ${formatOverrideSummary(benchmark.metrics?.runtime?.overrides || {})}`,
  ...(ablation ? [`- Ablation JSON: \`${path.basename(ablationPath)}\``] : []),
  ...(trend ? [`- Trend JSON: \`${path.basename(trendPath)}\``] : []),
  "",
  "## Results",
  `- Scores: overall ${benchmark.scores?.overall ?? 0}, reliability ${benchmark.scores?.reliability ?? 0}, ingest ${benchmark.scores?.ingest ?? 0}, retrieve ${benchmark.scores?.retrieve ?? 0}, digest ${benchmark.scores?.digest ?? 0}, reminder ${benchmark.scores?.reminder ?? 0}`,
  `- Retrieve metrics: mode ${benchmark.metrics?.retrieve?.mode ?? "heuristic"}, retrieve limit ${benchmark.metrics?.retrieve?.limit ?? 20}, hit ${benchmark.metrics?.retrieve?.hitRate ?? 0}, strict ${benchmark.metrics?.retrieve?.strictHitRate ?? 0}, explainability ${benchmark.metrics?.retrieve?.explainabilityRate ?? 0}, reranked ${benchmark.metrics?.retrieve?.rerankedRate ?? 0}, embedding-top-match ${benchmark.metrics?.retrieve?.embeddingTopMatchRate ?? 0}, document-top-match ${benchmark.metrics?.retrieve?.documentTopMatchRate ?? 0}, source-diversity ${benchmark.metrics?.retrieve?.sourceDiversityRate ?? 0}, embedding requested ${benchmark.metrics?.retrieve?.embeddingRequested ? "yes" : "no"}, embedding configured ${benchmark.metrics?.retrieve?.embeddingConfigured ? "yes" : "no"}, candidate limit ${benchmark.metrics?.retrieve?.embeddingCandidateLimit ?? "default"}, embedding model ${benchmark.metrics?.retrieve?.embeddingModel || "none"}`,
  `- Reliability breakdown: consistency ${benchmark.scores?.reliabilityBreakdown?.consistency ?? 0}, retention ${benchmark.scores?.reliabilityBreakdown?.retention ?? 0}, contradiction control ${benchmark.scores?.reliabilityBreakdown?.contradictionControl ?? 0}, replay ${benchmark.scores?.reliabilityBreakdown?.replay ?? 0}, runtime grounding ${benchmark.scores?.reliabilityBreakdown?.runtimeGrounding ?? 0}`,
  `- Digest metrics: success ${benchmark.metrics?.digest?.success ?? 0}/${benchmark.metrics?.digest?.runs ?? 0}, consistency ${benchmark.metrics?.digest?.consistencyPassRate ?? 0}, repeatability ${benchmark.metrics?.digest?.repeatabilityRate ?? 0}, omission warning rate ${benchmark.metrics?.digest?.omissionWarningRate ?? 0}, temporary todo intrusion ${benchmark.metrics?.digest?.goldRetention?.temporaryTodoIntrusionRate ?? 0}, avg latency ${benchmark.metrics?.digest?.avgLatencyMs ?? 0} ms`,
  `- Retention metrics: fact ${benchmark.metrics?.digest?.goldRetention?.factRetentionRate ?? 0}, goal ${benchmark.metrics?.digest?.goldRetention?.goalRetentionRate ?? 0}, constraints ${benchmark.metrics?.digest?.goldRetention?.constraintPreservationRate ?? 0}, decisions ${benchmark.metrics?.digest?.goldRetention?.decisionContinuityRate ?? 0}, todos ${benchmark.metrics?.digest?.goldRetention?.todoContinuityRate ?? 0}`,
  `- Working-note retention: open-questions ${benchmark.metrics?.digest?.goldRetention?.openQuestionContinuityRate ?? 0}, risks ${benchmark.metrics?.digest?.goldRetention?.riskContinuityRate ?? 0}, state open-questions ${benchmark.metrics?.digest?.goldRetention?.stateOpenQuestionContinuityRate ?? 0}, state risks ${benchmark.metrics?.digest?.goldRetention?.stateRiskContinuityRate ?? 0}`,
  `- State retention metrics: fact ${benchmark.metrics?.digest?.goldRetention?.stateFactRetentionRate ?? 0}, goal ${benchmark.metrics?.digest?.goldRetention?.stateGoalRetentionRate ?? 0}, constraints ${benchmark.metrics?.digest?.goldRetention?.stateConstraintPreservationRate ?? 0}, decisions ${benchmark.metrics?.digest?.goldRetention?.stateDecisionContinuityRate ?? 0}, todos ${benchmark.metrics?.digest?.goldRetention?.stateTodoContinuityRate ?? 0}`,
  `- Drift rates: digest ${benchmark.metrics?.digest?.goldRetention?.digestDriftRate ?? 0}, state ${benchmark.metrics?.digest?.goldRetention?.stateDriftRate ?? 0}`,
  `- Latest document retention: digest ${benchmark.metrics?.digest?.goldRetention?.latestDocumentRetentionRate ?? 0}, state ${benchmark.metrics?.digest?.goldRetention?.stateLatestDocumentRetentionRate ?? 0}`,
  `- Replay metrics: state match ${benchmark.metrics?.replay?.stateMatch ? "yes" : "no"}, rebuild consistency ${benchmark.metrics?.replay?.rebuildConsistencyRate ?? 0}, cross-run divergence ${benchmark.metrics?.replay?.crossRunStateDivergenceRate ?? 0}, successful rebuilds ${benchmark.metrics?.replay?.successfulRuns ?? 0}/${benchmark.metrics?.replay?.rebuildRuns ?? 0}, rebuild snapshots ${benchmark.metrics?.replay?.rebuildSnapshots ?? 0}`,
  `- Replay transition metrics: match ${benchmark.metrics?.replay?.transitionTaxonomyMatchRate ?? 0}, cross-run divergence ${benchmark.metrics?.replay?.crossRunTransitionDivergenceRate ?? 0}, taxonomy ${Object.entries(benchmark.metrics?.replay?.transitionTaxonomy || {}).map(([name, count]) => `${name}=${count}`).join(", ") || "none"}`,
  `- Replay stability blend: ${Number((((1 - (benchmark.metrics?.replay?.crossRunStateDivergenceRate ?? 0)) * 0.5) + ((benchmark.metrics?.replay?.transitionTaxonomyMatchRate ?? 0) * 0.25) + ((1 - (benchmark.metrics?.replay?.crossRunTransitionDivergenceRate ?? 0)) * 0.25)).toFixed(3))}`,
  `- Intrusion metrics: temporary todos digest ${benchmark.metrics?.digest?.goldRetention?.temporaryTodoIntrusionRate ?? 0}, temporary todos state ${benchmark.metrics?.digest?.goldRetention?.stateTemporaryTodoIntrusionRate ?? 0}, resolved open-questions digest ${benchmark.metrics?.digest?.goldRetention?.resolvedOpenQuestionIntrusionRate ?? 0}, resolved open-questions state ${benchmark.metrics?.digest?.goldRetention?.stateResolvedOpenQuestionIntrusionRate ?? 0}, resolved risks digest ${benchmark.metrics?.digest?.goldRetention?.resolvedRiskIntrusionRate ?? 0}, resolved risks state ${benchmark.metrics?.digest?.goldRetention?.stateResolvedRiskIntrusionRate ?? 0}, superseded docs digest ${benchmark.metrics?.digest?.goldRetention?.supersededDocumentIntrusionRate ?? 0}, superseded docs state ${benchmark.metrics?.digest?.goldRetention?.stateSupersededDocumentIntrusionRate ?? 0}`,
  `- Runtime metrics: success ${benchmark.metrics?.runtime?.success ?? 0}/${benchmark.metrics?.runtime?.runs ?? 0}, evidence coverage ${benchmark.metrics?.runtime?.evidenceCoverageRate ?? 0}, digest-summary ${benchmark.metrics?.runtime?.evidenceDigestSummaryRate ?? 0}, event-snippet ${benchmark.metrics?.runtime?.evidenceEventSnippetRate ?? 0}, ranking-reason ${benchmark.metrics?.runtime?.evidenceEventRankingReasonRate ?? 0}, event-score ${benchmark.metrics?.runtime?.evidenceEventScoreRate ?? 0}, embedding-reason ${benchmark.metrics?.runtime?.evidenceEventEmbeddingReasonRate ?? 0}, document-source ${benchmark.metrics?.runtime?.evidenceEventDocumentSourceRate ?? 0}, state-summary ${benchmark.metrics?.runtime?.evidenceStateSummaryRate ?? 0}, state-provenance ${benchmark.metrics?.runtime?.evidenceStateProvenanceRate ?? 0}, state-confidence ${benchmark.metrics?.runtime?.evidenceStateConfidenceRate ?? 0}, state-transition-taxonomy ${benchmark.metrics?.runtime?.evidenceStateTransitionTaxonomyRate ?? 0}, recent-state-changes ${benchmark.metrics?.runtime?.evidenceRecentStateChangesRate ?? 0}, digest trigger ${benchmark.metrics?.runtime?.digestTriggerRate ?? 0}`,
  `- Grounded response view: success ${benchmark.metrics?.groundedResponse?.successRate ?? 0}, evidence coverage ${benchmark.metrics?.groundedResponse?.evidenceCoverageRate ?? 0}, ranking-reason ${benchmark.metrics?.groundedResponse?.rankingReasonRate ?? 0}, event-score ${benchmark.metrics?.groundedResponse?.eventScoreRate ?? 0}, state-summary ${benchmark.metrics?.groundedResponse?.stateSummaryRate ?? 0}, state-confidence ${benchmark.metrics?.groundedResponse?.stateConfidenceRate ?? 0}, state-transition-taxonomy ${benchmark.metrics?.groundedResponse?.stateTransitionTaxonomyRate ?? 0}`,
  `- Answer grounding metrics: success ${benchmark.metrics?.answer?.success ?? 0}/${benchmark.metrics?.answer?.runs ?? 0}, evidence coverage ${benchmark.metrics?.answer?.evidenceCoverageRate ?? 0}, event-snippet ${benchmark.metrics?.answer?.evidenceEventSnippetRate ?? 0}, ranking-reason ${benchmark.metrics?.answer?.evidenceEventRankingReasonRate ?? 0}, event-score ${benchmark.metrics?.answer?.evidenceEventScoreRate ?? 0}, state-summary ${benchmark.metrics?.answer?.evidenceStateSummaryRate ?? 0}, state-confidence ${benchmark.metrics?.answer?.evidenceStateConfidenceRate ?? 0}, state-transition-taxonomy ${benchmark.metrics?.answer?.evidenceStateTransitionTaxonomyRate ?? 0}`,
  `- Runtime write tiers: ${Object.entries(benchmark.metrics?.runtime?.writeTierCounts || {}).map(([name, count]) => `${name}=${count}`).join(", ") || "none"}`,
  `- Runtime note taxonomy: ${Object.entries(benchmark.metrics?.runtime?.noteTaxonomy || {}).map(([name, count]) => `${name}=${count}`).join(", ") || "none"}`,
  "",
  ...(ablation
    ? [
        "## Ablation Highlights",
        `- Baseline: ${ablation.deltaSummary?.baseline || "baseline"}`,
        formatDeltaHighlight("Best reliability delta", ablation.deltaSummary?.bestReliability, "reliability"),
        formatDeltaHighlight("Worst reliability delta", ablation.deltaSummary?.worstReliability, "reliability"),
        formatDeltaHighlight("Best omission warning delta", ablation.deltaSummary?.bestDigestOmission, "digestOmissionWarningRate"),
        formatDeltaHighlight("Worst omission warning delta", ablation.deltaSummary?.worstDigestOmission, "digestOmissionWarningRate"),
        formatDeltaHighlight("Best state retention delta", ablation.deltaSummary?.bestStateRetention, "stateFactRetentionRate"),
        formatDeltaHighlight("Worst state retention delta", ablation.deltaSummary?.worstStateRetention, "stateFactRetentionRate"),
        formatDeltaHighlight("Best working-note continuity delta", ablation.deltaSummary?.bestWorkingNoteContinuity, "openQuestionContinuityRate"),
        formatDeltaHighlight("Worst working-note continuity delta", ablation.deltaSummary?.worstWorkingNoteContinuity, "openQuestionContinuityRate"),
        formatDeltaHighlight("Best resolved working-note intrusion delta", ablation.deltaSummary?.bestResolvedWorkingNoteIntrusion, "resolvedRiskIntrusionRate"),
        formatDeltaHighlight("Worst resolved working-note intrusion delta", ablation.deltaSummary?.worstResolvedWorkingNoteIntrusion, "resolvedRiskIntrusionRate"),
        formatDeltaHighlight("Best grounded-response evidence delta", ablation.deltaSummary?.bestGroundedResponseEvidence, "groundedResponseEvidenceCoverageRate"),
        formatDeltaHighlight("Worst grounded-response evidence delta", ablation.deltaSummary?.worstGroundedResponseEvidence, "groundedResponseEvidenceCoverageRate"),
        formatDeltaHighlight("Best runtime evidence delta", ablation.deltaSummary?.bestRuntimeEvidenceCoverage, "runtimeEvidenceCoverageRate"),
        formatDeltaHighlight("Worst runtime evidence delta", ablation.deltaSummary?.worstRuntimeEvidenceCoverage, "runtimeEvidenceCoverageRate"),
        "",
        "## Top Ablations",
        formatTopAblations(ablation.cases),
        "",
        "## Grounded Response Comparison",
        formatGroundedResponseComparisons(ablation.cases),
        "",
        "## Runtime Profile Comparison",
        formatRuntimeComparisons(ablation.cases),
        ""
      ]
    : []),
  ...(trend
    ? [
        "## Trend Window",
        `- Latest benchmark in window: ${trend.latest?.file || "unknown"}`,
        `- Window size: ${trend.series?.length || 0} run(s)`,
        `- Trend model context: ${trend.latest?.model?.provider || "unknown"} / ${trend.latest?.model?.name || "unknown"}`,
        `- Overall delta: ${formatDelta(trend.deltaSummary?.overall ?? 0)}`,
        `- Reliability delta: ${formatDelta(trend.deltaSummary?.reliability ?? 0)}`,
        `- Reliability breakdown delta: consistency ${formatDelta(trend.deltaSummary?.consistency ?? 0)}, retention ${formatDelta(trend.deltaSummary?.retention ?? 0)}, contradiction control ${formatDelta(trend.deltaSummary?.contradictionControl ?? 0)}, replay ${formatDelta(trend.deltaSummary?.replay ?? 0)}, runtime grounding ${formatDelta(trend.deltaSummary?.runtimeGrounding ?? 0)}`,
        `- Retrieve hit delta: semantic ${formatDelta(trend.deltaSummary?.retrieveHitRate ?? 0)}, strict ${formatDelta(trend.deltaSummary?.retrieveStrictHitRate ?? 0)}`,
        `- Retrieve explainability delta: reasons ${formatDelta(trend.deltaSummary?.retrieveExplainabilityRate ?? 0)}, reranked ${formatDelta(trend.deltaSummary?.retrieveRerankedRate ?? 0)}, embedding-top-match ${formatDelta(trend.deltaSummary?.retrieveEmbeddingTopMatchRate ?? 0)}, document-top-match ${formatDelta(trend.deltaSummary?.retrieveDocumentTopMatchRate ?? 0)}, source-diversity ${formatDelta(trend.deltaSummary?.retrieveSourceDiversityRate ?? 0)}`,
        `- Digest consistency delta: ${formatDelta(trend.deltaSummary?.digestConsistency ?? 0)}`,
        `- Digest repeatability delta: ${formatDelta(trend.deltaSummary?.digestRepeatabilityRate ?? 0)}`,
        `- Digest omission warning delta: ${formatDelta(trend.deltaSummary?.digestOmissionWarningRate ?? 0)}`,
        `- Digest drift delta: ${formatDelta(trend.deltaSummary?.digestDriftRate ?? 0)}`,
        `- State drift delta: ${formatDelta(trend.deltaSummary?.stateDriftRate ?? 0)}`,
        `- Temporary todo intrusion delta: ${formatDelta(trend.deltaSummary?.temporaryTodoIntrusionRate ?? 0)}`,
        `- Latest document retention delta: ${formatDelta(trend.deltaSummary?.latestDocumentRetentionRate ?? 0)}`,
        `- Superseded document intrusion delta: ${formatDelta(trend.deltaSummary?.supersededDocumentIntrusionRate ?? 0)}`,
        `- State fact retention delta: ${formatDelta(trend.deltaSummary?.stateFactRetentionRate ?? 0)}`,
        `- Working-note continuity delta: open-questions ${formatDelta(trend.deltaSummary?.openQuestionContinuityRate ?? 0)}, risks ${formatDelta(trend.deltaSummary?.riskContinuityRate ?? 0)}`,
        `- Resolved working-note intrusion delta: open-questions ${formatDelta(trend.deltaSummary?.resolvedOpenQuestionIntrusionRate ?? 0)}, risks ${formatDelta(trend.deltaSummary?.resolvedRiskIntrusionRate ?? 0)}`,
        `- Runtime evidence coverage delta: ${formatDelta(trend.deltaSummary?.runtimeEvidenceCoverage ?? 0)}`,
        `- Runtime retrieval-explainability delta: ranking-reason ${formatDelta(trend.deltaSummary?.runtimeEventRankingReasonRate ?? 0)}, score ${formatDelta(trend.deltaSummary?.runtimeEventScoreRate ?? 0)}, embedding-reason ${formatDelta(trend.deltaSummary?.runtimeEventEmbeddingReasonRate ?? 0)}, document-source ${formatDelta(trend.deltaSummary?.runtimeEventDocumentSourceRate ?? 0)}`,
        `- Runtime state-provenance delta: ${formatDelta(trend.deltaSummary?.runtimeStateProvenanceRate ?? 0)}`,
        `- Runtime state-confidence delta: ${formatDelta(trend.deltaSummary?.runtimeStateConfidenceRate ?? 0)}`,
        `- Runtime state-transition-taxonomy delta: ${formatDelta(trend.deltaSummary?.runtimeStateTransitionTaxonomyRate ?? 0)}`,
        `- Runtime recent-state-changes delta: ${formatDelta(trend.deltaSummary?.runtimeRecentStateChangesRate ?? 0)}`,
        `- Grounded response delta: success ${formatDelta(trend.deltaSummary?.groundedResponseSuccessRate ?? 0)}, evidence ${formatDelta(trend.deltaSummary?.groundedResponseEvidenceCoverageRate ?? 0)}, ranking-reason ${formatDelta(trend.deltaSummary?.groundedResponseRankingReasonRate ?? 0)}, score ${formatDelta(trend.deltaSummary?.groundedResponseEventScoreRate ?? 0)}, state-summary ${formatDelta(trend.deltaSummary?.groundedResponseStateSummaryRate ?? 0)}, state-confidence ${formatDelta(trend.deltaSummary?.groundedResponseStateConfidenceRate ?? 0)}, state-transition-taxonomy ${formatDelta(trend.deltaSummary?.groundedResponseStateTransitionTaxonomyRate ?? 0)}`,
        `- Answer grounding delta: evidence ${formatDelta(trend.deltaSummary?.answerEvidenceCoverageRate ?? 0)}, ranking-reason ${formatDelta(trend.deltaSummary?.answerEventRankingReasonRate ?? 0)}, score ${formatDelta(trend.deltaSummary?.answerEventScoreRate ?? 0)}, state-summary ${formatDelta(trend.deltaSummary?.answerStateSummaryRate ?? 0)}, state-confidence ${formatDelta(trend.deltaSummary?.answerStateConfidenceRate ?? 0)}, state-transition-taxonomy ${formatDelta(trend.deltaSummary?.answerStateTransitionTaxonomyRate ?? 0)}`,
        `- Replay rebuild consistency delta: ${formatDelta(trend.deltaSummary?.replayRebuildConsistencyRate ?? 0)}`,
        `- Replay cross-run divergence delta: ${formatDelta(trend.deltaSummary?.replayCrossRunStateDivergenceRate ?? 0)}`,
        `- Replay transition-match delta: ${formatDelta(trend.deltaSummary?.replayTransitionTaxonomyMatchRate ?? 0)}`,
        `- Replay cross-run transition divergence delta: ${formatDelta(trend.deltaSummary?.replayCrossRunTransitionDivergenceRate ?? 0)}`,
        `- Replay stability blend delta: ${formatDelta(trend.deltaSummary?.replayStabilityBlend ?? 0)}`,
        ""
      ]
    : []),
  "## Discussion",
  "- Interpret whether reliability moved in the same direction as overall score.",
  "- Note whether runtime evidence coverage improved or regressed.",
  "- Compare replay stability against digest contradiction and omission signals.",
  ...(ablation ? ["- Explain whether runtime profile differences were larger or smaller than digest-control differences."] : []),
  ...(trend ? ["- Compare the latest single-run result against the surrounding benchmark window before drawing conclusions."] : []),
  "",
  "## Reproducibility Artifacts",
  `- Benchmark JSON: \`${path.basename(benchmarkPath)}\``,
  ...(ablation ? [`- Ablation JSON: \`${path.basename(ablationPath)}\``] : []),
  ...(trend ? [`- Trend JSON: \`${path.basename(trendPath)}\``] : []),
  `- Fixture: \`${benchmark.config?.fixture || "(none)"}\``
];

writeFileSync(reportPath, lines.join("\n"));
// eslint-disable-next-line no-console
console.log(`Research report draft: ${reportPath}`);
