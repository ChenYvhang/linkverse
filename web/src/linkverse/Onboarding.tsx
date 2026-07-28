import { useState } from "react";

type Question = { id: string; prompt: string; placeholder: string };

// Scripted question flow — see the TODO in handleSubmit for where a real
// LLM-driven matcher would eventually replace this.
const QUESTIONS: Question[] = [
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
    prompt: "Which market or region are you launching in?",
    placeholder: "e.g. North America and Western Europe",
  },
  {
    id: "audience",
    prompt: "Who's your target audience?",
    placeholder: "e.g. Skiers and snowboarders, 18–35",
  },
  {
    id: "tone",
    prompt: "What tone or style do you want from creators?",
    placeholder: "e.g. Authentic, high-energy, not overly polished",
  },
];

const NUDGE = "Could you tell me a bit more? Even a short phrase helps.";
const MIN_ANSWER_LENGTH = 3;

type ChatMessage = { role: "assistant" | "user"; text: string };

export default function Onboarding() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: QUESTIONS[0].prompt },
  ]);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [nudgedStep, setNudgedStep] = useState<number | null>(null);

  const done = step >= QUESTIONS.length;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || done) return;

    const userMsg: ChatMessage = { role: "user", text: trimmed };

    // Scripted stand-in for "the model didn't understand" — nudge once per
    // question, then accept whatever comes next so the flow can't stall.
    if (trimmed.length < MIN_ANSWER_LENGTH && nudgedStep !== step) {
      setMessages((m) => [...m, userMsg, { role: "assistant", text: NUDGE }]);
      setNudgedStep(step);
      setInput("");
      return;
    }

    const q = QUESTIONS[step];
    setAnswers((a) => ({ ...a, [q.id]: trimmed }));
    const nextStep = step + 1;

    if (nextStep >= QUESTIONS.length) {
      // TODO: replace scripted flow with real LLM product→vector matching.
      // `answers` (company/product/market/audience/tone) is everything a real
      // matcher would need — nothing here re-ranks Scope/Kit yet, the
      // completion card below just points at the fixed Insta360 demo data.
    }

    setMessages((m) => {
      const next = [...m, userMsg];
      if (nextStep < QUESTIONS.length) next.push({ role: "assistant", text: QUESTIONS[nextStep].prompt });
      return next;
    });
    setStep(nextStep);
    setInput("");
  }

  function scrollToHero() {
    document.getElementById("hero")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <section className="border-b border-line bg-paper/60">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold mb-2">
          Tell us about your product
        </div>
        <h2 className="font-display font-bold text-ink text-xl mb-4">
          Describe your company and product — LinkVerse will ask a few quick questions.
        </h2>

        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1 mb-4">
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
          </div>

          {!done ? (
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={QUESTIONS[step].placeholder}
                aria-label="Your answer"
                autoFocus
                className="flex-1 bg-surface border border-line rounded-lg px-3.5 py-2.5 text-sm text-ink
                  placeholder:text-muted focus:outline-none focus:border-accent/60"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium
                  hover:bg-accent/90 transition-colors shrink-0"
              >
                Send
              </button>
            </form>
          ) : (
            <div className="rounded-lg border border-accent/25 bg-accent/[0.04] px-4 py-3.5">
              <div className="text-[10px] uppercase tracking-wider text-accent font-semibold mb-2">
                What you told us
              </div>
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
                {QUESTIONS.map((q) => (
                  <div key={q.id}>
                    <dt className="text-[11px] text-muted">{q.prompt}</dt>
                    <dd className="text-ink">{answers[q.id]}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-ink/80 leading-relaxed mb-4">
                Custom matching from your product description is coming soon. This demo is currently
                tuned for Insta360 — explore the Insta360 results below.
              </p>
              <button
                onClick={scrollToHero}
                className="text-sm font-medium text-accent border border-accent/30 rounded-lg px-4 py-2
                  hover:bg-accent hover:text-white transition-colors"
              >
                See the Insta360 results below ↓
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
