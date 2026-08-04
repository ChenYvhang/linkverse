export type CategoryStatus = "ready" | "onboarding";

export type CategoryId = "action_camera" | "cosmetics" | "pet_products" | "home_fitness";

export type CategoryDef = {
  id: CategoryId;
  label: string;
  status: CategoryStatus;
  /** Path relative to BASE_URL, fetched by useData(). */
  dataPath: string;
};

// To activate an onboarding category: replace its JSON file (same shape as
// linkverse.json) with real data, then flip its status to "ready" here.
export const CATEGORIES: CategoryDef[] = [
  { id: "action_camera", label: "Action Cameras", status: "ready", dataPath: "linkverse.json" },
  { id: "cosmetics", label: "Cosmetics", status: "onboarding", dataPath: "linkverse/cosmetics.json" },
  { id: "pet_products", label: "Pet Products", status: "onboarding", dataPath: "linkverse/pet_products.json" },
  { id: "home_fitness", label: "Home Fitness", status: "onboarding", dataPath: "linkverse/home_fitness.json" },
];
