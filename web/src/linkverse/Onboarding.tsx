import { useEffect, useMemo, useRef, useState } from "react";
import type { CategoryId } from "./categories";
import { diagnoseCompany, type ConversationTurn, type DiagnosisResult, type ProductMatch } from "./diagnose";
import { useCatalog, type CatalogProduct } from "./catalog";

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
const DEMO_USER_PAUSE_MS = 450;
const DEMO_ASSISTANT_PAUSE_MS = 850;
const DEMO_FINISH_PAUSE_MS = 650;

type DemoPreset = {
  categoryId: CategoryId;
  productId: string;
  label: string;
  turns: ChatMessage[];
};

const DEMO_PRESETS: DemoPreset[] = [
  {
    categoryId: "action_camera",
    productId: "x5",
    label: "Action camera",
    turns: [
      { role: "user", text: "We build action cameras for people who film outdoor sports." },
      { role: "assistant", text: "That sounds made for active, immersive content. Which product are you promoting?" },
      { role: "user", text: "The Insta360 X5. Its immersive 360° POV, invisible selfie-stick shots, and stabilization are made for demanding outdoor scenes." },
      { role: "assistant", text: "That gives the product a clear visual identity. What kind of creator should represent it?" },
      { role: "user", text: "Authentic skiing, surfing, and mountain-biking creators who already use first-person footage." },
      { role: "assistant", text: "Perfect — I’ll rank creators whose filming style naturally fits the Insta360 X5." },
    ],
  },
  {
    categoryId: "sunscreen",
    productId: "outdoor_spf50",
    label: "Sunscreen",
    turns: [
      { role: "user", text: "We make skincare for athletes and people who spend all day outdoors." },
      { role: "assistant", text: "Outdoor use gives us a clear direction. Which product should this campaign feature?" },
      { role: "user", text: "Our water- and sweat-resistant Outdoor Sport SPF50+ for high-intensity activity." },
      { role: "assistant", text: "That product belongs in real sun, sweat, and water situations. Who should tell that story?" },
      { role: "user", text: "Credible hiking, trail-running, and cycling creators with a natural, practical style." },
      { role: "assistant", text: "Great — I’ll look for creators whose outdoor routines make that protection relevant." },
    ],
  },
  {
    categoryId: "supplement",
    productId: "whey_isolate",
    label: "Protein powder",
    turns: [
      { role: "user", text: "We make practical sports nutrition for people who train consistently." },
      { role: "assistant", text: "That gives me the audience. Which product are you launching?" },
      { role: "user", text: "A high-protein, low-lactose whey isolate for strength and muscle-building routines." },
      { role: "assistant", text: "Clear and useful. What kind of creator would make the collaboration feel credible?" },
      { role: "user", text: "Trustworthy fitness creators who share real training and explain products without overclaiming." },
      { role: "assistant", text: "Understood — I’ll prioritize credible fitness voices with a natural fit for protein content." },
    ],
  },
];

type ChatMessage = { role: "assistant" | "user"; text: string };
type Diagnosis = Extract<DiagnosisResult, { done: true; ok: true }>;
type CompletionKind = "demo" | "custom";

