import { useEffect, useState } from "react";

import type { getDemoConfig } from "./config";
import { runAgentScenarioRemote } from "./api";
import { AGENT_SCENARIOS } from "./agent-scenarios";
import { FactPills } from "./ui";
import type { AgentScenarioRunShape } from "./lib";

export function AgentDemoPanel(props: {
  config: ReturnType<typeof getDemoConfig>;
  guestUserId: string;
  onOpenChat: () => void;
  onOpenCompare: () => void;
}) {
  const { config, guestUserId, onOpenChat, onOpenCompare } = props;
  const [selectedScenarioId, setSelectedScenarioId] = useState(AGENT_SCENARIOS[0]?.id ?? "");
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [runResults, setRunResults] = useState<Record<string, AgentScenarioRunShape>>({});
  const [runningScenarioId, setRunningScenarioId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const scenario = AGENT_SCENARIOS.find((item) => item.id === selectedScenarioId) || AGENT_SCENARIOS[0];
  const liveRun = scenario ? runResults[scenario.id] ?? null : null;
  const renderedSteps = scenario
    ? scenario.steps.map((step, index) => {
        const liveStep = liveRun?.steps[index];
        return {
          ...step,
          agentOutput: liveStep?.answer ?? step.agentOutput,
          workingWrites: liveStep?.workingWrites.length ? liveStep.workingWrites : step.workingWrites,
          stableWrites: liveStep?.stableWrites.length ? liveStep.stableWrites : step.stableWrites,
          nextAgentSees: liveStep?.nextAgentSees.length ? liveStep.nextAgentSees : step.nextAgentSees
        };
      })
    : [];
  const isStarted = currentStepIndex >= 0;
  const isComplete = scenario ? currentStepIndex >= renderedSteps.length - 1 && currentStepIndex >= 0 : false;

  useEffect(() => {
    setCurrentStepIndex(-1);
    setIsPlaying(false);
    setRunError(null);
  }, [selectedScenarioId]);

  useEffect(() => {
    if (!scenario || !isPlaying) return;
    if (currentStepIndex >= renderedSteps.length - 1) {
      setIsPlaying(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setCurrentStepIndex((value) => value + 1);
    }, 1600);

    return () => window.clearTimeout(timer);
  }, [currentStepIndex, isPlaying, renderedSteps.length, scenario]);

  if (!scenario) return null;

  const visibleSteps = renderedSteps.slice(0, Math.max(currentStepIndex + 1, 0));
  const currentStep = isStarted ? renderedSteps[Math.min(currentStepIndex, renderedSteps.length - 1)] : null;
  const currentAgent = currentStep ? scenario.agents.find((agent) => agent.id === currentStep.activeAgent) || null : null;

  const latestWorkingWrites = visibleSteps.flatMap((step) => step.workingWrites);
  const latestStableWrites = visibleSteps.flatMap((step) => step.stableWrites);
  const latestReads = currentStep?.nextAgentSees || [];
  const latestBaselineReads = currentStep?.baselineSees || [];
  const completedSteps = Math.max(currentStepIndex + 1, 0);

  async function handlePlay() {
    if (!scenario) return;
    setRunError(null);

    if (!runResults[scenario.id]) {
      try {
        setRunningScenarioId(scenario.id);
        const result = await runAgentScenarioRemote(config, guestUserId, scenario.id);
        setRunResults((current) => ({ ...current, [scenario.id]: result }));
      } catch (error) {
        setRunError(String((error as Error).message || error));
        return;
      } finally {
        setRunningScenarioId(null);
      }
    }

    if (isComplete) {
      setCurrentStepIndex(0);
      setIsPlaying(true);
      return;
    }

    setIsPlaying(true);
    if (currentStepIndex < 0) {
      setCurrentStepIndex(0);
    }
  }

  function handlePause() {
    setIsPlaying(false);
  }

  function handleNext() {
    setIsPlaying(false);
    setCurrentStepIndex((value) => Math.min(value + 1, renderedSteps.length - 1));
  }

  function handleReset() {
    setIsPlaying(false);
    setCurrentStepIndex(-1);
  }

  return (
    <section className="panel agent-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Agents</div>
          <h2>Why agent handoffs drift without shared state</h2>
        </div>
      </div>

      <div className="agent-hero">
        <div className="agent-hero-copy">
          <p className="muted">
            This page is not trying to show that StateCore can run three agents. It shows the real product advantage: when multiple agents
            hand work off, StateCore keeps the same goal, constraints, risks, and decisions visible, while a plain stack drifts.
          </p>
          <FactPills items={scenario.watch} />
        </div>
        <div className="agent-control-rail">
          <div className="field-label">Scenario</div>
          <div className="agent-scenario-switcher">
            {AGENT_SCENARIOS.map((item) => (
              <button
                className={`ghost compare-template-pill${item.id === scenario.id ? " compare-template-pill-active" : ""}`}
                key={item.id}
                type="button"
                onClick={() => setSelectedScenarioId(item.id)}
              >
                {item.title}
              </button>
            ))}
          </div>
          <div className="agent-panel-toolbar">
            <button type="button" onClick={handlePlay}>
              {runningScenarioId === scenario.id ? "Running live handoff..." : isPlaying ? "Playing..." : isComplete ? "Replay handoff" : liveRun ? "Play handoff" : "Run live handoff"}
            </button>
            <button className="ghost" type="button" onClick={handlePause} disabled={!isPlaying}>
              Pause
            </button>
            <button className="ghost" type="button" onClick={handleNext} disabled={isComplete || runningScenarioId === scenario.id}>
              Step forward
            </button>
            <button className="ghost" type="button" onClick={handleReset} disabled={!isStarted}>
              Reset
            </button>
          </div>
          <div className="agent-panel-facts">
            <span className="compare-score-pill">Current step: {isStarted ? currentStep?.label : "Not started"}</span>
            <span className="compare-score-pill">
              {runningScenarioId === scenario.id
                ? "Live handoff running"
                : isPlaying
                  ? "Replay running"
                  : isComplete
                    ? "Replay complete"
                    : isStarted
                      ? "Replay paused"
                      : liveRun
                        ? "Live run ready"
                        : "Ready to run"}
            </span>
            {liveRun ? <span className="compare-score-pill">Live scope: {liveRun.scopeName}</span> : null}
            {liveRun ? <span className="compare-score-pill">Completed: {new Date(liveRun.completedAt).toLocaleTimeString()}</span> : null}
          </div>
        </div>
      </div>
      {runError ? <div className="compare-empty-state">Live handoff failed: {runError}</div> : null}

      <div className="agent-handoff-rail">
        {scenario.agents.map((agent) => {
          const isActive = currentAgent?.id === agent.id;
          const hasCompleted = visibleSteps.some((step) => step.activeAgent === agent.id);

          return (
            <article
              className={`agent-handoff-card${isActive ? " agent-handoff-card-active" : ""}${hasCompleted ? " agent-handoff-card-complete" : ""}`}
              key={agent.id}
            >
              <div className="agent-badge">{agent.label}</div>
              <h3>{agent.role}</h3>
              <p>{agent.summary}</p>
              <FactPills
                items={[
                  isActive ? "Active now" : hasCompleted ? "Completed step" : "Waiting",
                  `${visibleSteps.filter((step) => step.activeAgent === agent.id).length} handoff step${visibleSteps.filter((step) => step.activeAgent === agent.id).length === 1 ? "" : "s"}`
                ]}
              />
            </article>
          );
        })}
      </div>

      <div className="agent-score-strip">
        <article className="compare-result-pill compare-result-pill-statecore">
          <span className="compare-checkpoint-label">StateCore Preserves</span>
          <strong>{scenario.scorecard.withStateCore.length}</strong>
          <div className="muted">signal types kept aligned across the handoff</div>
        </article>
        <article className="compare-result-pill compare-result-pill-plain-llm">
          <span className="compare-checkpoint-label">Plain Stack Loses</span>
          <strong>{scenario.scorecard.withoutSharedState.length}</strong>
          <div className="muted">signal types that typically drift without StateCore</div>
        </article>
        <article className="compare-result-pill">
          <span className="compare-checkpoint-label">Step Progress</span>
          <strong>
            {completedSteps}/{scenario.steps.length}
          </strong>
          <div className="muted">{isStarted ? "handoff steps revealed so far" : "ready to play"}</div>
        </article>
      </div>

      <div className="agent-runtime-grid">
        <article className="overview-card overview-card-accent">
          <div className="eyebrow">Shared State Flow</div>
          <h3>How one agent turn becomes shared state for the next one</h3>
          {!isStarted ? (
            <p className="muted">Play the handoff to reveal what gets extracted now, what becomes durable, and what the next agent actually receives.</p>
          ) : (
            <div className="agent-memory-columns">
              <div className="agent-memory-column">
                <div className="summary-label">1. What was extracted this step</div>
                <FactPills items={latestWorkingWrites.length ? latestWorkingWrites : ["No short-term state extracted yet"]} />
              </div>
              <div className="agent-memory-column">
                <div className="summary-label">2. What became durable</div>
                <FactPills items={latestStableWrites.length ? latestStableWrites : ["Nothing has been committed into durable state yet"]} />
              </div>
              <div className="agent-memory-column">
                <div className="summary-label">3. What the next agent actually receives</div>
                <FactPills items={latestReads.length ? latestReads : ["The next agent has not received shared state yet"]} />
              </div>
            </div>
          )}
        </article>

        <article className="overview-card">
          <div className="eyebrow">Without StateCore</div>
          <h3>What the next agent is missing in a plain stack</h3>
          {isStarted ? <FactPills items={latestBaselineReads.length ? latestBaselineReads : ["The plain stack has not revealed a degraded handoff yet"]} /> : null}
          <p className="muted">
            {currentStep?.baselineFailure ||
              "A plain multi-agent handoff often sounds coherent while still dropping the exact goal, constraint, risk, or decision that mattered."}
          </p>
          <div className="compare-preview-footer">{scenario.payoff}</div>
        </article>
      </div>

      <div className="agent-runtime-grid">
        <article className="overview-card overview-card-accent">
          <div className="eyebrow">Current Handoff Verdict</div>
          <h3>What StateCore preserved on this step</h3>
          {isStarted ? (
            <FactPills items={currentStep?.preservedChecks || []} />
          ) : (
            <p className="muted">Play the handoff to reveal which goal, constraints, risks, and decisions stay intact at each step.</p>
          )}
        </article>
        <article className="overview-card">
          <div className="eyebrow">Current Baseline Loss</div>
          <h3>What a plain stack degraded on this step</h3>
          {isStarted ? (
            <FactPills items={currentStep?.lostChecks || []} />
          ) : (
            <p className="muted">The baseline column will show the exact state that got softened, blurred, or dropped during handoff.</p>
          )}
        </article>
      </div>

      <div className="agent-runtime-grid">
        <article className="overview-card overview-card-accent">
          <div className="eyebrow">Handoff Scorecard</div>
          <h3>What stays intact across agents</h3>
          <FactPills items={scenario.scorecard.withStateCore} />
        </article>
        <article className="overview-card">
          <div className="eyebrow">Where Plain Stacks Drift</div>
          <h3>What degrades during handoff</h3>
          <FactPills items={scenario.scorecard.withoutSharedState} />
        </article>
      </div>

      <div className="agent-story-grid">
        <article className="agent-story-card">
          <div className="eyebrow">Handoff Timeline</div>
          <h3>Same step, two different handoffs</h3>
          <div className="agent-story-list">
            {renderedSteps.map((step, index) => {
              const isVisible = index <= currentStepIndex;
              const agent = scenario.agents.find((item) => item.id === step.activeAgent);
              return (
                <article className={`agent-story-step${isVisible ? " agent-story-step-visible" : ""}`} key={`${scenario.id}-${step.label}`}>
                  <div className="agent-story-step-head">
                    <span className="agent-story-step-badge">{step.label}</span>
                    <span className="agent-story-step-agent">{agent?.label}</span>
                  </div>
                  <div className="agent-story-step-turn">{step.userTurn}</div>
                  <div className="agent-handoff-compare">
                    <div className="agent-handoff-lane agent-handoff-lane-statecore">
                      <div className="summary-label">With StateCore</div>
                      <div className="agent-story-step-output">
                        {isVisible ? step.agentOutput : liveRun ? "Replay to reveal the live StateCore handoff." : "Run the live handoff to reveal the StateCore path."}
                      </div>
                      {isVisible ? <FactPills items={step.preservedChecks} /> : null}
                    </div>
                    <div className="agent-handoff-lane agent-handoff-lane-baseline">
                      <div className="summary-label">Without StateCore</div>
                      <div className="agent-story-step-output">
                        {isVisible ? step.baselineFailure : "Replay to reveal the baseline failure."}
                      </div>
                      {isVisible ? <FactPills items={step.lostChecks} /> : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </article>

        <article className="agent-story-card">
          <div className="eyebrow">Why StateCore Wins</div>
          <h3>The advantage is continuity across handoff, not just answer quality</h3>
          <div className="overview-list">
            <li>Researcher writes mission, constraints, scope, and risks into tracked memory instead of leaving them inside a single reply.</li>
            <li>Planner reads the same state directly, so it does not have to reconstruct intent from a compressed transcript.</li>
            <li>Executor inherits current decisions and constraints instead of subtly reverting to older goals.</li>
            <li>The plain baseline can still sound reasonable, but its handoff loses the exact state that keeps the system aligned.</li>
          </div>
          <div className="overview-cta-row">
            <button type="button" onClick={onOpenChat}>
              Open Runtime
            </button>
            <button className="ghost" type="button" onClick={onOpenCompare}>
              Open Compare
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
