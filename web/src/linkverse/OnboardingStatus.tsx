import type { CategoryDef } from "./categories";
import type { Dataset } from "./useData";

export default function OnboardingStatus({
  category,
  sampleData,
  error,
}: {
  category: CategoryDef;
  sampleData: Dataset | null;
  error: string | null;
}) {
  return (
    <div className="min-h-[60vh] grid place-items-center px-6">
      <div className="max-w-md text-center">
        <div className="text-[11px] uppercase tracking-[0.18em] text-accent font-semibold mb-3">
          {category.label}
        </div>
        <h1 className="font-display font-bold text-ink text-2xl mb-3">
          This category is onboarding
        </h1>
        <p className="text-sm text-muted leading-relaxed">
          Real creator data for {category.label.toLowerCase()} isn't live yet. Once it's dropped
          into <code className="num text-ink">public/{category.dataPath}</code>, this category
          switches on automatically.
        </p>

        {sampleData && !error ? (
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-line bg-paper/60 px-4 py-2">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-accent bg-accent/10 rounded-full px-2 py-0.5">
              Sample
            </span>
            <span className="text-xs text-muted">
              {sampleData.creators.length} placeholder creator{sampleData.creators.length === 1 ? "" : "s"} loaded — structure only, not real rankings.
            </span>
          </div>
        ) : (
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-line bg-paper/60 px-4 py-2">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted bg-line/60 rounded-full px-2 py-0.5">
              Sample
            </span>
            <span className="text-xs text-muted">Structure ready — waiting on data.</span>
          </div>
        )}
      </div>
    </div>
  );
}
