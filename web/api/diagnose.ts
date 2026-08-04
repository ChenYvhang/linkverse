// Vercel serverless function — only runs on `vercel dev` or a real Vercel
// deploy (preview/production), never under plain `vite dev`. Talks to
// DeepSeek's OpenAI-compatible chat completions endpoint using
// DEEPSEEK_API_KEY, which must be set as a Vercel project environment
// variable (see README) — it's never read from or checked into the frontend.
//
// Typed by hand against the subset of the Vercel Node runtime we actually
// use, rather than depending on @vercel/node just for two type names.
type VercelRequest = { method?: string; body?: unknown };
type VercelResponse = {
  status(code: number): VercelResponse;
  json(body: unknown): void;
};

type ConversationTurn = { role: "assistant" | "user"; text: string };

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

// Keep in sync with web/src/linkverse/categories.ts. Duplicated (not
// imported) so this function has no cross-directory source dependency for
// Vercel's build/file-tracing step to resolve — keeps the failure surface
// of this function down to "DeepSeek reachable or not".
const CATEGORY_LIST: { id: string; label: string }[] = [
  { id: "action_camera", label: "Action Cameras" },
  { id: "cosmetics", label: "Cosmetics" },
  { id: "home_fitness", label: "Home Fitness" },
];

function buildSystemPrompt(): string {
  const categoryList = CATEGORY_LIST.map((c) => `- "${c.id}": ${c.label}`).join("\n");
  return `You are the product-diagnosis assistant behind LinkVerse, a brand-to-creator matching demo. \
You're given a conversation where the user has already answered what their company does, which \
product they're promoting, their target country/region, and their target audience.

Categories this demo currently supports (use the exact id as "category"):
${categoryList}

Decide one of two things:

1. If you genuinely need more information to confidently classify the product into one of the \
categories above, respond with exactly:
{"type":"question","text":"<one short, specific follow-up question>"}
Ask at most ONE follow-up question for the whole conversation — check the message history first; \
if an assistant turn already asked a clarifying question, do not ask another, just commit to your \
best guess instead.

2. Otherwise, respond with exactly:
{"type":"result","company":"<what the company does, one sentence>","product":"<the product being promoted>","category":"<one of the ids above, or null if none fit>","country":"<target country or region>","audience":"<target audience>","confidence":<number between 0 and 1>}

Respond with ONLY a single JSON object matching one of the two shapes above — no prose, no markdown \
code fences.`;
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

    const body = req.body as { conversation?: unknown } | undefined;
    const conversation: ConversationTurn[] = Array.isArray(body?.conversation)
      ? (body.conversation as ConversationTurn[])
      : [];
    if (conversation.length === 0) {
      res.status(400).json({ error: "conversation is required" });
      return;
    }

    const messages = [
      { role: "system", content: buildSystemPrompt() },
      ...conversation.map((t) => ({ role: t.role, content: t.text })),
    ];

    const upstream = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
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
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      res.status(502).json({ error: "DeepSeek response had no content" });
      return;
    }

    const parsed = JSON.parse(content);
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
