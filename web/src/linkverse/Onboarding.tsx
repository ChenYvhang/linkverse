import { useEffect, useRef, useState } from "react";
import { CATEGORIES, type CategoryId } from "./categories";
import {
  diagnoseCompany,
  FALLBACK_CATEGORY_ID,
  type ConversationTurn,
  type DiagnosisResult,
} from "./diagnose";

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

const MAX_FOLLOW_UPS = 2;
const NUDGE = "Could you tell me a bit more? Even a short phrase helps.";
const MIN_ANSWER_LENGTH = 3;

type ChatMessage = { role: "assistant" | "user"; text: string };
type Diagnosis = Extract<DiagnosisResult, { done: true }>;

export default function Onboarding({ onDiagnosed }: { onDiagnosed: (categoryId: CategoryId) => void }) {
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, diagnosing]);

  async function runDiagnosis(conv: ConversationTurn[]) {
    setDiagnosing(true);
    const result = await diagnoseCompany(conv);

    if (!result.done && followUpCount < MAX_FOLLOW_UPS) {
      const displayQuestion = result.question.replace(/^\[followup\]\s*/, "");
      setMessages((m) => [...m, { role: "assistant", text: displayQuestion }]);
      setConversation([...conv, { role: "assistant", text: result.question }]);
      setFollowUpQuestion(displayQuestion);
      setFollowUpCount((n) => n + 1);
      setDiagnosing(false);
      return;
    }

    // Safety net: never stall the chat waiting on more clarification than we
    // budgeted for — commit to the best guess (or the fallback category).
    const finalResult: Diagnosis = result.done
      ? result
      : {
          done: true,
          categoryId: FALLBACK_CATEGORY_ID,
          confidence: 0.4,
          summary: "Thanks — that's enough to point you in the right direction.",
        };

    setDiagnosis(finalResult);
    setMessages((m) => [...m, { role: "assistant", text: finalResult.summary }]);
    setDiagnosing(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || diagnosing || diagnosis) return;

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

  const done = diagnosis !== null;
  const placeholder = step < FIXED_QUESTIONS.length ? FIXED_QUESTIONS[step].placeholder : "Type your answer…";
  const categoryLabel = diagnosis ? CATEGORIES.find((c) => c.id === diagnosis.categoryId)?.label ?? "" : "";

  return (
    <section className="border-y border-line bg-gradient-to-b from-paper to-surface">
      <div className="max-w-3xl mx-auto px-6 py-14">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold mb-2 text-center">
          Tell us about your product
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
                  <div className="max-w-[80%] rounded-xl px-3.5 py-2 text-sm leading-relaxed bg-paper border border-line text-muted italic">
                    Thinking…
                  </div>
                </div>
              )}
            </div>
          )}

          {!done ? (
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
              <p className="text-sm text-ink/80 leading-relaxed">{diagnosis.summary}</p>
              <p className="text-xs text-muted mt-1 mb-4">
                This match is a placeholder while the real diagnosis backend is wired up.
              </p>
              <button
                onClick={() => onDiagnosed(diagnosis.categoryId)}
                className="text-sm font-medium text-accent border border-accent/30 rounded-lg px-4 py-2
                  hover:bg-accent hover:text-white transition-colors"
              >
                See {categoryLabel} results →
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
