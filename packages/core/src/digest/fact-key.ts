// The display-fact key: what `forget` records and what `facts()` filters on.
// Lives here rather than in memory-facts.ts so the registry write path
// (fact-registry.ts) can match forgotten notes without importing memory-facts,
// which itself imports the digest barrel.
import { createHash } from "node:crypto";

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeFactKey(group: string, content: string): string {
  return createHash("sha256")
    .update(`${normalize(group)}|${normalize(content)}`)
    .digest("hex")
    .slice(0, 16);
}
