import { Command } from "commander";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { cliEnv } from "./env";

const configDir = path.join(os.homedir(), ".projectmemory");
const configFile = path.join(configDir, "config.json");

function getOrCreateUserId() {
  if (cliEnv.cliUserId) {
    return cliEnv.cliUserId;
  }
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  if (!fs.existsSync(configFile)) {
    const userId = randomUUID();
    fs.writeFileSync(configFile, JSON.stringify({ userId }, null, 2));
    return userId;
  }
  const content = JSON.parse(fs.readFileSync(configFile, "utf8"));
  if (!content.userId) {
    content.userId = randomUUID();
    fs.writeFileSync(configFile, JSON.stringify(content, null, 2));
  }
  return content.userId as string;
}

async function apiFetch(pathname: string, options?: RequestInit) {
  const userId = getOrCreateUserId();
  const url = `${cliEnv.apiBaseUrl}${pathname}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId,
          ...(options?.headers || {})
        }
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        if (shouldRetry(response.status) && attempt < 2) {
          await sleep(backoff(attempt));
          continue;
        }
        return data ?? { error: `HTTP ${response.status}` };
      }
      return data;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await sleep(backoff(attempt));
        continue;
      }
    }
  }
  return { error: "request_failed", detail: String(lastError ?? "") };
}

function shouldRetry(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function backoff(attempt: number) {
  return Math.min(200 * Math.pow(2, attempt), 1000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonSafe(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function resolveTargetScopeId(scopeId?: string) {
  if (scopeId) return scopeId;
  const state = await apiFetch("/state");
  return state.activeScopeId ?? null;
}

async function timedApiFetch(pathname: string, options?: RequestInit) {
  const startedAt = Date.now();
  const result = await apiFetch(pathname, options);
  return {
    result,
    latencyMs: Date.now() - startedAt
  };
}

function computeDoctorFailures(summary: Record<string, any>, probeTurnEnabled: boolean) {
  const failures = [];
  if (summary.status !== "ok") {
    failures.push("api_not_healthy");
  }
  if (!summary.featureLlm) {
    failures.push("feature_llm_disabled");
  }
  if (!summary.scopeId) {
    failures.push("scope_missing");
  }
  if (!summary.layerAlignment?.goalAligned) {
    failures.push("layer_goal_not_aligned");
  }
  if (!summary.layerAlignment?.fastPathReady) {
    failures.push("layer_fast_path_not_ready");
  }
  if (summary.layerFreshness?.workingMemoryCaughtUp === false) {
    failures.push("working_memory_not_caught_up");
  }
  if (summary.layerFreshness?.stableStateCaughtUp === false) {
    failures.push("stable_state_not_caught_up");
  }
  if (Array.isArray(summary.layerWarnings) && summary.layerWarnings.length > 0) {
    failures.push("layer_warnings_present");
  }
  if (probeTurnEnabled) {
    if (!summary.runtimeProbe) {
      failures.push("runtime_probe_missing");
    } else {
      if (!summary.runtimeProbe.layerAlignment?.goalAligned) {
        failures.push("runtime_probe_goal_not_aligned");
      }
      if (Array.isArray(summary.runtimeProbe.warnings) && summary.runtimeProbe.warnings.length > 0) {
        failures.push("runtime_probe_warnings_present");
      }
      if (!summary.runtimeProbe.answerMode) {
        failures.push("runtime_probe_answer_mode_missing");
      }
    }
  }
  return failures;
}

function writeOutputFile(filePath: string, value: unknown) {
  const baseDir =
    process.env.STATECORE_CLI_BASE_DIR ||
    process.env.PWD ||
    process.env.INIT_CWD ||
    process.cwd();
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`);
  return resolved;
}

const program = new Command();
program.name("pm").description("StateCore CLI");

program
  .command("scopes")
  .description("List scopes")
  .action(async () => {
    const result = await apiFetch("/scopes");
    result.items.forEach((s: any) => {
      // eslint-disable-next-line no-console
      console.log(`${s.name} (${s.id})`);
    });
  });

