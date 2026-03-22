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
  userId: process.env.VISIBLE_COMPARE_USER_ID || "visible-compare-user",
  fixture: process.env.VISIBLE_COMPARE_FIXTURE || "benchmark-fixtures/observable-drift-demo.json",
  timeoutMs: Number(process.env.VISIBLE_COMPARE_TIMEOUT_MS || 180000),
  outputDir: process.env.VISIBLE_COMPARE_OUTPUT_DIR || "benchmark-results",
  modelBaseUrl: process.env.MODEL_CHAT_BASE_URL || process.env.MODEL_BASE_URL || process.env.OPENAI_BASE_URL || "",
  modelApiKey: process.env.MODEL_CHAT_API_KEY || process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "",
  modelName: process.env.MODEL_CHAT_NAME || process.env.MODEL_NAME || process.env.OPENAI_MODEL || "",
  baselineMode: process.env.VISIBLE_COMPARE_BASELINE_MODE || ""
};

const headers = { "Content-Type": "application/json", "x-user-id": cfg.userId };

function requireConfig(name, value) {
  if (!value) {
    throw new Error(`missing_config:${name}`);
  }
}

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

async function chat(messages) {
  const response = await fetch(`${cfg.modelBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.modelApiKey ? { Authorization: `Bearer ${cfg.modelApiKey}` } : {})
    },
    body: JSON.stringify({
      model: cfg.modelName,
      messages
    })
  });
  if (!response.ok) {
    throw new Error(`llm_error:${response.status}:${await response.text()}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("llm_response_missing_content");
  }
  return String(content).trim();
}

function loadFixture(fixturePath) {
  const fullPath = path.isAbsolute(fixturePath) ? fixturePath : path.join(root, fixturePath);
  const raw = readFileSync(fullPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.events)) {
    throw new Error("invalid_fixture: missing events array");
  }
  if (!Array.isArray(parsed.checkpoints) || !parsed.checkpoints.length) {
    throw new Error("invalid_fixture: missing checkpoints");
  }
  return {
    source: fullPath,
    demoName: parsed.demoName || "Observable Drift Demo",
    events: parsed.events,
    checkpoints: parsed.checkpoints,
    baseline: parsed.baseline || {}
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesAll(text, candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return true;
  const normalized = normalizeText(text);
  return candidates.every((candidate) => normalized.includes(normalizeText(candidate)));
}

function includesOneOf(text, candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return true;
  const normalized = normalizeText(text);
  return candidates.some((candidate) => normalized.includes(normalizeText(candidate)));
}

function hitsAny(text, candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return false;
  const normalized = normalizeText(text);
  return candidates.some((candidate) => normalized.includes(normalizeText(candidate)));
}

function evaluateAnswer(answer, question) {
  const includeAllPass = includesAll(answer, question.mustIncludeAll || []);
  const includeAnyPass = includesOneOf(answer, question.mustIncludeAny || []);
  const avoidHit = hitsAny(answer, question.mustAvoidAny || []);
  return {
    pass: includeAllPass && includeAnyPass && !avoidHit,
    includeAllPass,
    includeAnyPass,
    avoidHit
  };
}

async function waitForNewDigest(scopeId, previousCount) {
  const start = Date.now();
  while (Date.now() - start <= cfg.timeoutMs) {
    const result = await apiFetch("GET", `/memory/digests?scopeId=${scopeId}&limit=5`);
    if (!result.ok) {
      return { ok: false, error: `digest_list_failed:${result.status}` };
    }
    const items = result.json.items || [];
    if (items.length > previousCount) {
      return { ok: true, digest: items[0] };
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return { ok: false, error: "digest_timeout" };
}

function renderEvent(event, index) {
  const prefix = `${index + 1}. [${event.type}${event.key ? `:${event.key}` : ""}]`;
  return `${prefix} ${event.content}`;
}

function parseRollingSummary(summary) {
  const lines = String(summary || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const sections = {
    goal: [],
    constraints: [],
    decisions: [],
    todos: [],
    status: [],
    noise: [],
    other: []
  };

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("goal:")) {
      sections.goal.push(line.replace(/^goal:\s*/i, "").trim());
      continue;
    }
    if (lower.startsWith("constraints:")) {
      sections.constraints.push(
        ...line
          .replace(/^constraints:\s*/i, "")
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean)
      );
      continue;
    }
    if (lower.startsWith("decisions:")) {
      sections.decisions.push(
        ...line
          .replace(/^decisions:\s*/i, "")
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean)
      );
      continue;
    }
    if (lower.startsWith("open todos:")) {
      sections.todos.push(
        ...line
          .replace(/^open todos:\s*/i, "")
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean)
      );
      continue;
    }
    if (lower.startsWith("status:") || lower.startsWith("status update:")) {
      sections.status.push(line.replace(/^status(?: update)?:\s*/i, "").trim());
      continue;
    }
    if (lower.startsWith("noise:")) {
      sections.noise.push(line.replace(/^noise:\s*/i, "").trim());
      continue;
    }
    sections.other.push(line);
  }

  return sections;
}

