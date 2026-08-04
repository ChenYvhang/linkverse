import type { CategoryDef, CategoryId } from "./categories";

export default function CategoryTabs({
  categories,
  selected,
  onSelect,
}: {
  categories: CategoryDef[];
  selected: CategoryId;
  onSelect: (id: CategoryId) => void;
}) {
  return (
    <div className="border-t border-line bg-surface/80 backdrop-blur">
      <div className="max-w-6xl mx-auto px-6 h-11 flex items-center gap-2 overflow-x-auto">
        {categories.map((c) => {
          const active = c.id === selected;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full
                transition-colors ${
                  active
                    ? "bg-ink text-white"
                    : "text-muted hover:text-ink hover:bg-paper border border-line"
                }`}
            >
              {c.label}
              {c.status === "onboarding" && (
                <span
                  className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                    active ? "bg-white/20 text-white" : "bg-accent/10 text-accent"
                  }`}
                >
                  Onboarding
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