program
  .command("new")
  .argument("<name>")
  .description("Create a scope")
  .action(async (name: string) => {
    const scope = await apiFetch("/scopes", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    // eslint-disable-next-line no-console
    console.log(`Created scope ${scope.name} (${scope.id})`);
  });

program
  .command("use")
  .argument("<nameOrId>")
  .description("Set active scope")
  .action(async (nameOrId: string) => {
    const scopes = await apiFetch("/scopes");
    const match = scopes.items.find((s: any) => s.id === nameOrId || s.name.toLowerCase() === nameOrId.toLowerCase());
    if (!match) {
      // eslint-disable-next-line no-console
      console.log("Scope not found.");
      return;
    }
    await apiFetch(`/scopes/${match.id}/active`, { method: "POST" });
    // eslint-disable-next-line no-console
    console.log(`Active scope set: ${match.name}`);
  });

program
  .command("log")
  .argument("<text>")
  .description("Ingest stream event to active scope")
  .action(async (text: string) => {
    const state = await apiFetch("/state");
    if (!state.activeScopeId) {
      // eslint-disable-next-line no-console
      console.log("No active scope.");
      return;
    }
    await apiFetch("/memory/events", {
      method: "POST",
      body: JSON.stringify({ scopeId: state.activeScopeId, type: "stream", source: "cli", content: text })
    });
    // eslint-disable-next-line no-console
    console.log("Logged.");
  });

program
  .command("upsert-note")
  .argument("<key>")
  .argument("<text>")
  .description("Upsert document memory by key")
  .action(async (key: string, text: string) => {
    const state = await apiFetch("/state");
    if (!state.activeScopeId) {
      // eslint-disable-next-line no-console
      console.log("No active scope.");
      return;
    }
    await apiFetch("/memory/events", {
      method: "POST",
      body: JSON.stringify({ scopeId: state.activeScopeId, type: "document", source: "cli", key, content: text })
    });
    // eslint-disable-next-line no-console
    console.log("Document upserted.");
  });

program
  .command("digest")
  .description("Enqueue digest for active scope")
  .action(async () => {
    const state = await apiFetch("/state");
    if (!state.activeScopeId) {
      // eslint-disable-next-line no-console
      console.log("No active scope.");
      return;
    }
    const result = await apiFetch("/memory/digest", {
      method: "POST",
      body: JSON.stringify({ scopeId: state.activeScopeId })
    });
    // eslint-disable-next-line no-console
    console.log(`Digest queued. Job: ${result.jobId}`);
  });

program
  .command("working-state")
  .argument("[scopeId]")
  .description("Show latest working memory snapshot for a scope or the active scope")
  .action(async (scopeId?: string) => {
    const state = await apiFetch("/state");
    const targetScopeId = scopeId || state.activeScopeId;
    if (!targetScopeId) {
      // eslint-disable-next-line no-console
      console.log("No active scope.");
      return;
    }
    const result = await apiFetch(`/memory/working-state?scopeId=${encodeURIComponent(targetScopeId)}`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("stable-state")
  .argument("[scopeId]")
  .description("Show latest authoritative stable-state snapshot for a scope or the active scope")
  .action(async (scopeId?: string) => {
    const state = await apiFetch("/state");
    const targetScopeId = scopeId || state.activeScopeId;
    if (!targetScopeId) {
      // eslint-disable-next-line no-console
      console.log("No active scope.");
      return;
    }
    const result = await apiFetch(`/memory/stable-state?scopeId=${encodeURIComponent(targetScopeId)}`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("fast-view")
  .argument("<message>")
  .argument("[scopeId]")
  .description("Show the compiled fast-layer context for a message")
  .action(async (message: string, scopeId?: string) => {
    const state = await apiFetch("/state");
    const targetScopeId = scopeId || state.activeScopeId;
    if (!targetScopeId) {
      // eslint-disable-next-line no-console
      console.log("No active scope.");
      return;
    }
    const result = await apiFetch(`/memory/fast-view?scopeId=${encodeURIComponent(targetScopeId)}&message=${encodeURIComponent(message)}`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("layer-status")
  .argument("[message]")
  .argument("[scopeId]")
  .description("Show aggregated three-layer diagnostics for a message")
  .action(async (message?: string, scopeId?: string) => {
    const state = await apiFetch("/state");
    const targetScopeId = scopeId || state.activeScopeId;
    if (!targetScopeId) {
      // eslint-disable-next-line no-console
      console.log("No active scope.");
      return;
    }
    const targetMessage = message || "What is the current architecture goal?";
    const result = await apiFetch(`/memory/layer-status?scopeId=${encodeURIComponent(targetScopeId)}&message=${encodeURIComponent(targetMessage)}`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("doctor")
  .argument("[scopeId]")
  .description("Show runtime health, active scope, layer versions, and fast-view retrieval plan")
  .option("--probe-turn", "Run a lightweight runtime turn probe as part of the diagnosis")
  .option("--assert-clean", "Exit non-zero if the diagnosed scope is not in a clean runtime state")
  .option("--message <text>", "Override the diagnostic message used for layer-status and runtime probe")
  .option("--output-file <path>", "Write the diagnosis JSON to a file")
  .option("--output <path>", "Write the diagnosis JSON to a file")
  .action(async (scopeId: string | undefined, options: { probeTurn?: boolean; assertClean?: boolean; message?: string; output?: string; outputFile?: string }) => {
    const normalizedScopeId = scopeId && !scopeId.startsWith("-") ? scopeId : undefined;
    const probeTurnEnabled = Boolean(options.probeTurn || scopeId === "--probe-turn");
    const targetMessage = options.message || "What is the current architecture goal?";
    const [health, state] = await Promise.all([
      apiFetch("/health"),
      apiFetch("/state")
    ]);
    const targetScopeId = normalizedScopeId || state.activeScopeId || null;

    const summary: Record<string, unknown> = {
      apiBaseUrl: cliEnv.apiBaseUrl,
      status: health.status ?? "unknown",
      featureLlm: health.featureLlm ?? false,
      activeScopeId: state.activeScopeId ?? null,
      runtimeModel: health.model?.runtimeModel ?? null,
      runtimeReasoningEffort: health.model?.runtimeReasoningEffort ?? null,
      runtimeMaxOutputTokens: health.model?.runtimeMaxOutputTokens ?? null,
      workingMemoryEnabled: health.workingMemory?.enabled ?? null,
      workingMemoryUseLlm: health.workingMemory?.useLlm ?? null
    };

    if (targetScopeId) {
      const layerStatus = await apiFetch(`/memory/layer-status?scopeId=${encodeURIComponent(targetScopeId)}&message=${encodeURIComponent(targetMessage)}`);

      summary.scopeId = targetScopeId;
      summary.message = targetMessage;
      summary.workingMemoryVersion = layerStatus.workingMemoryVersion ?? null;
      summary.stableStateVersion = layerStatus.stableStateVersion ?? null;
      summary.fastViewSummary = layerStatus.fastLayerSummary ?? null;
      summary.fastViewRetrievalPlan = layerStatus.retrievalPlan ?? null;
      summary.layerAlignment = layerStatus.layerAlignment ?? null;
      summary.layerFreshness = layerStatus.freshness ?? null;
      summary.layerWarnings = layerStatus.warnings ?? [];

      if (probeTurnEnabled) {
        const probe = await timedApiFetch("/memory/runtime/turn", {
          method: "POST",
          body: JSON.stringify({
            scopeId: targetScopeId,
            message: targetMessage,
            source: "cli",
            writeTier: "ephemeral",
            digestMode: "skip"
          })
        });
        summary.runtimeProbe = {
          latencyMs: probe.latencyMs,
          answerMode: probe.result.answerMode ?? null,
          retrievalPlan: probe.result.retrievalPlan ?? null,
          layerAlignment: probe.result.layerAlignment ?? null,
          warnings: probe.result.warnings ?? [],
          notes: probe.result.notes ?? []
        };
        if (summary.layerAlignment && typeof summary.layerAlignment === "object") {
          Object.assign(summary.layerAlignment, {
            directStateFastPathLive: probe.result.answerMode === "direct_state_fast_path"
          });
        }
      }
    }

    const assertionFailures = computeDoctorFailures(summary, probeTurnEnabled);
    summary.diagnosisStatus = assertionFailures.length ? "fail" : "pass";
    summary.assertionFailures = assertionFailures;
    summary.requestedOutputPath = options.outputFile || options.output || null;

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));

    const outputPathOption = options.outputFile || options.output;
    if (outputPathOption) {
      const outputPath = writeOutputFile(outputPathOption, summary);
      // eslint-disable-next-line no-console
      console.error(`doctor_output_written: ${outputPath}`);
    }

    if (options.assertClean && assertionFailures.length) {
      // eslint-disable-next-line no-console
      console.error(`doctor_assert_clean_failed: ${assertionFailures.join(",")}`);
      process.exit(1);
    }
  });

program
  .command("state")
  .argument("[scopeId]")
  .description("Show latest digest state snapshot for a scope or the active scope")
  .action(async (scopeId?: string) => {
    const state = await apiFetch("/state");
    const targetScopeId = scopeId || state.activeScopeId;
    if (!targetScopeId) {
      // eslint-disable-next-line no-console
      console.log("No active scope.");
      return;
    }
    const result = await apiFetch(`/memory/state?scopeId=${encodeURIComponent(targetScopeId)}`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("state-history")
  .argument("[scopeId]")
  .description("Show recent digest state snapshots for a scope or the active scope")
  .action(async (scopeId?: string) => {
    const state = await apiFetch("/state");
    const targetScopeId = scopeId || state.activeScopeId;
    if (!targetScopeId) {
      // eslint-disable-next-line no-console
      console.log("No active scope.");
      return;
    }
    const result = await apiFetch(`/memory/state/history?scopeId=${encodeURIComponent(targetScopeId)}&limit=10`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("ask")
  .argument("<question>")
  .description("Ask a question using memory")
  .action(async (question: string) => {
    const state = await apiFetch("/state");
    if (!state.activeScopeId) {
      // eslint-disable-next-line no-console
      console.log("No active scope.");
      return;
    }
    const result = await apiFetch("/memory/answer", {
      method: "POST",
      body: JSON.stringify({ scopeId: state.activeScopeId, question })
    });
    if (result.error) {
      // eslint-disable-next-line no-console
      console.log(result.error);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(result.answer);
  });

program
  .command("turn")
  .argument("<message>")
  .description("Run the assistant runtime turn flow against the active scope")
  .option("--policy-profile <profile>", "Runtime policy profile: default|conservative|document-heavy")
  .option("--write-tier <tier>", "Override runtime write tier: ephemeral|candidate|stable|documented")
  .option("--digest-mode <mode>", "Override digest mode: auto|force|skip")
  .option("--document-key <key>", "Explicit document key when write tier is documented")
  .option("--recall-limit <n>", "Override recall limit for this runtime turn")
  .option("--promote-long-form", "Promote long-form input to documented memory")
  .option("--digest-on-candidate", "Allow digest triggering for candidate turns")
  .action(async (message: string, options: { policyProfile?: string; writeTier?: string; digestMode?: string; documentKey?: string; recallLimit?: string; promoteLongForm?: boolean; digestOnCandidate?: boolean }) => {
    const state = await apiFetch("/state");
    if (!state.activeScopeId) {
      // eslint-disable-next-line no-console
      console.log("No active scope.");
      return;
    }
    const result = await apiFetch("/memory/runtime/turn", {
      method: "POST",
      body: JSON.stringify({
        scopeId: state.activeScopeId,
        message,
        source: "cli",
        ...(options.policyProfile ? { policyProfile: options.policyProfile } : {}),
        ...((options.recallLimit || options.promoteLongForm || options.digestOnCandidate)
          ? {
              policyOverrides: {
                ...(options.recallLimit ? { recallLimit: Number(options.recallLimit) } : {}),
                ...(options.promoteLongForm ? { promoteLongFormToDocumented: true } : {}),
                ...(options.digestOnCandidate ? { digestOnCandidate: true } : {})
              }
            }
          : {}),
        ...(options.writeTier ? { writeTier: options.writeTier } : {}),
        ...(options.digestMode ? { digestMode: options.digestMode } : {}),
        ...(options.documentKey ? { documentKey: options.documentKey } : {})
      })
    });
    if (result.error) {
      // eslint-disable-next-line no-console
      console.log(result.error);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(result.answer);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      answerMode: result.answerMode,
      writeTier: result.writeTier,
      digestTriggered: result.digestTriggered,
      workingMemoryVersion: result.workingMemoryVersion ?? null,
      stableStateVersion: result.stableStateVersion ?? null,
      usedFastLayerContextSummary: result.usedFastLayerContextSummary ?? null,
      retrievalPlan: result.retrievalPlan ?? null,
      layerAlignment: result.layerAlignment ?? null,
      warnings: result.warnings ?? [],
      notes: result.notes ?? [],
      evidence: result.evidence
    }, null, 2));
  });

program
  .command("remind")
  .argument("<minutes>")
  .argument("<text>")
  .description("Schedule a reminder in N minutes")
  .action(async (minutes: string, text: string) => {
    const state = await apiFetch("/state");
    const value = Number(minutes);
    if (!Number.isFinite(value)) {
      // eslint-disable-next-line no-console
      console.log("Minutes must be a number.");
      return;
    }
    const dueAt = new Date(Date.now() + value * 60 * 1000).toISOString();
    await apiFetch("/reminders", {
      method: "POST",
      body: JSON.stringify({ scopeId: state.activeScopeId ?? null, dueAt, text })
    });
    // eslint-disable-next-line no-console
    console.log(`Reminder scheduled in ${value} minutes.`);
  });
const argv = [...process.argv];
if (argv[2] === "--") {
  argv.splice(2, 1);
}

program.parseAsync(argv);
