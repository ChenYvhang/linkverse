export type CategoryStatus = "ready" | "onboarding";

export type CategoryId = "action_camera" | "cosmetics" | "home_fitness";

export type CategoryDef = {
  id: CategoryId;
  label: string;
  status: CategoryStatus;
  /** Path relative to BASE_URL, fetched by useData(). */
  dataPath: string;
  /** Lowercase keywords used by the (mocked) diagnosis matcher — see diagnose.ts. */
  keywords: string[];
};

// To activate an onboarding category: replace its JSON file (same shape as
// linkverse.json) with real data, then flip its status to "ready" here.
export const CATEGORIES: CategoryDef[] = [
  {
    id: "action_camera",
    label: "Action Cameras",
    status: "ready",
    dataPath: "linkverse.json",
    keywords: ["action camera", "gopro", "insta360", "camera", "gimbal", "extreme sport", "액션캠", "카메라"],
  },
  {
    id: "cosmetics",
    label: "Cosmetics",
    status: "onboarding",
    dataPath: "linkverse/cosmetics.json",
    keywords: ["skincare", "makeup", "cosmetic", "beauty", "serum", "cream", "화장품", "뷰티", "스킨케어"],
  },
  {
    id: "home_fitness",
    label: "Home Fitness",
    status: "onboarding",
    dataPath: "linkverse/home_fitness.json",
    keywords: ["fitness", "gym", "workout", "exercise", "resistance band", "홈트", "피트니스", "운동"],
  },
];
