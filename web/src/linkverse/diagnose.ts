import { CATEGORIES, type CategoryId } from "./categories";

export type ConversationTurn = { role: "assistant" | "user"; text: string };

export type DiagnosisResult =
  | { done: false; question: string }
  | { done: true; ok: true; categoryId: CategoryId | null; confidence: number; summary: string }
  | { done: true; ok: false };

type ApiResponse =
  | { type: "question"; text: string }
  | {
      type: "result";
      company: string;
      product: string;
      category: string | null;
      country: string;
      audience: string;
      creatorType?: string;
      confidence: number;
    };

const REQUEST_TIMEOUT_MS = 12_000;

function asKnownCategory(id: string | null): CategoryId | null {
  return id !== null && CATEGORIES.some((c) => c.id === id) ? (id as CategoryId) : null;
}

function summarize(categoryId: CategoryId | null, product: string, creatorType?: string): string {
  if (!categoryId) {
    return "Thanks — we couldn't confidently match this to one of our demo categories yet.";
  }
  const label = CATEGORIES.find((c) => c.id === categoryId)?.label ?? categoryId;
  const base = `Based on what you described, ${product || "this"} fits our ${label.toLowerCase()} category.`;
  return creatorType ? `${base} Sounds like you'd want creators who are ${creatorType.toLowerCase()}.` : base;
}

// Calls the /api/diagnose Vercel serverless function, which talks to
// Gemini server-side (see web/api/diagnose.ts). Only runs under `vercel
// dev` or a real Vercel deploy — under plain `vite dev`, or any network
// hiccup or timeout, this resolves to {done:true, ok:false} rather than
// throwing or hanging, so the chat can fall back to manual category
// selection instead of ever stalling on a blank/frozen state (important
// live-demo requirement — see Onboarding.tsx's manual-fallback UI).
export async function diagnoseCompany(conversation: ConversationTurn[]): Promise<DiagnosisResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch("/api/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`/api/diagnose responded ${res.status}`);

    const data: ApiResponse = await res.json();
    if (data.type === "question") {
      return { done: false, question: data.text };
    }

    const categoryId = asKnownCategory(data.category);
    return {
      done: true,
      ok: true,
      categoryId,
      confidence: data.confidence,
      summary: summarize(categoryId, data.product, data.creatorType),
    };
  } catch {
    return { done: true, ok: false };
  } finally {
    clearTimeout(timeout);
  }
}
