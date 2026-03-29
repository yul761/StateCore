export const DEMO_BRAND = {
  eyebrow: "StateCore",
  title: "StateCore",
  subtitle: "A public window into low-drift memory for long-running LLM systems."
};

export type DemoTemplate = {
  id: string;
  title: string;
  description: string;
  scopeName: string;
  watch: string[];
  compare?: {
    projectMemory: string;
    plainLlm: string;
    whyItMatters: string;
    score?: {
      projectMemory: string;
      plainLlm: string;
      rounds: string;
    };
    checkpoints?: Array<{
      label: string;
      question: string;
      projectMemoryAnswer: string;
      plainLlmAnswer: string;
      takeaway: string;
    }>;
  };
  turns: Array<{
    label: string;
    prompt: string;
  }>;
};

export const DEMO_TEMPLATES: DemoTemplate[] = [
  {
    id: "natural-language-goal",
    title: "Natural-language goal capture",
    description: "Use ordinary planning language and watch it land in Working Memory first, then commit into Stable State.",
    scopeName: "Fitness planning demo",
    watch: ["Natural-language goal extraction", "Constraint carryover", "Durable recall"],
    compare: {
      projectMemory: "Turns ordinary planning language into tracked state, then recalls the same goal and constraints later without needing rigid field labels.",
      plainLlm: "Often answers helpfully in the moment, but treats the conversation like general advice instead of durable state to preserve turn over turn.",
      whyItMatters: "A product memory system should not require the user to write `goal:` and `constraint:` just to preserve intent.",
      score: {
        projectMemory: "3/3",
        plainLlm: "1/3",
        rounds: "3 rounds"
      },
      checkpoints: [
        {
          label: "After Step 1",
          question: "What is this person trying to do?",
          projectMemoryAnswer: "Get fit, with a stretch target around squatting 200kg.",
          plainLlmAnswer: "Get fit.",
          takeaway: "The baseline keeps the broad idea, but drops the more specific target immediately."
        },
        {
          label: "After Step 2",
          question: "What constraints now matter?",
          projectMemoryAnswer: "Keep the plan sustainable and avoid wrecking the knees.",
          plainLlmAnswer: "Do something sustainable.",
          takeaway: "The knee-safety constraint is the kind of detail a plain conversational model often compresses away."
        },
        {
          label: "After Step 3",
          question: "What is the current goal and what constraints should still apply?",
          projectMemoryAnswer: "Get fit, with the 200kg squat target still in view, while keeping the approach sustainable and knee-safe.",
          plainLlmAnswer: "Get fit in a sustainable way.",
          takeaway: "StateCore keeps both the target and the safety constraint; the baseline collapses them into generic advice."
        }
      ]
    },
    turns: [
      {
        label: "Step 1",
        prompt: "I am looking to get fit, maybe squat to 200kg."
      },
      {
        label: "Step 2",
        prompt: "I prefer something sustainable and I do not want to wreck my knees."
      },
      {
        label: "Step 3",
        prompt: "What is my current goal, and what constraints should still apply?"
      }
    ]
  },
  {
    id: "goal-shift",
    title: "Goal shift retention",
    description: "Change the project direction mid-thread and verify that the latest goal wins cleanly.",
    scopeName: "Goal shift demo",
    watch: ["Latest goal", "Pivot clarity", "Old-goal removal"],
    compare: {
      projectMemory: "Keeps the latest product goal as the active direction once the pivot happens and stops treating the old goal as live.",
      plainLlm: "Often blends the old chat-app idea with the new runtime goal or drops part of the pivot.",
      whyItMatters: "This is the most visible drift pattern: old goals stick around after the conversation moves on."
      ,
      score: {
        projectMemory: "3/3",
        plainLlm: "1/3",
        rounds: "3 rounds"
      },
      checkpoints: [
        {
          label: "After Step 1",
          question: "What are we building?",
          projectMemoryAnswer: "A desktop chat app for local models.",
          plainLlmAnswer: "A desktop chat app for local models.",
          takeaway: "At the start, both sides still agree."
        },
        {
          label: "After Step 2",
          question: "What are we building now?",
          projectMemoryAnswer: "A self-hosted long-term memory runtime for local models.",
          plainLlmAnswer: "A desktop chat app with memory features for local models.",
          takeaway: "The baseline blends the old product with the pivot instead of switching cleanly."
        },
        {
          label: "After Step 3",
          question: "What is the current product goal?",
          projectMemoryAnswer: "Ship a self-hosted long-term memory runtime for local models.",
          plainLlmAnswer: "Ship a self-hosted memory runtime for local models.",
          takeaway: "StateCore keeps the final goal intact; the baseline drops the long-term part."
        }
      ]
    },
    turns: [
      {
        label: "Step 1",
        prompt: "We started out building a desktop chat app for local models."
      },
      {
        label: "Step 2",
        prompt: "Actually the product direction changed: we are building a self-hosted long-term memory runtime for local models."
      },
      {
        label: "Step 3",
        prompt: "What is the current product goal?"
      }
    ]
  },
  {
    id: "constraint-retention",
    title: "Constraint retention",
    description: "Feed multiple constraints and later ask whether the runtime still keeps them all.",
    scopeName: "Constraint retention demo",
    watch: ["Constraint completeness", "Constraint wording", "Constraint recall"],
    compare: {
      projectMemory: "Keeps the full constraint set queryable after a few more turns.",
      plainLlm: "Usually compresses the list, paraphrases too much, or quietly drops one of the constraints.",
      whyItMatters: "Constraint loss is one of the easiest ways for agent behavior to drift in longer sessions.",
      score: {
        projectMemory: "3/3",
        plainLlm: "1/3",
        rounds: "3 rounds"
      },
      checkpoints: [
        {
          label: "After Step 1",
          question: "What is the current direction?",
          projectMemoryAnswer: "Ship a self-hosted memory runtime for local models.",
          plainLlmAnswer: "Ship a self-hosted memory runtime for local models.",
          takeaway: "Before constraints arrive, both answers look fine."
        },
        {
          label: "After Step 2",
          question: "What constraints now apply?",
          projectMemoryAnswer: "Keep the API stable, stay self-hosted first, and do not become a general-purpose agent platform.",
          plainLlmAnswer: "Stay self-hosted first and keep the product focused.",
          takeaway: "The baseline already compresses away API stability and the exact platform boundary."
        },
        {
          label: "After Step 3",
          question: "What constraints still apply?",
          projectMemoryAnswer: "API stability, self-hosted first, and not turning into a general-purpose agent platform still all apply.",
          plainLlmAnswer: "Stay self-hosted and keep the scope narrow.",
          takeaway: "StateCore keeps the full set; the baseline turns them into vague summary language."
        }
      ]
    },
    turns: [
      {
        label: "Step 1",
        prompt: "We need to ship a self-hosted memory runtime for local models."
      },
      {
        label: "Step 2",
        prompt: "Keep the API stable, stay self-hosted first, and do not turn this into a general-purpose agent platform."
      },
      {
        label: "Step 3",
        prompt: "What constraints still apply?"
      }
    ]
  },
  {
    id: "decision-tracking",
    title: "Decision tracking",
    description: "Record architectural decisions and check whether they stay queryable as durable truth.",
    scopeName: "Decision tracking demo",
    watch: ["Decision preservation", "Decision wording", "Decision recall"],
    compare: {
      projectMemory: "Treats explicit decisions as memory-worthy state and keeps them separate from general status.",
      plainLlm: "Tends to blur decisions into generic summary text instead of keeping them as durable choices.",
      whyItMatters: "Losing decisions makes later planning look coherent while still forgetting what was actually agreed.",
      score: {
        projectMemory: "3/3",
        plainLlm: "1/3",
        rounds: "3 rounds"
      },
      checkpoints: [
        {
          label: "After Step 1",
          question: "What did we decide?",
          projectMemoryAnswer: "Use Working Memory as a fast bridge and keep State Layer authoritative.",
          plainLlmAnswer: "Use some kind of memory bridge.",
          takeaway: "The baseline softens an explicit decision into a fuzzy summary."
        },
        {
          label: "After Step 2",
          question: "What decisions have we made so far?",
          projectMemoryAnswer: "Use Working Memory as a fast bridge, keep State Layer authoritative, and never let Fast Layer wait for stable digest.",
          plainLlmAnswer: "Keep memory fast and avoid blocking too much.",
          takeaway: "StateCore preserves the exact decisions; the baseline blurs them into general principles."
        },
        {
          label: "After Step 3",
          question: "What key decisions have we made?",
          projectMemoryAnswer: "Working Memory is the fast bridge, State Layer stays authoritative, and Fast Layer must never wait for stable digest.",
          plainLlmAnswer: "We decided to keep the memory system fast and reliable.",
          takeaway: "The baseline answer sounds plausible, but it no longer carries the actual agreed decisions."
        }
      ]
    },
    turns: [
      {
        label: "Step 1",
        prompt: "We decided to use Working Memory as a fast bridge and keep State Layer authoritative."
      },
      {
        label: "Step 2",
        prompt: "We also decided that Fast Layer must never wait for stable digest."
      },
      {
        label: "Step 3",
        prompt: "What key decisions have we made?"
      }
    ]
  },
  {
    id: "plain-llm-compare",
    title: "StateCore vs plain LLM",
    description: "Replay a pivot-heavy scenario and compare what StateCore preserves versus a rolling-summary baseline.",
    scopeName: "Baseline compare demo",
    watch: ["Latest goal wording", "Constraint retention", "Decision recall"],
    compare: {
      projectMemory: "In the curated drift demo, StateCore passed 7/7 checks and kept the final goal as \"self-hosted long-term memory runtime for local models.\"",
      plainLlm: "The direct rolling-summary baseline passed 4/7 and dropped the \"long-term\" part of the final goal.",
      whyItMatters: "The point is not that the model changed. The same model sees the same sequence; the memory mechanism is what changes the outcome.",
      score: {
        projectMemory: "7/7",
        plainLlm: "4/7",
        rounds: "3 rounds"
      },
      checkpoints: [
        {
          label: "Round 1: first goal",
          question: "What are we building at the start?",
          projectMemoryAnswer: "A generic local chat UI.",
          plainLlmAnswer: "A generic local chat UI.",
          takeaway: "Early on, both sides still agree."
        },
        {
          label: "Round 2: direction shift",
          question: "What is the new direction and what constraints already apply?",
          projectMemoryAnswer: "Ship a self-hosted memory layer for project assistants, keep the API stable, and stay self-hosted first.",
          plainLlmAnswer: "Build a memory-focused assistant product and probably stay self-hosted.",
          takeaway: "The baseline starts compressing the constraints as soon as the scenario becomes denser."
        },
        {
          label: "Round 3: final pivot",
          question: "What is the current project goal?",
          projectMemoryAnswer: "Ship a self-hosted long-term memory runtime for local models.",
          plainLlmAnswer: "Ship a self-hosted memory runtime for local models.",
          takeaway: "The baseline drops the long-term part of the final goal."
        },
        {
          label: "Round 3: constraints",
          question: "What constraints still apply?",
          projectMemoryAnswer: "Keeps API stability, self-hosted-first, and not becoming a general-purpose agent platform all together.",
          plainLlmAnswer: "Usually keeps the broad shape, but compresses and paraphrases the set into looser summary text.",
          takeaway: "Constraint loss often starts as compression before it becomes omission."
        },
        {
          label: "Round 3: decisions",
          question: "What key decisions have we made?",
          projectMemoryAnswer: "Preserves low-drift reliability and assistant runtime as a product boundary as explicit decisions.",
          plainLlmAnswer: "Blends decisions into a general status summary instead of keeping them as agreed choices.",
          takeaway: "Decision drift makes later planning look coherent while forgetting what was actually decided."
        }
      ]
    },
    turns: [
      {
        label: "Step 1",
        prompt: "We started by exploring a generic local chat UI."
      },
      {
        label: "Step 2",
        prompt: "The direction shifted: ship a self-hosted memory layer for project assistants. Keep the API stable and self-hosted first."
      },
      {
        label: "Step 3",
        prompt: "The final product goal is a self-hosted long-term memory runtime for local models. What is the current goal and which constraints still apply?"
      }
    ]
  }
];

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
  "Pick a compare scenario to see the same sequence side by side.",
  "The point is not just the final answer. Watch where the two answers start to diverge step by step."
] as const;

export const CHAT_HINT =
  "This history is stored locally per scope in the demo shell so you can switch sessions without losing the visible conversation thread.";

export const PIPELINE_LEGEND =
  "Each turn moves left to right: immediate answer first, then Working Memory, then authoritative State Layer consolidation.";
