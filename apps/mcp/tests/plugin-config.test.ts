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

  it("hooks.json wires exactly the four events to `npx -y statecore-mcp hook <event>`", () => {
    const hooks = read(resolve(pluginRoot, "hooks/hooks.json")).hooks;
    expect(Object.keys(hooks).sort()).toEqual(["PreCompact", "SessionStart", "Stop", "UserPromptSubmit"]);
    const commands: Record<string, string[]> = {};
    for (const [event, groups] of Object.entries<any>(hooks)) {
      commands[event] = groups.flatMap((g: any) => g.hooks.map((h: any) => h.command));
      for (const g of groups) for (const h of g.hooks) expect(h.type).toBe("command");
    }
    expect(commands.SessionStart).toEqual(["npx -y statecore-mcp hook session-start"]);
    expect(commands.UserPromptSubmit).toEqual(["npx -y statecore-mcp hook user-prompt"]);
    expect(commands.Stop).toEqual(["npx -y statecore-mcp hook stop"]);
    expect(commands.PreCompact).toEqual(["npx -y statecore-mcp hook pre-compact"]);
    expect(hooks.SessionStart[0].matcher).toBe("startup|resume|clear|compact");
    expect(hooks.PreCompact[0].matcher).toBe("auto|manual");
  });

  it(".mcp.json runs the server with npx", () => {
    const mcp = read(resolve(pluginRoot, ".mcp.json"));
    expect(mcp.statecore).toEqual({ command: "npx", args: ["-y", "statecore-mcp"] });
  });

  it("marketplace.json publishes the plugin from the plugins/claude-code subdirectory", () => {
    const market = read(resolve(repoRoot, ".claude-plugin/marketplace.json"));
    expect(market.name).toBe("statecore");
    const entry = market.plugins.find((p: any) => p.name === "statecore");
    expect(entry.source).toEqual({ source: "git-subdir", url: "https://github.com/yul761/StateCore.git", path: "plugins/claude-code" });
  });
});
