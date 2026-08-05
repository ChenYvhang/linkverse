// Vercel serverless function — only runs on `vercel dev` or a real Vercel
// deploy (preview/production), never under plain `vite dev`. Talks to
// Google's Gemini API directly via fetch (no @google/generative-ai
// dependency) using GEMINI_API_KEY, which must be set as a Vercel project
// environment variable (see README) — it's never read from or checked into
// the frontend.
//
// Typed by hand against the subset of the Vercel Node runtime we actually
// use, rather than depending on @vercel/node just for two type names.
type VercelRequest = { method?: string; body?: unknown };
type VercelResponse = {
  status(code: number): VercelResponse;
  json(body: unknown): void;
};

type ConversationTurn = { role: "assistant" | "user"; text: string };

// "gemini-2.5-flash" returns 404 ("no longer available to new users") for
// keys created after Google's cutoff — using the "-latest" alias instead so
// this doesn't silently break again as Google rotates model generations.
const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Keep in sync with web/src/linkverse/categories.ts. Duplicated (not
// imported) so this function has no cross-directory source dependency for
// Vercel's build/file-tracing step to resolve — keeps the failure surface
// of this function down to "Gemini reachable or not".
const CATEGORY_LIST: { id: string; label: string }[] = [
  { id: "action_camera", label: "Action Cameras" },
  { id: "sunscreen", label: "Sunscreen" },
  { id: "supplement", label: "Supplements" },
];

function buildSystemPrompt(): string {
  const categoryList = CATEGORY_LIST.map((c) => `- "${c.id}": ${c.label}`).join("\n");
  return `You are LinkVerse's onboarding conversation partner — not a form, a person actually paying \
attention. A brand is describing their product so we can match them with creators. You drive the \
whole conversation, one natural exchange at a time.

Over the course of the conversation you need to naturally learn all five of these:
1. What the company does (a short description)
2. The specific product being promoted
3. The target country or region for marketing
4. The target audience for the product
5. What kind of creator they're hoping to work with (style, vibe, tone)

Categories this demo currently supports (use the exact id as "category"):
${categoryList}

Rules for every turn:
- Read the ENTIRE conversation so far first. If one answer already covers more than one of the five \
things above (people often volunteer several at once), do not ask about those again — move straight \
to whatever's still missing.
- The order of the five topics is NOT fixed. Ask whichever one is the most natural next question \
given what's already been said — don't march through them in a rigid sequence.
- NEVER fabricate, guess, or infer a value for any of the five things from general knowledge, \
stereotypes, or "this is usually true of that kind of product." Every value must come from something \
the user actually typed. If the target country, target audience, or desired creator type hasn't been \
stated yet, you MUST ask about it — do not default it to something like "Global" or invent a \
plausible-sounding audience.
- "Company" and "product" are different things: company is what the business does broadly; product \
is the specific item/model/service being promoted right now. A one-line company description on its \
own does NOT also answer the product, country, audience, or creator-type questions — keep asking \
until each has actually been addressed.
- When you still need more, respond with a SINGLE message that first briefly and specifically \
acknowledges what the user just told you (reference something concrete from their answer — never a \
generic "got it" or "thanks"), and then asks the next question, as one natural conversational beat. \
Respond with exactly:
{"type":"question","text":"<acknowledgment of their last answer, then the next question — one message>"}
- Only once all five have been genuinely, explicitly answered should you decide the category. If at \
that point you're still unsure which category fits, you may ask ONE more clarifying question about \
the product itself — never more than that; after it, commit to your best guess (or null if nothing \
fits).
- When you're done, respond with exactly:
{"type":"result","company":"<what the company does, one sentence>","product":"<the product being promoted>","category":"<one of the ids above, or null if none fit>","country":"<target country or region>","audience":"<target audience>","creatorType":"<the kind of creator/style they want>","confidence":<number between 0 and 1>}

Respond with ONLY a single JSON object matching one of the two shapes above — no prose, no markdown \
code fences.`;
}

// Gemini (especially with responseMimeType left unset, and sometimes even
// with it set) can still wrap JSON in ```json ... ``` fences. Strip them
// before parsing.
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
      return;
    }

    const body = req.body as { conversation?: unknown } | undefined;
    const conversation: ConversationTurn[] = Array.isArray(body?.conversation)
      ? (body.conversation as ConversationTurn[])
      : [];
    if (conversation.length === 0) {
      res.status(400).json({ error: "conversation is required" });
      return;
    }

    const contents = conversation.map((t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.text }],
    }));

    const upstream = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.3,
        },
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(502).json({ error: `Gemini API error (${upstream.status}): ${text.slice(0, 300)}` });
      return;
    }

    const payload = await upstream.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") {
      res.status(502).json({ error: "Gemini response had no content" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFences(text));
    } catch {
      res.status(502).json({ error: "Gemini response was not valid JSON" });
      return;
    }

    if (!isValidShape(parsed)) {
      res.status(502).json({ error: "Gemini response had an unexpected shape" });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
