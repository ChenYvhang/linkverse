import { useEffect, useRef, useState } from "react";
import { CATEGORIES, type CategoryId } from "./categories";
import { diagnoseCompany, type ConversationTurn, type DiagnosisResult } from "./diagnose";

// The very first message is static (no point calling Gemini before the user
// has said anything). Every turn after that is fully dynamic — Gemini reads
// the whole conversation, decides what's still missing among company/
// product/country/audience/creator-type, and drives the rest of the chat
// itself (see web/api/diagnose.ts's system prompt). There is no fixed
// question script here anymore.
const OPENING_QUESTION = "What does your company do? Tell us a bit about it.";
const OPENING_PLACEHOLDER = "e.g. We make action cameras for extreme sports";

// Canned Insta360 answers for the "Fill example" demo button — avoids live
// typing mistakes on stage. Submitted one at a time (each click sends the
// next one for real), since the exact question order/count is no longer
// fixed — this just feeds Gemini the same information a live presenter
// would type, topic by topic.
const EXAMPLE_ANSWERS = [
  "We make Insta360 action cameras for extreme sports.",
  "The Insta360 X5, our new 360° waterproof action camera.",
  "North America and Western Europe.",
  "Skiers, surfers, and mountain bikers, 18–35.",
  "High-energy, authentic outdoor athletes who film their own stunts — not overly polished.",
];

// Safety net: never let the chat run forever waiting on Gemini to commit —
// after this many user turns, force a finalize (honest no-match) instead of
// continuing to ask questions.
const MAX_TURNS = 9;

type ChatMessage = { role: "assistant" | "user"; text: string };
type Diagnosis = Extract<DiagnosisResult, { done: true; ok: true }>;

export default function Onboarding({
  onDiagnosed,
}: {
  onDiagnosed: (categoryId: CategoryId | null) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: OPENING_QUESTION },
  ]);
  const [conversation, setConversation] = useState<ConversationTurn[]>([
    { role: "assistant", text: OPENING_QUESTION },
  ]);
  const [turnCount, setTurnCount] = useState(0);
  const [input, setInput] = useState("");
  const [exampleIndex, setExampleIndex] = useState(0);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  // Set when diagnoseCompany() couldn't complete (network error, timeout,
  // missing API key, etc). Never show a blank/stuck chat — let the presenter
  // pick a category by hand and keep the demo moving.
  const [manualFallback, setManualFallback] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, diagnosing]);

  // `disabled` drops focus while waiting on Gemini; restore it the moment
  // the input's usable again so the next answer can be typed immediately,
  // no click required.
  useEffect(() => {
    if (!diagnosing && !diagnosis && !manualFallback) inputRef.current?.focus();
  }, [diagnosing, diagnosis, manualFallback]);

  async function runDiagnosis(conv: ConversationTurn[], turnsSoFar: number) {
    setDiagnosing(true);
    const result = await diagnoseCompany(conv);
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
      setDiagnosis({ done: true, ok: true, categoryId: null, confidence: 0, summary });
      setMessages((m) => [...m, { role: "assistant", text: summary }]);
      return;
    }

    if (!result.ok) {
      setManualFallback(true);
      return;
    }

    setDiagnosis(result);
    setMessages((m) => [...m, { role: "assistant", text: result.summary }]);
  }

  async function submitAnswer(text: string) {
    const trimmed = text.trim();
    if (!trimmed || diagnosing || diagnosis || manualFallback) return;

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

  function fillExample() {
    if (diagnosing || diagnosis || manualFallback || exampleIndex >= EXAMPLE_ANSWERS.length) return;
    const next = EXAMPLE_ANSWERS[exampleIndex];
    setExampleIndex((i) => i + 1);
    void submitAnswer(next);
  }

  function handleManualPick(id: CategoryId) {
    const label = CATEGORIES.find((c) => c.id === id)?.label ?? id;
    const summary = `You picked ${label} manually — no live diagnosis was available.`;
    setManualFallback(false);
    setDiagnosis({ done: true, ok: true, categoryId: id, confidence: 0, summary });
    setMessages((m) => [...m, { role: "assistant", text: summary }]);
    onDiagnosed(id);
  }

  const done = diagnosis !== null;
  const placeholder = turnCount === 0 ? OPENING_PLACEHOLDER : "Type your answer…";
  const categoryLabel = diagnosis?.categoryId
    ? CATEGORIES.find((c) => c.id === diagnosis.categoryId)?.label ?? null
    : null;

  return (
    <section className="border-y border-line bg-gradient-to-b from-paper via-accent/[0.03] to-surface">
      <div className="max-w-3xl mx-auto px-6 py-14">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold text-center">
            Tell us about your product
          </div>
          {!done && !manualFallback && exampleIndex < EXAMPLE_ANSWERS.length && (
            <button
              onClick={fillExample}
              disabled={diagnosing}
              className="text-[11px] font-semibold text-accent border border-accent/30 rounded-full px-2.5 py-0.5
                hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
            >
              ⚡ Fill example (Insta360)
            </button>
          )}
        </div>
        <h2 className="font-display font-bold text-ink text-2xl mb-6 text-center">
          Describe your company and product — LinkVerse will chat it through with you.
        </h2>

        <div className="rounded-2xl border border-line bg-surface shadow-sm p-5">
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
                <p className="text-ink font-medium mb-3">{messages[0].text}</p>
              )}
              <form onSubmit={handleSubmit} className="flex gap-3">
                <div
                  className="flex-1 rounded-2xl p-[1.5px] bg-gradient-to-r from-accent via-[#5b6bf0] to-accent/40
                    focus-within:shadow-[0_0_0_4px_rgba(31,53,224,0.15)] transition-shadow"
                >
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={placeholder}
                    aria-label="Your answer"
                    autoFocus
                    disabled={diagnosing}
                    className="w-full bg-surface rounded-2xl px-5 py-4 text-base text-ink
                      placeholder:text-muted focus:outline-none disabled:opacity-60"
                  />
                </div>
                <button
                  type="submit"
                  disabled={diagnosing}
                  className="px-6 py-4 rounded-2xl bg-gradient-to-r from-accent to-[#5b6bf0] text-white
                    text-sm font-semibold hover:opacity-90 transition-opacity shrink-0 disabled:opacity-60"
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
                onClick={() => onDiagnosed(diagnosis.categoryId)}
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
