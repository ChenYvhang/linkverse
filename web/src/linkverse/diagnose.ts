import { CATEGORIES, type CategoryId } from "./categories";

export type ConversationTurn = { role: "assistant" | "user"; text: string };

export type DiagnosisResult =
  | { done: false; question: string }
  | { done: true; categoryId: CategoryId; confidence: number; summary: string };

export const FALLBACK_CATEGORY_ID: CategoryId = "action_camera";

// Stand-in for a real backend/LLM call. The onboarding UI only depends on
// this function's signature and DiagnosisResult shape — swap the body for a
// real request later without touching the chat flow.
//
// Mocked behavior: score the user's answers against each category's
// keywords. If nothing matches yet and we haven't already asked a follow-up,
// ask one clarifying question; otherwise commit to the best-scoring category
// (falling back to action_camera if there's still no signal).
export async function diagnoseCompany(conversation: ConversationTurn[]): Promise<DiagnosisResult> {
  await new Promise((r) => setTimeout(r, 550));

  const userText = conversation
    .filter((t) => t.role === "user")
    .map((t) => t.text.toLowerCase())
    .join(" ");

  const scores = CATEGORIES.map((c) => ({
    id: c.id,
    score: c.keywords.reduce((n, kw) => n + (userText.includes(kw) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);

  const askedFollowUp = conversation.some((t) => t.role === "assistant" && t.text.startsWith("[followup] "));

  if (scores[0].score === 0 && !askedFollowUp) {
    return {
      done: false,
      question: "[followup] Could you describe the product itself — what does it look or feel like to use?",
    };
  }

  const best = scores[0].score > 0 ? scores[0].id : FALLBACK_CATEGORY_ID;
  const label = CATEGORIES.find((c) => c.id === best)?.label ?? best;
  const confidence = scores[0].score > 0 ? Math.min(0.5 + scores[0].score * 0.15, 0.95) : 0.4;

  return {
    done: true,
    categoryId: best,
    confidence,
    summary: `Based on what you described, this looks like a ${label.toLowerCase()} product.`,
  };
}
