import { useEffect, useRef, useState } from "react";
import { CATEGORIES, type CategoryId } from "./categories";
import { diagnoseCompany, type ConversationTurn, type DiagnosisResult, type ProductMatch } from "./diagnose";
import { DEMO_SCENARIOS, type DemoScenario } from "./demoScenarios";

// The very first message is static (no point calling the model before the
// user has said anything). Every turn after that is fully dynamic — the model
// reads the whole conversation, decides what's still missing among company/
// product/country/audience/creator-type, and drives the rest of the chat
// itself (see web/api/diagnose.ts's system prompt). There is no fixed
// question script here anymore.
const OPENING_QUESTION = "What does your company do? Tell us a bit about it.";
const OPENING_PLACEHOLDER = "e.g. We make action cameras for extreme sports";

// Safety net: never let the chat run forever waiting on the model to commit —
// after this many user turns, force a finalize (honest no-match) instead of
// continuing to ask questions.
const MAX_TURNS = 9;

// Pacing for the scripted demo-scenario playback — enough to read as a real
// back-and-forth, short enough not to drag during a live presentation.
const SCENARIO_BEAT_MS = 550;
const SCENARIO_THINK_MS = 900;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ChatMessage = { role: "assistant" | "user"; text: string };
type Diagnosis = Extract<DiagnosisResult, { done: true; ok: true }>;

