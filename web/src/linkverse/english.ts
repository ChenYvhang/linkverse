const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;

export function containsHan(value: unknown): boolean {
  return typeof value === "string" && HAN.test(value);
}

export function englishOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() && !containsHan(value) ? value : fallback;
}

export function englishName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const withoutHan = value
    .replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—·|/]+|[-–—·|/]+$/g, "")
    .trim();
  return /[A-Za-z0-9]/.test(withoutHan) ? withoutHan : fallback;
}

export const DIMENSION_EN: Record<string, { name: string; description: string }> = {
  perspective_ratio: {
    name: "First-person perspective",
    description: "Share of footage filmed from an immersive first-person or POV angle.",
  },
  stabilization_demand: {
    name: "Stabilization demand",
    description: "How strongly the creator's footage depends on hardware stabilization.",
  },
  motion_complexity: {
    name: "Camera movement complexity",
    description: "Variety of tracking, orbiting, aerial, and multi-angle camera movement.",
  },
  scene_extremity: {
    name: "Scene extremity",
    description: "How fast, exposed, underwater, or otherwise demanding the filming environment is.",
  },
  gear_visibility: {
    name: "Gear visibility",
    description: "How often cameras, mounts, protective equipment, or other gear appears on screen.",
  },
  narrative_pace: {
    name: "Narrative pace",
    description: "Editing speed and information density.",
  },
  scene_diversity: {
    name: "Scene diversity",
    description: "Variety of locations and settings within a video.",
  },
  slow_motion_demand: {
    name: "Slow-motion demand",
    description: "How naturally the content uses slow motion, high-frame-rate footage, or bullet-time effects.",
  },
  sun_exposure: {
    name: "Sun exposure",
    description: "How often people appear outdoors or in strong sunlight.",
  },
  skin_visibility: {
    name: "Skin visibility",
    description: "How clearly the content can show sunscreen application and results.",
  },
  ingredient_depth: {
    name: "Ingredient depth",
    description: "How comfortably the creator explains ingredients, formulation, and protection claims.",
  },
  authenticity: {
    name: "Authenticity",
    description: "How naturally the content presents real use rather than advertisement-style delivery.",
  },
  demo_friendliness: {
    name: "Demo friendliness",
    description: "How well the format supports a clear, useful product demonstration.",
  },
  reapplication_context: {
    name: "Reapplication context",
    description: "Presence of sweat, water, or long outdoor sessions where reapplication matters.",
  },
  audience_female_skew: {
    name: "Audience skincare interest",
    description: "How strongly the audience engages with skincare topics, without inferring gender.",
  },
  training_intensity: {
    name: "Training intensity",
    description: "Training load and level of specialization shown in the content.",
  },
  physique_visibility: {
    name: "Physique visibility",
    description: "How clearly training progress or physical condition appears on screen.",
  },
  science_rigor: {
    name: "Scientific rigor",
    description: "Depth and restraint when discussing research, mechanisms, and evidence.",
  },
  nutrition_focus: {
    name: "Nutrition focus",
    description: "Share of content devoted to food and supplements rather than exercise alone.",
  },
  audience_experience: {
    name: "Audience experience",
    description: "Whether the audience is primarily beginner, intermediate, or advanced.",
  },
};

export function englishDimension(key: string, name?: string, description?: string) {
  const known = DIMENSION_EN[key];
  const fallbackName = key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return {
    key,
    name: known?.name ?? englishOr(name, fallbackName),
    description: known?.description ?? englishOr(description, "Category-specific matching dimension."),
  };
}

export const PRODUCT_DESCRIPTION_EN: Record<string, string> = {
  x5: "A 360-degree action camera built for immersive POV footage, invisible-stick shots, and demanding environments.",
  go3s: "A compact wearable camera for lightweight, hands-free first-person footage.",
  ace_pro2: "A rugged action camera focused on stabilization, low-light capture, and extreme environments.",
  flow2pro: "A smartphone gimbal for smooth camera movement, everyday action, and narrative vlogging.",
  outdoor_spf50: "A water- and sweat-resistant SPF50+ sunscreen for high-intensity outdoor activity.",
  daily_essence: "A lightweight daily sunscreen essence designed for comfortable skincare and makeup preparation.",
  kids_mineral: "A gentle mineral sunscreen for children and family outdoor use.",
  whey_isolate: "A high-protein, low-lactose whey isolate designed for strength and muscle-building routines.",
  creatine_mono: "Evidence-based, unflavored creatine monohydrate for experienced trainees.",
  electrolyte_mix: "A portable, sugar-free electrolyte mix for runners, endurance athletes, and outdoor training.",
};
