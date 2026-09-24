import { describe, it, expect } from "vitest";
import { formatMemoryBlock, MEMORY_BLOCK_HEADER } from "../src/cli/hook-format";

describe("formatMemoryBlock", () => {
  it("returns null when there is nothing to inject", () => {
    expect(formatMemoryBlock({})).toBeNull();
    expect(formatMemoryBlock({ handoff: null, digest: null, factRegistry: [], events: [] })).toBeNull();
  });

  it("renders handoff, digest, facts and events under the fixed header, in that order", () => {
    const block = formatMemoryBlock({
      handoff: { content: "stopped mid-migration\nNext steps:\n- wire the controller" },
      digest: "The project is a pnpm monorepo.",
      factRegistry: [{ content: "We use pnpm" }, { content: "CI runs on Node 22" }],
      events: [{ content: "user said: switch to turbo", createdAt: "2026-09-23T10:00:00.000Z" }]
    })!;
    const lines = block.split("\n");
    expect(lines[0]).toBe(MEMORY_BLOCK_HEADER);
    expect(block).toContain("### Handoff from the previous session\nstopped mid-migration\nNext steps:\n- wire the controller");
    expect(block).toContain("### Digest\nThe project is a pnpm monorepo.");
    expect(block).toContain("### Facts\n- We use pnpm\n- CI runs on Node 22");
    expect(block).toContain("### Recent events\n- [2026-09-23] user said: switch to turbo");
    expect(block.indexOf("### Handoff")).toBeLessThan(block.indexOf("### Digest"));
    expect(block.indexOf("### Digest")).toBeLessThan(block.indexOf("### Facts"));
    expect(block.indexOf("### Facts")).toBeLessThan(block.indexOf("### Recent events"));
  });

  it("omits sections that are empty", () => {
    const block = formatMemoryBlock({ factRegistry: [{ content: "only a fact" }] })!;
    expect(block).toBe(`${MEMORY_BLOCK_HEADER}\n\n### Facts\n- only a fact`);
  });
});
