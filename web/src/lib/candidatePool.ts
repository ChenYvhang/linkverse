const POOL_KEY = "candidatePool";
const BUDGET_KEY = "campaign:budgetCap";
export const POOL_EVENT = "candidatePool:changed";

export function getCandidatePool(): string[] {
  try {
    const raw = localStorage.getItem(POOL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writePool(ids: string[]) {
  localStorage.setItem(POOL_KEY, JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent(POOL_EVENT));
}

export function addToCandidatePool(channelIds: string[]) {
  const current = new Set(getCandidatePool());
  channelIds.forEach((id) => current.add(id));
  writePool([...current]);
}

export function removeFromCandidatePool(channelId: string) {
  writePool(getCandidatePool().filter((id) => id !== channelId));
}

export function clearCandidatePool() {
  writePool([]);
}

export function isInCandidatePool(channelId: string): boolean {
  return getCandidatePool().includes(channelId);
}

export function getBudgetCap(): number | undefined {
  const raw = localStorage.getItem(BUDGET_KEY);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function setBudgetCap(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) {
    localStorage.removeItem(BUDGET_KEY);
  } else {
    localStorage.setItem(BUDGET_KEY, String(value));
  }
  window.dispatchEvent(new CustomEvent(POOL_EVENT));
}
