// Vercel serverless function — only runs on `vercel dev` or a real Vercel
// deploy (preview/production), never under plain `vite dev`. Talks to
// DeepSeek's OpenAI-compatible API directly via fetch (no SDK dependency)
// using DEEPSEEK_API_KEY, which must be set as a Vercel project environment
// variable (see README) — it's never read from or checked into the frontend.
//
// DeepSeek rather than Gemini so the whole project runs on one LLM vendor and
// one key: Stage5/5b/5c/5d already call DeepSeek (see pipeline/decide.py), and
// this was the only place that needed a second provider and a second key.
//
// Typed by hand against the subset of the Vercel Node runtime we actually
// use, rather than depending on @vercel/node just for two type names.
type VercelRequest = { method?: string; body?: unknown };
type VercelResponse = {
  status(code: number): VercelResponse;
  json(body: unknown): void;
};
declare const process: { env: Record<string, string | undefined> };

type ConversationTurn = { role: "assistant" | "user"; text: string };
type DeepSeekMessage = { role: "system" | "assistant" | "user"; content: string };

// A category's semantic axes, sent by the client from catalog.json (see
// pipeline/export_catalog.py). Passed in rather than duplicated here so there
// is exactly one definition of a category's space — pipeline config — and
// this function stays free of cross-directory imports.
type Dimension = { key: string; name: string; description: string };

// Same model/base URL the pipeline pins (pipeline/decide.py): deepseek-chat
// and deepseek-reasoner were retired 2026-07-24, deepseek-v4-flash is the
// current name. Kept in sync with the pipeline deliberately — one vendor,
// one model generation, one place to update.
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

// Keep in sync with web/src/linkverse/categories.ts. Duplicated (not
// imported) so this function has no cross-directory source dependency for
// Vercel's build/file-tracing step to resolve — keeps the failure surface
// of this function down to "DeepSeek reachable or not".
const CATEGORY_LIST: { id: string; label: string }[] = [
  { id: "action_camera", label: "Action Cameras" },
  { id: "sunscreen", label: "Sunscreen" },
  { id: "supplement", label: "Supplements" },
];

// Appended to the system prompt when the client supplies every category's
// axes. This is what turns the chat from a classifier into real matching: the
// model places the visitor's product on the same axes vision.py scored
// creators on, and the client then recomputes resonance against that vector
// instead of showing a fixed, precomputed ranking.
//
// Sends ALL categories' axes, not just one: the model only knows which
// category fits once it commits to "category" in this same response, so
// there is no single axis set to send in advance. Sending only the
// currently-loaded category's axes (the previous design) meant a visitor
// describing e.g. a sunscreen product still got scored against action-
// camera's "stabilization demand" / "gear visibility" — same array length,
// so validation passed, but the numbers were meaningless. The model is
// instead told to pick the axis list matching its OWN "category" answer.
function buildVectorInstruction(dimsByCategory: Record<string, Dimension[]>): string {
  const sections = Object.entries(dimsByCategory)
    .map(([catId, dims]) => {
      const axes = dims.map((d, i) => `    [${i}] ${d.key} — ${d.name}: ${d.description}`).join("\n");
      return `  "${catId}" (${dims.length} axes, in this order):\n${axes}`;
    })
    .join("\n\n");
  return `

When you emit the "result" object AND "category" is not null, ALSO include "productVector": an \
array of numbers between 0.0 and 1.0 that places THIS PRODUCT on the axes for the category you \
just chose. Use ONLY that category's axis list below, in that exact order — the array length MUST \
equal that category's axis count:

${sections}

Each number is how much THIS PRODUCT needs that quality in a creator's content — not how much the \
creator has it. Score only from what the user actually told you about the product; where they said \
nothing relevant to an axis, use 0.5 rather than inventing a preference. If "category" is null, or \
you cannot confidently place the product on its axes, set "productVector": null instead of guessing.`;
}

function buildSystemPrompt(dimsByCategory?: Record<string, Dimension[]>): string {
  const categoryList = CATEGORY_LIST.map((c) => `- "${c.id}": ${c.label}`).join("\n");
  const vectorPart =
    dimsByCategory && Object.keys(dimsByCategory).length > 0 ? buildVectorInstruction(dimsByCategory) : "";
  return `You are LinkVerse's onboarding conversation partner — not a form, a person actually paying \
attention. A brand is describing their product so we can match them with creators. You drive the \
whole conversation, one natural exchange at a time.

Over the course of the conversation you need to naturally learn all three of these:
1. What the company does (a short description)
2. The specific product being promoted
3. What kind of creator they're hoping to work with (style, vibe, tone)

Categories this demo currently supports (use the exact id as "category"):
${categoryList}

Rules for every turn:
- Read the ENTIRE conversation so far first. If one answer already covers more than one of the three \
things above (people often volunteer several at once), do not ask about those again — move straight \
to whatever's still missing.
- The order of the three topics is NOT fixed. Ask whichever one is the most natural next question \
given what's already been said — don't march through them in a rigid sequence.
- NEVER fabricate, guess, or infer a value for any of the three things from general knowledge, \
stereotypes, or "this is usually true of that kind of product." Every value must come from something \
the user actually typed. If the desired creator type hasn't been stated yet, you MUST ask about it — \
do not invent a plausible-sounding style.
- If the user explicitly names one of the category labels/ids above at any point — in any answer, \
not just when describing the product — treat that as strong, confident evidence for the "category" \
field. Don't second-guess it later or lose track of it while you keep gathering the other two things.
- "Company" and "product" are different things: company is what the business does broadly; product \
is the specific item/model/service being promoted right now. A one-line company description on its \
own does NOT also answer the product or creator-type questions — keep asking until each has actually \
been addressed.
- When you still need more, respond with a SINGLE message that first briefly and specifically \
acknowledges what the user just told you (reference something concrete from their answer — never a \
generic "got it" or "thanks"), and then asks the next question, as one natural conversational beat. \
Respond with exactly:
{"type":"question","text":"<acknowledgment of their last answer, then the next question — one message>"}
- Only once all three have been genuinely, explicitly answered should you decide the category. If at \
that point you're still unsure which category fits, you may ask ONE more clarifying question about \
the product itself — never more than that; after it, commit to your best guess (or null if nothing \
fits).
- When you're done, respond with exactly:
{"type":"result","company":"<what the company does, one sentence>","product":"<the product being promoted>","category":"<one of the ids above, or null if none fit>","creatorType":"<the kind of creator/style they want>","confidence":<number between 0 and 1>}

Respond with ONLY a single json object matching one of the two shapes above — no prose, no markdown \
code fences.${vectorPart}`;
  // ^ the literal lowercase "json" is load-bearing: DeepSeek's
  // response_format={"type":"json_object"} requires the word to appear in the
  // prompt, and silently degrades to free-form text if it doesn't.
}