function pushSection(lines, title, items) {
  if (!items.length) return;
  lines.push(`**${title}**`);
  lines.push("");
  for (const item of items) {
    lines.push(`- ${item}`);
  }
  lines.push("");
}

async function updateRollingSummary(previousSummary, event, wordBudget) {
  return chat([
    {
      role: "system",
      content:
        "You maintain a single rolling memory summary for a project. Update the summary using only the previous summary and the new event. Keep current goals, constraints, decisions, and open todos if they still matter. Prefer the latest explicit document update when facts conflict. Do not add facts that are not present. Output plain text only."
    },
    {
      role: "user",
      content: `Word budget: ${wordBudget}\n\nPrevious summary:\n${previousSummary || "(none)"}\n\nNew event:\n${event.content}\n\nReturn the updated summary in at most ${wordBudget} words.`
    }
  ]);
}

async function answerFromRollingSummary(summary, question) {
  return chat([
    {
      role: "system",
      content: "You answer questions from a single rolling memory summary. If the summary is insufficient, say that clearly. Output plain text only."
    },
    {
      role: "user",
      content: `Memory summary:\n${summary || "(none)"}\n\nQuestion:\n${question}`
    }
  ]);
}

async function answerFromProjectMemory(scopeId, question) {
  const response = await apiFetch("POST", "/memory/answer", { scopeId, question });
  if (!response.ok || response.json.error) {
    throw new Error(`project_memory_answer_failed:${response.status}:${JSON.stringify(response.json)}`);
  }
  return response.json.answer;
}

async function enqueueDigest(scopeId) {
  const before = await apiFetch("GET", `/memory/digests?scopeId=${scopeId}&limit=5`);
  if (!before.ok) {
    throw new Error(`digest_list_before_failed:${before.status}`);
  }
  const beforeCount = (before.json.items || []).length;
  const enqueue = await apiFetch("POST", "/memory/digest", { scopeId });
  if (!enqueue.ok || enqueue.json.error) {
    throw new Error(`digest_enqueue_failed:${enqueue.status}:${JSON.stringify(enqueue.json)}`);
  }
  const waited = await waitForNewDigest(scopeId, beforeCount);
  if (!waited.ok) {
    throw new Error(waited.error);
  }
  return waited.digest;
}

