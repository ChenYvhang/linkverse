// TS types mirroring web/public/dataset.json, generated from the real Stage6
// build.py output (not the illustrative sketch in PLAN.md §3) — field shapes
// were verified against a live dataset.json before writing this file.

export interface QuotaUsed {
  search: number;
  channels: number;
  playlistItems: number;
  videos: number;
  total: number;
}

export interface ModelStatus {
  potential_score_model: "dual_head_gbdt" | "heuristic";
  gbdt_sample_count: number;
}

export interface CoverageStat {
  analyzed?: number;
  generated?: number;
  total: number;
  note?: string;
}

export interface AgeBiasValidation {
  slope: number;
  spread_for_reference: number;
  threshold: number;
  pass: boolean;
}

export interface DataSource {
  platform: string;
  status: "connected" | "pending";
}

export type ArchitectureLayerStatus = "live" | "live_with_caveat" | "pending";

export interface ArchitectureLayer {
  layer: string;
  status: ArchitectureLayerStatus;
  note: string;
}

export interface DatasetMeta {
  fetched_at: string;
  channel_count: number;
  video_count: number;
  quota_used: QuotaUsed;
  model_status: ModelStatus;
  vision_coverage: CoverageStat;
  decision_coverage: CoverageStat;
  age_bias_validation: AgeBiasValidation;
  data_sources: DataSource[];
  architecture_layers: ArchitectureLayer[];
}

export interface SeasonCoef {
  coefs: number[];
  insufficient_sample: boolean;
  sample_size: number;
}

export interface CalibrationBin {
  bin_lo: number;
  bin_hi: number;
  n: number;
  mean_predicted: number | null;
  observed_frequency: number | null;
}

export interface Calibration {
  brier_score: number;
  target_coverage: number;
  actual_coverage: number | null;
  n_calibration_rows: number;
  calibration_curve: CalibrationBin[];
}

export interface LabelThreshold {
  threshold_used: number;
  positive_rate: number;
  relaxed: boolean;
  positive_rate_at_default_threshold?: number;
}

export interface FeatureImportanceEntry {
  feature: string;
  importance: number; // % of total gain, within one head
}

export interface FeatureImportance {
  ranker: FeatureImportanceEntry[];
  regressor: FeatureImportanceEntry[];
  method: string; // human-readable caveat about what this is (and isn't)
}

export interface PermutationImportance {
  ranker: FeatureImportanceEntry[];
  regressor: FeatureImportanceEntry[];
  method: string;
  n_eval_rows: number;
}

export interface PotentialModel {
  method: "dual_head_gbdt" | "heuristic";
  training_sample_count: number;
  positive_label_rate: number | null;
  label_threshold: LabelThreshold;
  grade_cuts: number[] | null;
  calibration: Calibration | null;
  feature_importance: FeatureImportance | null;
  permutation_importance: PermutationImportance | null;
}

export interface TopKResult {
  baseline_hit_rate: number;
  model_hit_rate: number;
  lift: number | null;
  scored_n: number;
}

export interface BacktestTier {
  tier: string; // "global" | "1K-10K" | "10K-50K" | "50K-200K" | "200K-1M" | "1M+"
  n_candidates: number;
  n_positive: number;
  insufficient_sample: boolean;
  per_k: Record<"10" | "20" | "50" | "100", TopKResult>;
}

export interface Backtest {
  primary_k: number;
  k_values: number[];
  tiers: BacktestTier[]; // tiers[0] is always "global"
  excluded_below_1k_count: number;
}

export interface FeatureWeight {
  dims: string[];
  weight: number;
  note?: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  vector: number[];
  feature_weights: Record<string, FeatureWeight>;
}

export interface CreatorVideo {
  video_id: string;
  title: string;
  published_at: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  duration_seconds: number;
  thumbnail_url: string;
  age_days: number;
  age_bucket: "0-7" | "7-30" | "30-90" | "90-365" | "365+";
  relative_velocity: number | null;
  season_adjusted_velocity: number | null;
}

export interface CreatorFeatures {
  publish_cadence_30d: number;
  publish_cadence_90d: number;
  publish_interval_mean_days: number | null;
  publish_interval_std_days: number | null;
  recent_relative_velocity_mean: number | null;
  engagement_like_ratio: number;
  engagement_comment_ratio: number;
  engagement_trend: number | null;
  momentum_acceleration: number | null;
  inflection_point: string | null;
  raw_momentum: number | null;
  subscriber_view_ratio: number | null;
  video_count_with_velocity: number;
  adjusted_momentum: number | null;
}

