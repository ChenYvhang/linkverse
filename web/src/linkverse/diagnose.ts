import { CATEGORIES, type CategoryId } from "./categories";
import type { Catalog } from "./catalog";

/** The visitor's own product, placed on the active category's axes. When
 *  present, the ranking is recomputed against it instead of showing the
 *  pipeline's precomputed one. */
export type ProductMatch = { product: string; vector: number[] };

export type ConversationTurn = { role: "assistant" | "user"; text: string };

export type DiagnosisResult =
  | { done: false; question: string }
  | {
      done: true;
      ok: true;
      categoryId: CategoryId | null;
      confidence: number;
      summary: string;
      /** The visitor's product placed on the category's axes, or null when the
       *  model couldn't place it. Non-null means the ranking is re-scored
       *  against their product instead of the pipeline's fixed one. */
      productVector: number[] | null;
      product: string;
    }
  | { done: true; ok: false };

type ApiResponse =
  | { type: "question"; text: string }
  | {
      type: "result";
      company: string;
      product: string;
      category: string | null;
      creatorType?: string;
      confidence: number;
      productVector?: number[] | null;
    };

// Allows one server-side repair attempt when the model returns malformed JSON.
// The UI still falls back cleanly if both attempts exceed this budget.
const REQUEST_TIMEOUT_MS = 30_000;

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
// DeepSeek server-side (see web/api/diagnose.ts). Only runs under `vercel
// dev` or a real Vercel deploy — under plain `vite dev`, or any network
// hiccup or timeout, this resolves to {done:true, ok:false} rather than
// throwing or hanging, so the chat can fall back to manual category
// selection instead of ever stalling on a blank/frozen state (important
// live-demo requirement — see Onboarding.tsx's manual-fallback UI).
export async function diagnoseCompany(
  conversation: ConversationTurn[],
  // Every category's axes, keyed by id (from catalog.ts) — NOT just the
  // currently-loaded category's. The model only learns which category fits
  // once the conversation ends, so sending a single category's axes upfront
  // meant a non-default category's product got scored against the WRONG
  // category's semantics (e.g. a sunscreen product placed on action-camera's
  // "gear visibility" axis) — same array length, silently meaningless values.
  // Sending the full map lets /api/diagnose pick the right axis set after it
  // decides the category.
  dimensionsByCategory?: Catalog,
): Promise<DiagnosisResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch("/api/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation,
        dimensionsByCategory: dimensionsByCategory
          ? Object.fromEntries(
              Object.entries(dimensionsByCategory).map(([id, entry]) => [id, entry!.dimensions]),
            )
          : undefined,
      }),
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
      productVector: Array.isArray(data.productVector) ? data.productVector : null,
      product: data.product,
    };
  } catch {
    return { done: true, ok: false };
  } finally {
    clearTimeout(timeout);
  }
}
