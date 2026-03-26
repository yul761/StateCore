export const DEMO_BRAND = {
  eyebrow: "Project Memory",
  title: "Demo Web",
  subtitle: "A React demo shell that stays on the intended public runtime surface."
};

export const SUGGESTED_DEMO_TURNS = [
  ["What is the current goal?", "Current goal"],
  ["What constraints still apply?", "Constraints"],
  ["What key decisions have we made?", "Decisions"],
  ["What work remains open?", "Open work"],
  ["Summarize how the three layers behave on this scope.", "Three-layer summary"]
] as const;

export const DEMO_FLOW_STEPS = [
  ["1", "Create or pick a scope", "Each scope is its own long-running memory thread."],
  ["2", "Ask a state question", "Start with goal, constraints, decisions, or open work."],
  ["3", "Watch the layers move", "Fast answers first, then Working Memory, then State Layer commit."]
] as const;

export const EMPTY_CHAT_HINTS = [
  'Start with a state question like "What is the current goal?" and watch the three layers react.',
  "Then use the hero card, turn story, and pipeline to see what changed."
] as const;

export const CHAT_HINT =
  "This history is stored locally per scope in the demo shell so you can switch sessions without losing the visible conversation thread.";

export const PIPELINE_LEGEND =
  "Each turn moves left to right: immediate answer first, then Working Memory, then authoritative State Layer consolidation.";
