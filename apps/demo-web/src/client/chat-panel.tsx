import { DEMO_BRAND, DEMO_FLOW_STEPS, EMPTY_CHAT_HINTS, SUGGESTED_DEMO_TURNS } from "./content";
import { pretty, type DemoHistoryEntry, type DiffEntry, type ScopeSummary } from "./lib";
import { FactPills } from "./ui";

export function ChatPanel(props: {
  activeScope: ScopeSummary | null;
  activeScopeId: string | null;
  goal: string;
  answerMode: string;
  retrievalMode: string;
  workingVersion: string | number;
  stableVersion: string;
  workingCaughtUp: boolean;
  stableCaughtUp: boolean;
  goalAligned: boolean | undefined;
  diff: { working: DiffEntry[]; stable: DiffEntry[] };
  history: DemoHistoryEntry[];
  latestMeta: DemoHistoryEntry["meta"] | null;
  messageInput: string;
  onMessageInputChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const {
    activeScope,
    activeScopeId,
    goal,
    answerMode,
    retrievalMode,
    workingVersion,
    stableVersion,
    workingCaughtUp,
    stableCaughtUp,
    goalAligned,
    diff,
    history,
    latestMeta,
    messageInput,
    onMessageInputChange,
    onSubmit
  } = props;

  const turnStoryHeadline =
    answerMode === "direct_state_fast_path"
      ? "The Fast Layer answered directly from tracked state, then handed off background memory upkeep."
      : "The Fast Layer used the LLM path, then Working Memory and State Layer continued in the background.";

  return (
    <section className="panel chat-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Public Runtime Surface</div>
          <h2>Chat</h2>
        </div>
      </div>
      <div className="hero-card">
        <div className="hero-row">
          <div>
            <div className="eyebrow">Active Scope</div>
            <h3 className="hero-title">{activeScope?.name || "No scope selected."}</h3>
          </div>
          <span className="hero-stage">{activeScope?.stage ? `Stage: ${activeScope.stage}` : "Unknown stage"}</span>
        </div>
        <div className="hero-goal">{goal}</div>
        <div className="hero-facts">
          <span className="hero-pill">Answer: {answerMode}</span>
          <span className="hero-pill">Retrieval: {retrievalMode}</span>
          <span className="hero-pill">Working: {String(workingVersion)}</span>
          <span className="hero-pill">Stable: {stableVersion}</span>
        </div>
        <div className="hero-facts">
          <span className="hero-pill">Working {workingCaughtUp ? "caught up" : "pending"}</span>
          <span className="hero-pill">Stable {stableCaughtUp ? "caught up" : "pending"}</span>
          <span className="hero-pill">Alignment {goalAligned === true ? "aligned" : goalAligned === false ? "drift" : "unknown"}</span>
        </div>
      </div>
      <div className="story-grid">
        <article className="story-card">
          <span className="story-label">Turn Story</span>
          <strong className="story-headline">{turnStoryHeadline}</strong>
          <div className="story-detail">
            Retrieval ran in {retrievalMode} mode. Working Memory changed in {diff.working.length} field
            {diff.working.length === 1 ? "" : "s"} and State Layer changed in {diff.stable.length} field
            {diff.stable.length === 1 ? "" : "s"}. {workingCaughtUp ? "Working Memory is caught up." : "Working Memory is still catching up."}{" "}
            {stableCaughtUp ? "Stable State is caught up." : "Stable State is still waiting on the digest boundary."}
          </div>
          <div className="story-facts">
            <FactPills
              items={[
                `Answer: ${answerMode}`,
                `Retrieval: ${retrievalMode}`,
                `Working diff: ${diff.working.length}`,
                `Stable diff: ${diff.stable.length}`,
                `Working: ${workingCaughtUp ? "ready" : "pending"}`,
                `Stable: ${stableCaughtUp ? "ready" : "pending"}`
              ]}
            />
          </div>
        </article>
      </div>
      <div className="chat-status-row">
        <span className="chat-status-pill">{activeScope ? `${activeScope.name} (${activeScope.stage})` : "No active scope"}</span>
        <span className="chat-status-pill">
          {history.length} {history.length === 1 ? "message" : "messages"}
        </span>
        <span className="chat-status-pill">
          {latestMeta?.answerMode
            ? `Last answer: ${latestMeta.answerMode}`
            : activeScopeId
              ? "Ask about goals, constraints, decisions, or open work"
              : "Create a scope to begin the demo"}
        </span>
      </div>
      <div className="prompt-strip">
        <span className="prompt-strip-label">Suggested demo turns</span>
        <div className="prompt-buttons">
          {SUGGESTED_DEMO_TURNS.map(([prompt, label]) => (
            <button className="ghost prompt-button" key={prompt} type="button" onClick={() => onMessageInputChange(prompt)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="demo-flow">
        {DEMO_FLOW_STEPS.map(([step, title, detail]) => (
          <article className="demo-flow-card" key={step}>
            <span className="demo-flow-step">{step}</span>
            <div>
              <strong>{title}</strong>
              <div className="demo-flow-detail">{detail}</div>
            </div>
          </article>
        ))}
      </div>
      <div className="messages">
        {!history.length ? (
          <div className="empty-state">
            <strong>No turns yet for this scope.</strong>
            {EMPTY_CHAT_HINTS.map((hint) => (
              <div className="empty-state-detail" key={hint}>
                {hint}
              </div>
            ))}
          </div>
        ) : (
          [...history].reverse().map((entry, index) => (
            <article className={`message message-${entry.role}`} key={`${entry.role}-${index}`}>
              <div className="message-label">{entry.role === "user" ? "You" : DEMO_BRAND.eyebrow}</div>
              <div className="message-body">{entry.content}</div>
              {entry.meta ? <pre className="message-meta">{pretty(entry.meta)}</pre> : null}
            </article>
          ))
        )}
      </div>
      <form className="chat-form" onSubmit={onSubmit}>
        <textarea
          value={messageInput}
          onChange={(event) => onMessageInputChange(event.target.value)}
          rows={4}
          placeholder="Ask about the current goal, constraints, or open work."
          required
        />
        <div className="chat-actions">
          <button type="submit">Send Turn</button>
        </div>
      </form>
    </section>
  );
}