async function run() {
  requireConfig("MODEL_BASE_URL", cfg.modelBaseUrl);
  requireConfig("MODEL_NAME", cfg.modelName);
  const startedAt = msNow();
  const fixture = loadFixture(cfg.fixture);
  const baselineMode = cfg.baselineMode || fixture.baseline.mode || "rolling-summary";
  const wordBudget = Number(fixture.baseline.summaryWordBudget || 70);

  if (baselineMode !== "rolling-summary") {
    throw new Error(`unsupported_baseline_mode:${baselineMode}`);
  }

  const report = {
    startedAt,
    endedAt: null,
    fixture: cfg.fixture,
    fixtureSource: fixture.source,
    demoName: fixture.demoName,
    baselineMode,
    model: cfg.modelName,
    checkpoints: [],
    summary: null
  };

  const scopeResp = await apiFetch("POST", "/scopes", { name: `${fixture.demoName} ${Date.now()}` });
  if (!scopeResp.ok || !scopeResp.json.id) {
    throw new Error(`failed_create_scope:${scopeResp.status}:${JSON.stringify(scopeResp.json)}`);
  }
  const scopeId = scopeResp.json.id;

  let rollingSummary = "";
  let checkpointCursor = 0;

  for (let index = 0; index < fixture.events.length; index += 1) {
    const event = fixture.events[index];
    const ingest = await apiFetch("POST", "/memory/events", {
      scopeId,
      source: "sdk",
      ...event
    });
    if (!ingest.ok) {
      throw new Error(`ingest_failed:${index + 1}:${ingest.status}`);
    }

    rollingSummary = await updateRollingSummary(rollingSummary, event, wordBudget);

    while (
      checkpointCursor < fixture.checkpoints.length &&
      Number(fixture.checkpoints[checkpointCursor].afterEvent) === index + 1
    ) {
      const checkpoint = fixture.checkpoints[checkpointCursor];
      const digest = await enqueueDigest(scopeId);
      const answers = [];

      for (const question of checkpoint.questions) {
        const projectMemoryAnswer = await answerFromProjectMemory(scopeId, question.question);
        const directModelAnswer = await answerFromRollingSummary(rollingSummary, question.question);
        answers.push({
          question: question.question,
          mustIncludeAll: question.mustIncludeAll || [],
          mustIncludeAny: question.mustIncludeAny || [],
          mustAvoidAny: question.mustAvoidAny || [],
          projectMemory: {
            answer: projectMemoryAnswer,
            evaluation: evaluateAnswer(projectMemoryAnswer, question)
          },
          directModel: {
            answer: directModelAnswer,
            evaluation: evaluateAnswer(directModelAnswer, question)
          }
        });
      }

      report.checkpoints.push({
        label: checkpoint.label,
        afterEvent: checkpoint.afterEvent,
        digestId: digest.id,
        rollingSummary,
        eventWindow: fixture.events.slice(0, checkpoint.afterEvent).map(renderEvent),
        answers
      });

      checkpointCursor += 1;
    }
  }

  const flattened = report.checkpoints.flatMap((checkpoint) =>
    checkpoint.answers.map((answer) => ({
      projectMemoryPass: answer.projectMemory.evaluation.pass,
      directModelPass: answer.directModel.evaluation.pass
    }))
  );

  const projectMemoryWins = flattened.filter((item) => item.projectMemoryPass && !item.directModelPass).length;
  const directModelWins = flattened.filter((item) => !item.projectMemoryPass && item.directModelPass).length;
  const ties = flattened.filter((item) => item.projectMemoryPass === item.directModelPass).length;
  const projectMemoryScore = flattened.filter((item) => item.projectMemoryPass).length;
  const directModelScore = flattened.filter((item) => item.directModelPass).length;

  report.endedAt = msNow();
  report.summary = {
    totalRounds: report.checkpoints.length,
    totalQuestions: flattened.length,
    projectMemoryScore,
    directModelScore,
    projectMemoryWins,
    directModelWins,
    ties
  };

  const outDir = path.join(root, cfg.outputDir);
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `visible-comparison-${stamp}.json`);
  const mdPath = path.join(outDir, `visible-comparison-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines = [
    `# ${fixture.demoName}`,
    "",
    `- Started: ${report.startedAt}`,
    `- Ended: ${report.endedAt}`,
    `- Fixture: ${cfg.fixture}`,
    `- Baseline: Direct model (${baselineMode})`,
    `- Model: ${cfg.modelName}`,
    "",
    "## Score",
    "",
    `- Rounds evaluated: ${report.checkpoints.length}`,
    `- Questions evaluated: ${flattened.length}`,
    `- Project Memory passed: ${projectMemoryScore}/${flattened.length}`,
    `- Direct model passed: ${directModelScore}/${flattened.length}`,
    `- Project Memory wins: ${projectMemoryWins}`,
    `- Direct model wins: ${directModelWins}`,
    `- Ties: ${ties}`,
    ""
  ];

  let previousAfterEvent = 0;
  for (let index = 0; index < report.checkpoints.length; index += 1) {
    const checkpoint = report.checkpoints[index];
    const roundNumber = index + 1;
    const roundEvents = fixture.events
      .slice(previousAfterEvent, checkpoint.afterEvent)
      .map((event, eventIndex) => renderEvent(event, previousAfterEvent + eventIndex));
    const rollingSummarySections = parseRollingSummary(checkpoint.rollingSummary);

    lines.push(`## Round ${roundNumber}: ${checkpoint.label}`);
    lines.push("");
    lines.push(`- Checkpoint: after event ${checkpoint.afterEvent}`);
    lines.push(`- This round covers events ${previousAfterEvent + 1}-${checkpoint.afterEvent}`);
    lines.push(`- Digest: ${checkpoint.digestId}`);
    lines.push("");
    lines.push("**Input In This Round**");
    lines.push("");
    for (const event of roundEvents) {
      lines.push(`- ${event}`);
    }
    lines.push("");
    lines.push("**Direct-Model Rolling Summary At This Point**");
    lines.push("");
    pushSection(lines, "Goal", rollingSummarySections.goal);
    pushSection(lines, "Constraints", rollingSummarySections.constraints);
    pushSection(lines, "Decisions", rollingSummarySections.decisions);
    pushSection(lines, "Open Todos", rollingSummarySections.todos);
    pushSection(lines, "Status", rollingSummarySections.status);
    pushSection(lines, "Noise", rollingSummarySections.noise);
    pushSection(lines, "Other", rollingSummarySections.other);

    for (const answer of checkpoint.answers) {
      const pmVerdict = answer.projectMemory.evaluation.pass ? "pass" : "fail";
      const directVerdict = answer.directModel.evaluation.pass ? "pass" : "fail";
      lines.push(`### Question: ${answer.question}`);
      lines.push("");
      lines.push("**Check Rules**");
      lines.push("");
      if (answer.mustIncludeAny.length) {
        lines.push(`- Must include one of: ${answer.mustIncludeAny.join(" | ")}`);
      }
      if (answer.mustIncludeAll.length) {
        lines.push(`- Must include all: ${answer.mustIncludeAll.join(" | ")}`);
      }
      if (answer.mustAvoidAny.length) {
        lines.push(`- Must avoid: ${answer.mustAvoidAny.join(" | ")}`);
      }
      lines.push("");
      lines.push("**Answers**");
      lines.push("");
      lines.push(`- Project Memory (${pmVerdict}): ${answer.projectMemory.answer}`);
      lines.push(`- Direct model (${directVerdict}): ${answer.directModel.answer}`);
      lines.push("");
    }

    previousAfterEvent = checkpoint.afterEvent;
  }

  writeFileSync(mdPath, `${lines.join("\n")}\n`);

  // eslint-disable-next-line no-console
  console.log(`Visible comparison complete.`);
  // eslint-disable-next-line no-console
  console.log(`Report: ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`Report: ${mdPath}`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Visible comparison failed:", err.message || err);
  process.exit(1);
});
