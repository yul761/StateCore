import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDigestCommand } from "../src/cli/digest";
import { createEmbeddedBackend } from "../src/embedded";

const STAGE2_OUTPUT = { summary: "Digested on demand.", changes: ["Recorded one event."], nextSteps: ["Continue."], profileFacts: [] };

describe("statecore-mcp digest", () => {
  it("keyless: prints {ran:false, reason:'no-llm'} and exits 0", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sc-digest-cli-"));
    let out = "";
    const res = await runDigestCommand({ dataDir, scopeName: "/p", env: {} as any }, (t) => (out += t));
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(out)).toEqual({ ran: false, reason: "no-llm" });
  });

  it("with a model and pending events: runs one digest, prints {ran:true}, exits 0; a failing pipeline exits 1", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sc-digest-cli-run-"));
    const be = createEmbeddedBackend({ dataDir, scopeName: "/p", env: {} as any, backgroundDigest: false });
    await be.init();
    await be.remember({ text: "pending conversational turn", consolidate: true });
    await be.close();

    let out = "";
    let calls = 0;
    const ok = await runDigestCommand(
      { dataDir, scopeName: "/p", env: {} as any, digestLlm: { chat: async () => { calls += 1; return JSON.stringify(STAGE2_OUTPUT); } } },
      (t) => (out += t)
    );
    expect(ok.exitCode).toBe(0);
    expect(JSON.parse(out)).toEqual({ ran: true });
    expect(calls).toBeGreaterThanOrEqual(1);

    const be2 = createEmbeddedBackend({ dataDir, scopeName: "/p", env: {} as any, backgroundDigest: false });
    await be2.init();
    await be2.remember({ text: "another pending turn", consolidate: true });
    await be2.close();
    out = "";
    const bad = await runDigestCommand(
      { dataDir, scopeName: "/p", env: {} as any, digestLlm: { chat: async () => { throw new Error("provider down"); } } },
      (t) => (out += t)
    );
    expect(bad.exitCode).toBe(1);
    expect(JSON.parse(out)).toEqual({ ran: false, reason: "failed" });
  });
});