export default function Onboarding({
  onDiagnosed,
}: {
  onDiagnosed: (categoryId: CategoryId | null, match?: ProductMatch) => void;
}) {
  // Every category's product catalog (real, pre-vectorized products from
  // pipeline/config/categories/<id>/products.yaml) and axis definitions —
  // powers both the quick-pick tags below and the free-text chat's
  // productVector instruction (see pickProduct/runDiagnosis). Independent of
  // whichever category's (heavy) creator dataset LinkVerse has loaded.
  const catalog = useCatalog();
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
  const [completionKind, setCompletionKind] = useState<CompletionKind | null>(null);
  const [demoPlaying, setDemoPlaying] = useState(false);
  // Set when diagnoseCompany() couldn't complete (network error, timeout,
  // missing API key, etc). Never show a blank/stuck chat — let the presenter
  // pick a category by hand and keep the demo moving.
  const [manualFallback, setManualFallback] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const demoTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (demoTimerRef.current !== null) window.clearTimeout(demoTimerRef.current);
  }, []);

  useEffect(() => {
    if (demoPlaying) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    else scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, diagnosing, demoPlaying]);

  // `disabled` drops focus while waiting on the model; restore it the moment
  // the input's usable again so the next answer can be typed immediately,
  // no click required.
  useEffect(() => {
    if (!diagnosing && !demoPlaying && !diagnosis && !manualFallback) inputRef.current?.focus();
  }, [diagnosing, demoPlaying, diagnosis, manualFallback]);

  async function runDiagnosis(conv: ConversationTurn[], turnsSoFar: number) {
    setDiagnosing(true);
    const result = await diagnoseCompany(conv, catalog ?? undefined);
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
      setCompletionKind("custom");
      setMessages((m) => [...m, { role: "assistant", text: summary }]);
      onDiagnosed(null);
      return;
    }

    if (!result.ok) {
      setManualFallback(true);
      return;
    }

    setDiagnosis(result);
    setCompletionKind("custom");
    setMessages((m) => [...m, { role: "assistant", text: result.summary }]);
    // A free-text company always ends at the Premium preview, even when the
    // LLM classifies it into one of the three demo categories. Only clicking
    // an explicit demo preset is allowed to reveal the checked-in rankings.
    onDiagnosed(null);
  }

  async function submitAnswer(text: string) {
    const trimmed = text.trim();
    if (!trimmed || diagnosing || demoPlaying || diagnosis || manualFallback) return;

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

  // The three stage-safe demos never call the LLM. They play a short scripted
  // exchange, then use the catalog's real product vector to enter a genuinely
  // re-scored result page.
  function playDemo(preset: DemoPreset, product: CatalogProduct) {
    if (diagnosing || demoPlaying || diagnosis) return;
    const match: ProductMatch = { product: product.name, vector: product.vector };
    setManualFallback(false);
    setDemoPlaying(true);
    setMessages([]);
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

    const advance = (index: number) => {
      if (index >= preset.turns.length) {
        setDiagnosing(false);
        demoTimerRef.current = window.setTimeout(() => {
          const summary = `Your ${product.name} creator ranking is ready.`;
          setDiagnosis({
            done: true,
            ok: true,
            categoryId: preset.categoryId,
            confidence: 1,
            summary,
            productVector: product.vector,
            product: product.name,
          });
          setCompletionKind("demo");
          setDemoPlaying(false);
          onDiagnosed(preset.categoryId, match);
        }, DEMO_FINISH_PAUSE_MS);
        return;
      }

      const turn = preset.turns[index];
      setDiagnosing(turn.role === "assistant");
      demoTimerRef.current = window.setTimeout(() => {
        setMessages((current) => [...current, turn]);
        setDiagnosing(false);
        advance(index + 1);
      }, turn.role === "assistant" ? DEMO_ASSISTANT_PAUSE_MS : DEMO_USER_PAUSE_MS);
    };

    advance(0);
  }

  const done = diagnosis !== null;
  const placeholder = turnCount === 0 ? OPENING_PLACEHOLDER : "Type your answer…";

  // Exactly one stable preset per demo category. The rest of the product
  // catalog remains available to the ranking pipeline but is not presented
  // as a no-LLM shortcut.
  const productTags = useMemo(() => {
    if (!catalog) return [];
    return DEMO_PRESETS.flatMap((preset) => {
      const product = catalog[preset.categoryId]?.products.find((item) => item.id === preset.productId);
      return product ? [{ preset, product }] : [];
    });
  }, [catalog]);

  return (
    <section className="border-y border-line bg-gradient-to-b from-paper via-accent/[0.03] to-surface">
      <div className="max-w-3xl mx-auto px-6 pt-2 pb-20">
        {!done && productTags.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
            <span className="text-[11px] text-muted">Try a stable demo:</span>
            {productTags.map(({ preset, product }) => (
              <button
                key={`${preset.categoryId}:${product.id}`}
                onClick={() => playDemo(preset, product)}
                disabled={diagnosing || demoPlaying}
                title={`Play the ${preset.label} demo`}
                className="opal-btn text-xs font-semibold text-[#232734] rounded-full px-3 py-1.5
                  border border-white/50 shadow-sm hover:shadow-md hover:-translate-y-0.5
                  transition-[box-shadow,transform] disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}

        <div ref={boxRef} className="rounded-2xl border border-line bg-surface shadow-lg shadow-accent/[0.06] p-6">
          {(demoPlaying || messages.length > 1) && messages.length > 0 && (
            <div ref={scrollRef} className="space-y-2 max-h-72 overflow-y-auto pr-1 mb-4 scroll-smooth">
              {messages.map((m, i) => (
                <div key={i} className={`flex animate-rise ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-xl px-3.5 py-2 text-sm leading-relaxed ${
                      m.role === "user" ? "bg-accent-fill text-white" : "bg-paper border border-line text-ink"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {diagnosing && (
                <div className="flex justify-start animate-rise">
                  <div className="max-w-[80%] rounded-xl px-4 py-3 bg-paper border border-line">
                    <TypingDots />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {manualFallback ? (
            <ServiceUnavailable
              onRetry={() => {
                setManualFallback(false);
                void runDiagnosis(conversation, turnCount);
              }}
            />
          ) : !done ? (
            <>
              {!demoPlaying && messages.length === 1 && (
                <p className="text-ink font-display font-bold text-xl mb-4 text-center">{messages[0].text}</p>
              )}
              {!demoPlaying && <form onSubmit={handleSubmit} className="flex gap-3">
                <div
                  className="flex-1 rounded-2xl p-[2px] bg-gradient-to-r from-accent via-accent-2 to-accent/40
                    focus-within:shadow-[0_0_0_5px_rgba(var(--color-accent-rgb),0.15)] transition-shadow"
                >
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={placeholder}
                    aria-label="Your answer"
                    autoFocus
                    disabled={diagnosing || demoPlaying}
                    className="w-full bg-surface rounded-2xl px-6 py-5 text-lg text-ink
                      placeholder:text-muted focus:outline-none disabled:opacity-60"
                  />
                </div>
                <button
                  type="submit"
                  disabled={diagnosing || demoPlaying}
                  className="px-8 py-5 rounded-2xl bg-gradient-to-r from-accent to-accent-2 text-white
                    text-base font-semibold hover:opacity-90 transition-opacity shrink-0 disabled:opacity-60"
                >
                  Send
                </button>
              </form>}
            </>
          ) : (
            <div className="rounded-lg border border-accent/25 bg-accent/[0.04] px-4 py-3.5">
              <div className="text-[10px] uppercase tracking-wider text-accent font-semibold mb-3">
                {completionKind === "demo" ? "Demo ready" : "Custom match complete"}
              </div>
              <p className="text-sm text-ink/80 leading-relaxed">
                {completionKind === "demo"
                  ? "Real demo results are shown below."
                  : "Your custom recommendation is ready in the Premium preview below."}
              </p>
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

function ServiceUnavailable({
  onRetry,
}: {
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/[0.06] px-4 py-3.5">
      <div className="text-[10px] uppercase tracking-wider text-warning font-semibold mb-1.5">
        High traffic
      </div>
      <p className="text-sm text-ink/80 leading-relaxed mb-3">
        We're seeing a lot of traffic right now. Please try one of the demo products above, or retry in a moment.
      </p>
      <button onClick={onRetry} className="text-xs font-medium text-muted hover:text-accent transition-colors">
        Try again
      </button>
    </div>
  );
}
