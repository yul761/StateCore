#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "benchmark-fixtures");
mkdirSync(outDir, { recursive: true });

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeFixture(name, opts) {
  const rng = mulberry32(opts.seed);
  const events = [];
  const goals = [opts.goal.replace(/^goal:\s*/i, "").trim()];
  const constraints = opts.constraints.map((item) => item.replace(/^constraint:\s*/i, "").trim());
  const decisions = [];
  const todos = [];

  events.push({ type: "document", key: "doc:goal", content: opts.goal });
  events.push({ type: "document", key: "doc:constraints", content: opts.constraints.join("\n") });

  for (let i = 0; i < opts.total; i += 1) {
    const roll = rng();
    if (roll < opts.decisionRate) {
      const text = `We decide to prioritize ${opts.topic} batch ${i}`;
      events.push({ type: "stream", content: text });
      decisions.push(text);
    } else if (roll < opts.decisionRate + opts.todoRate) {
      const text = `validate ${opts.topic} metric ${i}`;
      events.push({ type: "stream", content: `TODO: ${text}` });
      todos.push(text);
    } else if (roll < opts.decisionRate + opts.todoRate + opts.blockerRate) {
      events.push({ type: "stream", content: `Blocked by ${opts.blocker} ${i}` });
    } else if (roll < opts.decisionRate + opts.todoRate + opts.blockerRate + opts.statusRate) {
      events.push({ type: "stream", content: `Status update: processed ${opts.topic} item ${i}` });
    } else {
      events.push({ type: "stream", content: `noise ping ${Math.floor(rng() * 1000)}` });
    }
  }

  const retrieveCases = [
    { query: "What did we decide?", expected: "decide", aliases: ["decision", "agreed", "we decide", "we will"] },
    { query: "What constraints exist?", expected: "constraint", aliases: ["limitation", "must", "cannot", "blocked"] },
    { query: "Any blockers?", expected: "blocked", aliases: ["blocker", "constraint", "risk"] },
    { query: "What todos are pending?", expected: "todo", aliases: ["next step", "action item", "pending", "follow up"] }
  ];

  const payload = {
    gold: {
      goal: goals,
      constraints,
      decisions,
      todos
    },
    events,
    retrieveCases
  };
  const outPath = path.join(outDir, `${name}.json`);
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath}`);
}

makeFixture("decision-heavy", {
  seed: 11,
  total: 80,
  decisionRate: 0.35,
  todoRate: 0.15,
  blockerRate: 0.1,
  statusRate: 0.2,
  topic: "consistency",
  blocker: "queue latency",
  goal: "goal: maximize digest consistency under noisy streams",
  constraints: ["constraint: avoid hosted dependencies", "constraint: keep api stable"]
});

makeFixture("noise-heavy", {
  seed: 21,
  total: 120,
  decisionRate: 0.08,
  todoRate: 0.1,
  blockerRate: 0.05,
  statusRate: 0.12,
  topic: "retrieval",
  blocker: "index drift",
  goal: "goal: evaluate retrieval robustness under noise",
  constraints: ["constraint: no vector index", "constraint: deterministic scoring"]
});

{
  const payload = {
    gold: {
      goal: ["preserve durable todos under temporary task pileups"],
      constraints: ["self-hosted first", "keep api stable"],
      decisions: [
        "We decide to keep durable todos separate from short-lived execution noise",
        "We decide to preserve project roadmap todos across cleanup chatter"
      ],
      todos: [
        "define drift metrics",
        "document replay checks",
        "ship assistant runtime reference flow"
      ],
      transientTodos: [
        "temporary queue cleanup pass 1",
        "temporary benchmark markdown polish 2",
        "temporary retry log cleanup 3",
        "temporary fixture review 4",
        "temporary report formatting 5"
      ]
    },
    events: [
      { type: "document", key: "doc:goal", content: "goal: preserve durable todos under temporary task pileups" },
      { type: "document", key: "doc:constraints", content: "constraint: self-hosted first\nconstraint: keep api stable" },
      { type: "document", key: "doc:plan", content: "todo: define drift metrics\ntodo: document replay checks\ntodo: ship assistant runtime reference flow" },
      { type: "stream", content: "We decide to keep durable todos separate from short-lived execution noise" },
      { type: "stream", content: "We decide to preserve project roadmap todos across cleanup chatter" },
      { type: "stream", content: "TODO: temporary queue cleanup pass 1" },
      { type: "stream", content: "Status update: completed temporary queue cleanup pass 1" },
      { type: "stream", content: "TODO: temporary benchmark markdown polish 2" },
      { type: "stream", content: "Status update: completed temporary benchmark markdown polish 2" },
      { type: "stream", content: "TODO: temporary retry log cleanup 3" },
      { type: "stream", content: "Status update: completed temporary retry log cleanup 3" },
      { type: "stream", content: "TODO: temporary fixture review 4" },
      { type: "stream", content: "Status update: completed temporary fixture review 4" },
      { type: "stream", content: "TODO: temporary report formatting 5" },
      { type: "stream", content: "Status update: completed temporary report formatting 5" },
      { type: "stream", content: "Blocked by local runtime churn during temporary cleanup rotation" },
      { type: "stream", content: "Status update: durable roadmap todos should remain unchanged despite cleanup chatter" },
      { type: "stream", content: "noise ping 101" },
      { type: "stream", content: "noise ping 202" },
      { type: "stream", content: "noise ping 303" }
    ],
    retrieveCases: [
      { query: "What durable todos are still pending?", expected: "todo", aliases: ["pending", "durable todos", "next step"] },
      { query: "What did we decide about temporary tasks?", expected: "decide", aliases: ["decision", "separate", "execution noise"] },
      { query: "What constraints still apply?", expected: "constraint", aliases: ["must", "cannot", "keep api stable"] }
    ]
  };
  const outPath = path.join(outDir, "todo-pileup.json");
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath}`);
}
