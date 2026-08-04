import { useEffect, useRef, useState } from "react";
import { CATEGORIES, type CategoryId } from "./categories";
import { diagnoseCompany, type ConversationTurn, type DiagnosisResult } from "./diagnose";

type Question = { id: string; prompt: string; placeholder: string };

// Fixed opening script — collects the minimum LinkVerse needs (company/
// product, target market, target audience). Once these are answered,
// diagnoseCompany() takes over and may ask up to MAX_FOLLOW_UPS more
// questions before committing to a category.
const FIXED_QUESTIONS: Question[] = [
  {
    id: "company",
    prompt: "What does your company do?",
    placeholder: "e.g. We make action cameras for extreme sports",
  },
  {
    id: "product",
    prompt: "Which product are you promoting?",
    placeholder: "e.g. Our new 360° waterproof camera",
  },
  {
    id: "market",
    prompt: "Which country or region are you marketing to?",
    placeholder: "e.g. North America and Western Europe",
  },
  {
    id: "audience",
    prompt: "Who's your target audience?",
    placeholder: "e.g. Skiers and snowboarders, 18–35",
  },
];

// Canned Insta360 answers for the "Fill example" demo button — avoids live
// typing mistakes on stage. Keyed by FIXED_QUESTIONS id.
const EXAMPLE_ANSWERS: Record<string, string> = {
  company: "We make Insta360 action cameras for extreme sports.",
  product: "The Insta360 X5, our new 360° waterproof action camera.",
  market: "North America and Western Europe",
  audience: "Skiers, surfers, and mountain bikers, 18–35",
};

const MAX_FOLLOW_UPS = 2;
const NUDGE = "Could you tell me a bit more? Even a short phrase helps.";
const MIN_ANSWER_LENGTH = 3;

type ChatMessage = { role: "assistant" | "user"; text: string };
type Diagnosis = Extract<DiagnosisResult, { done: true; ok: true }>;

export default function Onboarding({
  onDiagnosed,
}: {
  onDiagnosed: (categoryId: CategoryId | null) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: FIXED_QUESTIONS[0].prompt },
  ]);
  const [conversation, setConversation] = useState<ConversationTurn[]>([
    { role: "assistant", text: FIXED_QUESTIONS[0].prompt },
  ]);
  const [step, setStep] = useState(0);
  const [followUpQuestion, setFollowUpQuestion] = useState<string | null>(null);
  const [followUpCount, setFollowUpCount] = useState(0);
  const [input, setInput] = useState("");
  const [nudgedFor, setNudgedFor] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  // Set when diagnoseCompany() couldn't complete (network error, timeout,
  // missing API key, etc). Never show a blank/stuck chat — let the presenter
  // pick a category by hand and keep the demo moving.
  const [manualFallback, setManualFallback] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, diagnosing]);

  async function runDiagnosis(conv: ConversationTurn[]) {
    setDiagnosing(true);
    const result = await diagnoseCompany(conv);

    if (!result.done) {
      if (followUpCount < MAX_FOLLOW_UPS) {
        setMessages((m) => [...m, { role: "assistant", text: result.question }]);
        setConversation([...conv, { role: "assistant", text: result.question }]);
        setFollowUpQuestion(result.question);
        setFollowUpCount((n) => n + 1);
        setDiagnosing(false);
        return;
      }
      // Safety net: never stall the chat waiting on more clarification than
      // we budgeted for — commit to an honest no-match rather than asking
      // forever.
      setDiagnosis({ done: true, ok: true, categoryId: null, confidence: 0, summary: "Thanks — that's enough to go on." });
      setDiagnosing(false);
      return;
    }

    setDiagnosing(false);

    if (!result.ok) {
      setManualFallback(true);
      return;
    }

    setDiagnosis(result);
    setMessages((m) => [...m, { role: "assistant", text: result.summary }]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || diagnosing || diagnosis || manualFallback) return;

    const nudgeKey = followUpQuestion ?? `fixed:${step}`;
    if (trimmed.length < MIN_ANSWER_LENGTH && nudgedFor !== nudgeKey) {
      setMessages((m) => [...m, { role: "user", text: trimmed }, { role: "assistant", text: NUDGE }]);
      setNudgedFor(nudgeKey);
      setInput("");
      return;
    }

    const userMsg: ChatMessage = { role: "user", text: trimmed };
    setInput("");

    if (step < FIXED_QUESTIONS.length) {
      const nextStep = step + 1;
      const convWithAnswer = [...conversation, userMsg];

      if (nextStep < FIXED_QUESTIONS.length) {
        const nextQ = FIXED_QUESTIONS[nextStep];
        setMessages((m) => [...m, userMsg, { role: "assistant", text: nextQ.prompt }]);
        setConversation([...convWithAnswer, { role: "assistant", text: nextQ.prompt }]);
        setStep(nextStep);
      } else {
        setMessages((m) => [...m, userMsg]);
        setConversation(convWithAnswer);
        setStep(nextStep);
        await runDiagnosis(convWithAnswer);
      }
    } else {
      setMessages((m) => [...m, userMsg]);
      const convWithAnswer = [...conversation, userMsg];
      setConversation(convWithAnswer);
      setFollowUpQuestion(null);
      await runDiagnosis(convWithAnswer);
    }
  }

  // Demo aid: instantly plays out the whole fixed script with canned
  // Insta360 answers, then runs the same real diagnosis call a typed-out
  // answer would — no live typing required on stage.
  async function fillExample() {
    if (diagnosing) return;

    const newMessages: ChatMessage[] = [];
    const newConversation: ConversationTurn[] = [];
    for (const q of FIXED_QUESTIONS) {
      newMessages.push({ role: "assistant", text: q.prompt });
      newConversation.push({ role: "assistant", text: q.prompt });
      const answer = EXAMPLE_ANSWERS[q.id];
      newMessages.push({ role: "user", text: answer });
      newConversation.push({ role: "user", text: answer });
    }

    setDiagnosis(null);
    setManualFallback(false);
    setFollowUpQuestion(null);
    setFollowUpCount(0);
    setNudgedFor(null);
    setStep(FIXED_QUESTIONS.length);
    setMessages(newMessages);
    setConversation(newConversation);
    setInput("");

    await runDiagnosis(newConversation);
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
  const placeholder = step < FIXED_QUESTIONS.length ? FIXED_QUESTIONS[step].placeholder : "Type your answer…";
  const categoryLabel = diagnosis?.categoryId
    ? CATEGORIES.find((c) => c.id === diagnosis.categoryId)?.label ?? null
    : null;

  return (
    <section className="border-y border-line bg-gradient-to-b from-paper to-surface">
      <div className="max-w-3xl mx-auto px-6 py-14">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold text-center">
            Tell us about your product
          </div>
          {!done && !manualFallback && (
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
          Describe your company and product — LinkVerse will ask a few quick questions.
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
                void runDiagnosis(conversation);
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
              <div className="text-[10px] uppercase tracking-wider text-accent font-semibold mb-2">
                Diagnosis
              </div>
              <p className="text-sm text-ink/80 leading-relaxed mb-4">{diagnosis.summary}</p>
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
