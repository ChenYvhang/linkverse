export type CategoryStatus = "ready" | "onboarding";

export type CategoryId = "action_camera" | "sunscreen" | "supplement";

export type CategoryDef = {
  id: CategoryId;
  label: string;
  status: CategoryStatus;
  /** Path relative to BASE_URL, fetched by useData(). */
  dataPath: string;
};

// To activate an onboarding category: replace its JSON file (same shape as
// linkverse.json) with real data, then flip its status to "ready" here.
// Also keep web/api/diagnose.ts's CATEGORY_LIST in sync — it's a duplicate,
// not an import, so the serverless function has no cross-directory
// dependency (see the comment there for why).
export const CATEGORIES: CategoryDef[] = [
  { id: "action_camera", label: "Action Cameras", status: "ready", dataPath: "linkverse.json" },
  { id: "sunscreen", label: "Sunscreen", status: "onboarding", dataPath: "linkverse/sunscreen.json" },
  { id: "supplement", label: "Supplements", status: "onboarding", dataPath: "linkverse/supplement.json" },
];
