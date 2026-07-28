export interface Outcome {
  actualViews: number;
  engagementRate: number;
  ignited: boolean;
  note: string;
  updatedAt: string;
}

export const OUTCOME_EVENT = "outcome:changed";

function keyFor(channelId: string, productId: string) {
  return `outcome:${channelId}:${productId}`;
}

export function getOutcome(channelId: string, productId: string): Outcome | null {
  try {
    const raw = localStorage.getItem(keyFor(channelId, productId));
    return raw ? (JSON.parse(raw) as Outcome) : null;
  } catch {
    return null;
  }
}

export function saveOutcome(channelId: string, productId: string, outcome: Omit<Outcome, "updatedAt">) {
  const value: Outcome = { ...outcome, updatedAt: new Date().toISOString() };
  localStorage.setItem(keyFor(channelId, productId), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(OUTCOME_EVENT));
}

export function getFlywheelCount(): number {
  let count = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("outcome:")) count++;
  }
  return count;
}
