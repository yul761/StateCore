import { homedir } from "node:os";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../package.json";
import { runExport } from "./cli/export";
import { hookMain } from "./cli/hook";
import { createEmbeddedBackend } from "./embedded";
import { createHttpBackend } from "./http-backend";
import { resolveScopeName } from "./scope";
import { createServer } from "./server";
import type { MemoryBackend } from "./backend";

/** `--data <dir>`, `--url <base>` and `--scope <name>` from `argv` (already sliced past node/script and, for a subcommand, past its name). Missing flags resolve to defaults, not this parser. */
export function parseArgs(argv: string[]): { dataDir?: string; url?: string; scope?: string } {
  const out: { dataDir?: string; url?: string; scope?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--data") out.dataDir = argv[++i];
    else if (argv[i] === "--url") out.url = argv[++i];
    else if (argv[i] === "--scope") out.scope = argv[++i];
  }
  return out;
}

const SUBCOMMANDS = ["export", "hook"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

function isSubcommand(value: string | undefined): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value ?? "");
}

/** Reads all of stdin (Claude Code writes the hook payload then closes the pipe). An unattached stdin resolves to "". */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

function resolveBackend(args: { dataDir?: string; url?: string }, env: NodeJS.ProcessEnv): MemoryBackend {
  if (args.url) {
    return createHttpBackend({
      baseUrl: args.url,
      userId: env.STATECORE_USER_ID?.trim() || "local",
      scopeName: resolveScopeName(process.cwd(), env)
    });
  }
  return createEmbeddedBackend({
    dataDir: args.dataDir ?? join(homedir(), ".statecore"),
    scopeName: resolveScopeName(process.cwd(), env),
    env
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const defaultDataDir = join(homedir(), ".statecore");

  if (isSubcommand(argv[0])) {
    const args = parseArgs(argv.slice(1));
    if (argv[0] === "export") {
      const { found } = await runExport({ dataDir: args.dataDir ?? defaultDataDir, scopeName: args.scope }, (text) => process.stdout.write(text));
      if (!found) process.exitCode = 1;
    }
    if (argv[0] === "hook") {
      const stdin = await readStdin();
      const hookArgs = parseArgs(argv.slice(2));
      await hookMain(argv[1], stdin, {
        dataDir: hookArgs.dataDir ?? defaultDataDir,
        env: process.env,
        out: (text) => process.stdout.write(text),
        err: (text) => process.stderr.write(text),
        scopeName: hookArgs.scope
      });
      return;
    }
    return;
  }

  const args = parseArgs(argv);
  const backend = resolveBackend(args, process.env);
  await backend.init();

  const server = createServer(backend, pkg.version);

  await server.connect(new StdioServerTransport());
  console.error(`[statecore-mcp] ready over stdio (${args.url ? `remote ${args.url}` : `embedded ${args.dataDir ?? defaultDataDir}`})`);
}

main().catch((error) => {
  console.error("[statecore-mcp] fatal error", error);
  process.exitCode = 1;
});
