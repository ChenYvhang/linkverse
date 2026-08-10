import type { CategoryId } from "./categories";

// Fully scripted conversation replays for the onboarding chat's "start with
// example" buttons — both sides of the dialogue are pre-written, and the
// final result is hardcoded rather than calling /api/diagnose. This is
// deliberate: these buttons exist so a live presentation never depends on
// the LLM behind /api/diagnose actually being reachable (see the real quota
// outage this project
// hit mid-build). For seeing the model reason live, just type a real answer
// instead of clicking one of these.
export type DemoScenario = {
  categoryId: CategoryId;
  buttonLabel: string;
  // questions[0] is the shared opening line; questions[i] (i>0) is the
  // acknowledgment of answers[i-1] plus the next question, already combined
  // into one message the way a live response would be.
  questions: [string, string, string];
  answers: [string, string, string];
  summary: string;
  confidence: number;
};

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    categoryId: "action_camera",
    buttonLabel: "Insta360 (Action Camera)",
    questions: [
      "What does your company do? Tell us a bit about it.",
      "Capturing high-octane extreme sports on camera sounds awesome! Which specific product are you promoting right now?",
      "The Insta360 X5 sounds like a serious piece of kit for capturing all those angles! What kind of creator style or vibe are you hoping to partner with?",
    ],
    answers: [
      "We make Insta360 action cameras for extreme sports.",
      "The Insta360 X5, our new 360° waterproof action camera.",
      "High-energy, authentic outdoor athletes who film their own stunts — not overly polished.",
    ],
    summary:
      "Based on what you described, the Insta360 X5 360° waterproof action camera fits our action cameras category. Sounds like you'd want creators who are high-energy, authentic outdoor athletes who film their own stunts with a raw, less polished feel.",
    confidence: 0.97,
  },
  {
    categoryId: "sunscreen",
    buttonLabel: "Neutrogena (Sunscreen)",
    questions: [
      "What does your company do? Tell us a bit about it.",
      "Neutrogena's a name most people already trust for skincare! Which specific product are you promoting right now?",
      "Ultra Sheer Dry-Touch is such a popular everyday pick! What kind of creator style or vibe are you hoping to work with?",
    ],
    answers: [
      "We're Neutrogena, a global skincare brand known for dermatologist-recommended products.",
      "Our Ultra Sheer Dry-Touch Sunscreen, SPF 55.",
      "Relatable skincare enthusiasts who show honest, everyday routines — not overly glamorous.",
    ],
    summary:
      "Based on what you described, Neutrogena's Ultra Sheer Dry-Touch Sunscreen SPF 55 fits our sunscreen category. Sounds like you'd want creators who are relatable skincare enthusiasts sharing honest, everyday routines.",
    confidence: 0.95,
  },
  {
    categoryId: "supplement",
    buttonLabel: "Optimum Nutrition (Supplement)",
    questions: [
      "What does your company do? Tell us a bit about it.",
      "Optimum Nutrition is basically iconic in the fitness supplement world! Which specific product are you promoting right now?",
      "Gold Standard Whey is a staple for so many lifters! What kind of creator style or vibe are you hoping to work with?",
    ],
    answers: [
      "We're Optimum Nutrition, one of the world's leading sports nutrition brands.",
      "Gold Standard 100% Whey Protein Powder, Double Rich Chocolate flavor.",
      "Serious lifters who post real training footage and progress updates — no fluff, just results.",
    ],
    summary:
      "Based on what you described, Optimum Nutrition's Gold Standard 100% Whey Protein fits our supplement category. Sounds like you'd want creators who are serious lifters posting real training footage and progress updates.",
    confidence: 0.95,
  },
];
