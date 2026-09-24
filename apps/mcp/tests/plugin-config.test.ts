import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const pluginRoot = resolve(repoRoot, "plugins/claude-code");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("Claude Code plugin config", () => {
  it("plugin.json names the plugin and tracks the package version", () => {
    const manifest = read(resolve(pluginRoot, ".claude-plugin/plugin.json"));
    const pkg = read(resolve(repoRoot, "apps/mcp/package.json"));
    expect(manifest.name).toBe("statecore");
    expect(manifest.version).toBe(pkg.version);
    expect(typeof manifest.description).toBe("string");
  });

  it("hooks.json wires exactly the four events to `npx -y statecore-mcp@<version> hook <event>`, async on the capture hooks only", () => {
    const pkg = read(resolve(repoRoot, "apps/mcp/package.json"));
    const hooks = read(resolve(pluginRoot, "hooks/hooks.json")).hooks;
    expect(Object.keys(hooks).sort()).toEqual(["PreCompact", "SessionStart", "Stop", "UserPromptSubmit"]);

    const pinned = (event: string) => `npx -y statecore-mcp@${pkg.version} hook ${event}`;
    const commands: Record<string, string[]> = {};
    // Whether each event's single hook entry sets `async: true`. Only the
    // capture hooks (UserPromptSubmit, Stop) may block on the host without
    // being noticed by anything but the next event, so only those two are
    // allowed to run async: true; SessionStart must inject synchronously
    // (the host reads its stdout for additionalContext) and PreCompact must
    // finish its digestNow() before compaction proceeds.
    const asyncFlags: Record<string, unknown[]> = {};
    for (const [event, groups] of Object.entries<any>(hooks)) {
      commands[event] = groups.flatMap((g: any) => g.hooks.map((h: any) => h.command));
      asyncFlags[event] = groups.flatMap((g: any) => g.hooks.map((h: any) => h.async));
      for (const g of groups) for (const h of g.hooks) expect(h.type).toBe("command");
    }
    expect(commands.SessionStart).toEqual([pinned("session-start")]);
    expect(commands.UserPromptSubmit).toEqual([pinned("user-prompt")]);
    expect(commands.Stop).toEqual([pinned("stop")]);
    expect(commands.PreCompact).toEqual([pinned("pre-compact")]);

    expect(asyncFlags.UserPromptSubmit).toEqual([true]);
    expect(asyncFlags.Stop).toEqual([true]);
    // Absent or false, never true, on the two synchronous events.
    for (const flag of asyncFlags.SessionStart) expect(flag).not.toBe(true);
    for (const flag of asyncFlags.PreCompact) expect(flag).not.toBe(true);

    // "fork" (a Claude Code SessionStart source alongside startup/resume/
    // clear/compact) also needs the memory block injected.
    expect(hooks.SessionStart[0].matcher).toBe("startup|resume|clear|compact|fork");
    expect(hooks.PreCompact[0].matcher).toBe("auto|manual");
  });

  it(".mcp.json runs the server with npx, pinned to the package version", () => {
    const pkg = read(resolve(repoRoot, "apps/mcp/package.json"));
    const mcp = read(resolve(pluginRoot, ".mcp.json"));
    expect(mcp.statecore).toEqual({ command: "npx", args: ["-y", `statecore-mcp@${pkg.version}`] });
  });

  it("marketplace.json publishes the plugin from the plugins/claude-code subdirectory and tracks the package version", () => {
    const pkg = read(resolve(repoRoot, "apps/mcp/package.json"));
    const market = read(resolve(repoRoot, ".claude-plugin/marketplace.json"));
    expect(market.name).toBe("statecore");
    expect(market.metadata.version).toBe(pkg.version);
    const entry = market.plugins.find((p: any) => p.name === "statecore");
    // "git-subdir" with no `ref`/`sha` installs from the source repo's default
    // branch — so this marketplace entry always tracks `main`, not a pinned
    // release; the version pinning above (hooks.json / .mcp.json commands)
    // is what actually fixes the npx-installed statecore-mcp version.
    expect(entry.source).toEqual({ source: "git-subdir", url: "https://github.com/yul761/StateCore.git", path: "plugins/claude-code" });
  });
});