// json_object mode should already guarantee bare JSON, but keep stripping
// ```json ... ``` fences defensively — this is the difference between a
// degraded model response and a broken onboarding chat on stage.
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

// JSON mode is not perfectly reliable under load: the model can still wrap a
// valid object in a sentence or a code block. Extract the first balanced JSON
// object without being confused by braces inside quoted strings.
function extractJsonObject(text: string): string | null {
  const source = stripCodeFences(text);
  const start = source.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

function parseModelResponse(text: string): unknown | null {
  const candidate = extractJsonObject(text);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function isValidShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === "question" || v.type === "result";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Everything below is wrapped in one try/catch — this function must always
  // resolve with clean JSON, never an uncaught exception (which Vercel
  // surfaces to callers as an opaque FUNCTION_INVOCATION_FAILED 500).
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "DEEPSEEK_API_KEY is not configured" });
      return;
    }

    const body = req.body as { conversation?: unknown; dimensionsByCategory?: unknown } | undefined;
    const conversation: ConversationTurn[] = Array.isArray(body?.conversation)
      ? (body.conversation as ConversationTurn[])
      : [];
    const rawDimsByCategory =
      body?.dimensionsByCategory && typeof body.dimensionsByCategory === "object"
        ? (body.dimensionsByCategory as Record<string, unknown>)
        : {};
    const dimensionsByCategory: Record<string, Dimension[]> = Object.fromEntries(
      Object.entries(rawDimsByCategory)
        .filter(([, v]) => Array.isArray(v))
        .map(([catId, v]) => [
          catId,
          (v as Dimension[]).filter((d) => d && typeof d.key === "string" && typeof d.description === "string"),
        ])
        .filter(([, dims]) => (dims as Dimension[]).length > 0),
    );
    if (conversation.length === 0) {
      res.status(400).json({ error: "conversation is required" });
      return;
    }

    const messages: DeepSeekMessage[] = [
      { role: "system", content: buildSystemPrompt(dimensionsByCategory) },
      ...conversation.map((t) => ({
        role: t.role === "assistant" ? "assistant" : "user",
        content: t.text,
      })),
    ];

    let parsed: unknown | null = null;
    let attemptMessages = messages;
    let lastFailure = "DeepSeek did not return a valid response";

    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const upstream = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: attemptMessages,
          response_format: { type: "json_object" },
          temperature: attempt === 0 ? 0.2 : 0,
        }),
      });

      if (!upstream.ok) {
        lastFailure = `DeepSeek API error (${upstream.status})`;
        continue;
      }

      const payload = await upstream.json();
      const text = payload?.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        lastFailure = "DeepSeek response had no content";
        continue;
      }

      const candidate = parseModelResponse(text);
      if (isValidShape(candidate)) {
        parsed = candidate;
        break;
      }

      lastFailure = "DeepSeek response was not valid JSON";
      attemptMessages = [
        ...messages,
        { role: "assistant", content: text },
        {
          role: "user",
          content: "Your previous response was invalid. Return exactly one valid JSON object matching the requested shape, with no prose or code fence.",
        },
      ];
    }

    if (!parsed) {
      res.status(502).json({ error: lastFailure });
      return;
    }

    // A malformed vector is dropped rather than passed through: the client
    // falls back to the pipeline's precomputed ranking, which is worse but
    // real. A wrong-length or out-of-range vector would silently produce a
    // nonsense ranking that still looks authoritative. Validated against the
    // MATCHED category's own axis count — not just any category's — so a
    // vector scored on the wrong category's semantics can't slip through
    // just because the array happens to be the right length.
    const out = parsed as Record<string, unknown>;
    if (out.type === "result") {
      const catId = typeof out.category === "string" ? out.category : null;
      const dims = catId ? dimensionsByCategory[catId] : undefined;
      const v = out.productVector;
      const valid =
        !!dims &&
        dims.length > 0 &&
        Array.isArray(v) &&
        v.length === dims.length &&
        v.every((n) => typeof n === "number" && n >= 0 && n <= 1);
      if (!valid) out.productVector = null;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