export default function Onboarding({
  onDiagnosed,
  dimensions,
}: {
  onDiagnosed: (categoryId: CategoryId | null, match?: ProductMatch) => void;
  /** The active category's axes, forwarded to /api/diagnose so the model can
   *  place the visitor's product on them. */
  dimensions?: { key: string; name: string; description: string }[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: OPENING_QUESTION },
  ]);
  const [conversation, setConversation] = useState<ConversationTurn[]>([
    { role: "assistant", text: OPENING_QUESTION },
  ]);
  const [turnCount, setTurnCount] = useState(0);
  const [input, setInput] = useState("");
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  // True while a scripted demo scenario is playing itself out — no network
  // calls happen during this, see playScenario().
  const [playingScenario, setPlayingScenario] = useState(false);
  // Set when diagnoseCompany() couldn't complete (network error, timeout,
  // missing API key, etc). Never show a blank/stuck chat — let the presenter
  // pick a category by hand and keep the demo moving.
  const [manualFallback, setManualFallback] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Held in a ref, not state: it is read once when handing off to the parent
  // and never rendered, so it should not schedule a re-render.
  const matchRef = useRef<ProductMatch | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, diagnosing]);

  // `disabled` drops focus while waiting on the model; restore it the moment
  // the input's usable again so the next answer can be typed immediately,
  // no click required.
  useEffect(() => {
    if (!diagnosing && !diagnosis && !manualFallback && !playingScenario) inputRef.current?.focus();
  }, [diagnosing, diagnosis, manualFallback, playingScenario]);

  async function runDiagnosis(conv: ConversationTurn[], turnsSoFar: number) {
    setDiagnosing(true);
    const result = await diagnoseCompany(conv, dimensions);
    setDiagnosing(false);

    if (!result.done) {
      if (turnsSoFar < MAX_TURNS) {
        setMessages((m) => [...m, { role: "assistant", text: result.question }]);
        setConversation([...conv, { role: "assistant", text: result.question }]);
        return;
      }
      // Never stall the chat past the turn budget — commit to an honest
      // no-match rather than asking forever.
      const summary = "Thanks — that's enough to go on.";
      setDiagnosis({ done: true, ok: true, categoryId: null, confidence: 0, summary, productVector: null, product: "" });
      setMessages((m) => [...m, { role: "assistant", text: summary }]);
      return;
    }

    if (!result.ok) {
      setManualFallback(true);
      return;
    }

    matchRef.current =
      result.productVector && result.productVector.length > 0
        ? { product: result.product, vector: result.productVector }
        : null;
    setDiagnosis(result);
    setMessages((m) => [...m, { role: "assistant", text: result.summary }]);
  }

  async function submitAnswer(text: string) {
    const trimmed = text.trim();
    if (!trimmed || diagnosing || diagnosis || manualFallback || playingScenario) return;

    const userMsg: ChatMessage = { role: "user", text: trimmed };
    const convWithAnswer = [...conversation, userMsg];
    const nextTurnCount = turnCount + 1;

    setMessages((m) => [...m, userMsg]);
    setConversation(convWithAnswer);
    setTurnCount(nextTurnCount);
    setInput("");

    await runDiagnosis(convWithAnswer, nextTurnCount);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitAnswer(input);
  }

  // Plays out a fully pre-written conversation (both sides) and lands on a
  // hardcoded result — deliberately bypasses /api/diagnose entirely so a
  // live demo never depends on the LLM being reachable. See demoScenarios.ts.
  async function playScenario(scenario: DemoScenario) {
    if (diagnosing || diagnosis || manualFallback || playingScenario) return;
    setPlayingScenario(true);
    setManualFallback(false);
    matchRef.current = null;
    setMessages([{ role: "assistant", text: scenario.questions[0] }]);
    setConversation([{ role: "assistant", text: scenario.questions[0] }]);
    setTurnCount(0);
    setInput("");

    for (let i = 0; i < scenario.answers.length; i++) {
      await sleep(SCENARIO_BEAT_MS);
      setMessages((m) => [...m, { role: "user", text: scenario.answers[i] }]);
      const nextQuestion = scenario.questions[i + 1];
      if (nextQuestion) {
        await sleep(SCENARIO_BEAT_MS);
        setMessages((m) => [...m, { role: "assistant", text: nextQuestion }]);
      }
    }

    setDiagnosing(true);
    await sleep(SCENARIO_THINK_MS);
    setDiagnosing(false);

    setDiagnosis({
      done: true,
      ok: true,
      categoryId: scenario.categoryId,
      confidence: scenario.confidence,
      summary: scenario.summary,
      productVector: null,
      product: "",
    });
    setMessages((m) => [...m, { role: "assistant", text: scenario.summary }]);
    setPlayingScenario(false);
  }

  function handleManualPick(id: CategoryId) {
    const label = CATEGORIES.find((c) => c.id === id)?.label ?? id;
    const summary = `You picked ${label} manually — no live diagnosis was available.`;
    setManualFallback(false);
    setDiagnosis({ done: true, ok: true, categoryId: id, confidence: 0, summary, productVector: null, product: "" });
    setMessages((m) => [...m, { role: "assistant", text: summary }]);
    onDiagnosed(id, matchRef.current ?? undefined);
  }

  const done = diagnosis !== null;
  const placeholder = turnCount === 0 ? OPENING_PLACEHOLDER : "Type your answer…";
  const categoryLabel = diagnosis?.categoryId
    ? CATEGORIES.find((c) => c.id === diagnosis.categoryId)?.label ?? null
    : null;

  return (
    <section className="border-y border-line bg-gradient-to-b from-paper via-accent/[0.03] to-surface">
      <div className="max-w-3xl mx-auto px-6 pt-2 pb-20">
        {!done && !manualFallback && (
          <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
            <span className="text-[11px] text-muted">Start with example:</span>
            {DEMO_SCENARIOS.map((s) => (
              <button
                key={s.categoryId}
                onClick={() => void playScenario(s)}
                disabled={diagnosing || playingScenario}
                className="text-[11px] font-semibold text-accent border border-accent/30 rounded-full px-2.5 py-0.5
                  hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
              >
                ⚡ {s.buttonLabel}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-line bg-surface shadow-lg shadow-accent/[0.06] p-6">
          {messages.length > 1 && (
            <div ref={scrollRef} className="space-y-2 max-h-72 overflow-y-auto pr-1 mb-4 scroll-smooth">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-xl px-3.5 py-2 text-sm leading-relaxed ${
                      m.role === "user" ? "bg-accent text-white" : "bg-paper border border-line text-ink"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {diagnosing && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-xl px-4 py-3 bg-paper border border-line">
                    <TypingDots />
                  </div>
                </div>
              )}
            </div>
          )}

          {manualFallback ? (
            <ManualCategoryPicker
              onPick={handleManualPick}
              onRetry={() => {
                setManualFallback(false);
                void runDiagnosis(conversation, turnCount);
              }}
            />
          ) : !done ? (
            <>
              {messages.length === 1 && (
                <p className="text-ink font-display font-bold text-xl mb-4 text-center">{messages[0].text}</p>
              )}
              <form onSubmit={handleSubmit} className="flex gap-3">
                <div
                  className="flex-1 rounded-2xl p-[2px] bg-gradient-to-r from-accent via-[#5b6bf0] to-accent/40
                    focus-within:shadow-[0_0_0_5px_rgba(31,53,224,0.15)] transition-shadow"
                >
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={placeholder}
                    aria-label="Your answer"
                    autoFocus
                    disabled={diagnosing || playingScenario}
                    className="w-full bg-surface rounded-2xl px-6 py-5 text-lg text-ink
                      placeholder:text-muted focus:outline-none disabled:opacity-60"
                  />
                </div>
                <button
                  type="submit"
                  disabled={diagnosing || playingScenario}
                  className="px-8 py-5 rounded-2xl bg-gradient-to-r from-accent to-[#5b6bf0] text-white
                    text-base font-semibold hover:opacity-90 transition-opacity shrink-0 disabled:opacity-60"
                >
                  Send
                </button>
              </form>
            </>
          ) : (
            <div className="rounded-lg border border-accent/25 bg-accent/[0.04] px-4 py-3.5">
              <div className="text-[10px] uppercase tracking-wider text-accent font-semibold mb-3">
                Diagnosis
              </div>
              <button
                onClick={() => onDiagnosed(diagnosis.categoryId, matchRef.current ?? undefined)}
                className="text-sm font-medium text-accent border border-accent/30 rounded-lg px-4 py-2
                  hover:bg-accent hover:text-white transition-colors"
              >
                {categoryLabel ? `See ${categoryLabel} results →` : "Continue →"}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 h-4" aria-label="Thinking" role="status">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function ManualCategoryPicker({
  onPick,
  onRetry,
}: {
  onPick: (id: CategoryId) => void;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3.5">
      <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-1.5">
        Diagnosis unavailable
      </div>
      <p className="text-sm text-ink/80 leading-relaxed mb-3">
        Couldn't reach the diagnosis service just now. Pick a category yourself to keep going:
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            className="text-sm font-medium text-ink border border-line rounded-lg px-3 py-1.5
              hover:border-accent hover:text-accent transition-colors"
          >
            {c.label}
          </button>
        ))}
      </div>
      <button onClick={onRetry} className="text-xs font-medium text-muted hover:text-accent transition-colors">
        ↻ Try the diagnosis again
      </button>
    </div>
  );
}