export interface CreatorVision {
  sport_types: string[];
  camera_perspective: string;
  stabilization_demand: number;
  motion_complexity: number;
  scene_extremity: number;
  gear_visibility: number;
  narrative_pace: string;
  scene_diversity: number;
  content_vector: number[];
  evidence: string;
  model: string;
  source_video_ids: string[];
  analyzed_at: string;
  // pipeline/translate_content.py output. sport_types/evidence are free-text
  // LLM output (not a fixed vocabulary like camera_perspective/narrative_pace,
  // which the frontend translates via dictionary lookup), so they need a real
  // translation on disk — null/undefined means "not translated yet", not
  // "nothing to translate".
  sport_types_en?: string[] | null;
  evidence_en?: string | null;
}

export interface PotentialScore {
  value: number;
  value_lo?: number;
  value_hi?: number;
  rank_score?: number;
  method: "dual_head_gbdt" | "heuristic";
}

export interface ResonanceContribution {
  dim: string;
  contribution: number;
}

export interface ResonanceScore {
  value: number;
  contributions: ResonanceContribution[];
  feature_breakdown: Record<string, number>;
}

export interface CreatorScores {
  potential: PotentialScore;
  resonance: Record<string, ResonanceScore>; // keyed by product id
}

export interface CreativeVariant {
  variant_name: string;
  script_direction: string;
  subtitle_highlights: string[];
  target_platform_note: string;
  target_market: string;
  // Absent on decisions built before pipeline/translate_variants.py existed;
  // treat missing as "zh" (the original, pre-translation generation).
  language?: "zh" | "en";
}

export interface RiskReview {
  competitor_flag: boolean;
  flagged_keywords: string[];
  conclusion: string;
  // pipeline/translate_content.py; null/undefined = not translated yet.
  conclusion_en?: string | null;
}

export interface PriceRange {
  min: number | null;
  max: number | null;
  currency: string;
  basis: string;
  // pipeline/translate_content.py; null/undefined = not translated yet.
  basis_en?: string | null;
}

export interface CreatorDecision {
  recommended_product: string;
  potential_score: number;
  resonance_score: number;
  combined_score: number;
  reasoning: string;
  creative_variants: CreativeVariant[];
  price_range: PriceRange;
  risk_review: RiskReview;
  localization_notes: string;
  // pipeline/translate_content.py output — free-text LLM output, needs a
  // real translation on disk. null/undefined = not translated yet.
  reasoning_en?: string | null;
  localization_notes_en?: string | null;
}

export interface ScriptEvidence {
  video_title: string;
  vision_evidence_quote: string;
  top_feature_breakdown_dim: string;
}

export interface CreatorScript {
  platform: "tiktok_vertical" | "youtube_horizontal";
  language: "zh" | "en";
  hook: string;
  storyboard_beats: string[];
  voiceover_points: string[];
  caption_copy: string;
  cta_placement: string;
  referenced_evidence: ScriptEvidence;
  model: string;
}

export type CreatorMarket =
  | "north_america_europe"
  | "greater_china"
  | "japan"
  | "korea"
  | "other"
  | "unknown";

export type CreatorLanguage = "en" | "zh" | "ja" | "ko" | "unknown";

export interface Creator {
  channel_id: string;
  channel_url: string;
  title: string;
  country: string | null;
  market: CreatorMarket;
  language: CreatorLanguage;
  subscriber_count: number;
  view_count_total: number;
  video_count_total: number;
  channel_age_days: number;
  vertical: string;
  thumbnails: string[];
  videos: CreatorVideo[];
  features: CreatorFeatures;
  vision: CreatorVision | null;
  scores: CreatorScores;
  decision: CreatorDecision | null;
  scripts: CreatorScript[] | null;
}

export interface ChannelSplit {
  main_pool: number;
  auxiliary_holdout: number;
}

export interface Dataset {
  meta: DatasetMeta;
  season_coefs: Record<string, SeasonCoef>;
  channel_split: ChannelSplit;
  potential_model: PotentialModel;
  backtest: Backtest;
  products: Product[];
  creators: Creator[];
}
