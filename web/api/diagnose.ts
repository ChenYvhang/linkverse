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

type ConversationTurn = { role: "assistant" | "user"; text: string };

// The category's semantic axes, sent by the client from the dataset's meta
// (see web/scripts/build-linkverse.mjs). Passed in rather than duplicated here
// so there is exactly one definition of a category's space — pipeline config —
// and this function stays free of cross-directory imports.
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

// Appended to the system prompt when the client supplies the category's axes.
// This is what turns the chat from a classifier into real matching: the model
// places the visitor's product on the same axes vision.py scored creators on,
// and the client then recomputes resonance against that vector instead of
// showing a fixed, precomputed ranking.
function buildVectorInstruction(dims: Dimension[]): string {
  const axes = dims
    .map((d, i) => `  [${i}] ${d.key} — ${d.name}: ${d.description}`)
    .join("\n");
  return `

When you emit the "result" object, ALSO include "productVector": an array of \
exactly ${dims.length} numbers between 0.0 and 1.0, in this exact order:

${axes}

Each number is how much THIS PRODUCT needs that quality in a creator's content \
— not how much the creator has it. Score only from what the user actually told \
you about the product; where they said nothing relevant to an axis, use 0.5 \
rather than inventing a preference. If you cannot place the product on these \
axes at all, set "productVector": null instead of guessing.`;
}

function buildSystemPrompt(dims?: Dimension[]): string {
  const categoryList = CATEGORY_LIST.map((c) => `- "${c.id}": ${c.label}`).join("\n");
  const vectorPart = dims && dims.length > 0 ? buildVectorInstruction(dims) : "";
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

    const body = req.body as { conversation?: unknown; dimensions?: unknown } | undefined;
    const conversation: ConversationTurn[] = Array.isArray(body?.conversation)
      ? (body.conversation as ConversationTurn[])
      : [];
    const dimensions: Dimension[] = Array.isArray(body?.dimensions)
      ? (body.dimensions as Dimension[]).filter(
          (d) => d && typeof d.key === "string" && typeof d.description === "string",
        )
      : [];
    if (conversation.length === 0) {
      res.status(400).json({ error: "conversation is required" });
      return;
    }

    const messages = [
      { role: "system", content: buildSystemPrompt(dimensions) },
      ...conversation.map((t) => ({
        role: t.role === "assistant" ? "assistant" : "user",
        content: t.text,
      })),
    ];

    const upstream = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(502).json({ error: `DeepSeek API error (${upstream.status}): ${text.slice(0, 300)}` });
      return;
    }

    const payload = await upstream.json();
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      res.status(502).json({ error: "DeepSeek response had no content" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFences(text));
    } catch {
      res.status(502).json({ error: "DeepSeek response was not valid JSON" });
      return;
    }

    if (!isValidShape(parsed)) {
      res.status(502).json({ error: "DeepSeek response had an unexpected shape" });
      return;
    }

    // A malformed vector is dropped rather than passed through: the client
    // falls back to the pipeline's precomputed ranking, which is worse but
    // real. A wrong-length or out-of-range vector would silently produce a
    // nonsense ranking that still looks authoritative.
    const out = parsed as Record<string, unknown>;
    if (out.type === "result" && dimensions.length > 0) {
      const v = out.productVector;
      const valid =
        Array.isArray(v) &&
        v.length === dimensions.length &&
        v.every((n) => typeof n === "number" && n >= 0 && n <= 1);
      if (!valid) out.productVector = null;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
