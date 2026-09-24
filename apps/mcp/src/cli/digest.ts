import { createEmbeddedBackend } from "../embedded";
import type { DigestChatModel } from "../digest";

/** `statecore-mcp digest`: one explicit distillation pass for a scope, printed as the DigestNowResult JSON. Exit 1 only when the pipeline itself failed; "nothing pending" and "no model" are ordinary outcomes. */
export async function runDigestCommand(
  args: { dataDir: string; scopeName: string; env: NodeJS.ProcessEnv; digestLlm?: DigestChatModel },
  out: (text: string) => void
): Promise<{ exitCode: 0 | 1 }> {
  const backend = createEmbeddedBackend({ dataDir: args.dataDir, scopeName: args.scopeName, env: args.env, digestLlm: args.digestLlm, backgroundDigest: false });
  try {
    await backend.init();
    const result = await backend.digestNow();
    out(`${JSON.stringify(result)}\n`);
    return { exitCode: !result.ran && result.reason === "failed" ? 1 : 0 };
  } finally {
    await backend.close();
  }
}
