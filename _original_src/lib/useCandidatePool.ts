import { useEffect, useState } from "react";
import { getBudgetCap, getCandidatePool, POOL_EVENT } from "./candidatePool";

export function useCandidatePool() {
  const [ids, setIds] = useState<string[]>(() => getCandidatePool());
  const [budgetCap, setBudgetCapState] = useState<number | undefined>(() => getBudgetCap());

  useEffect(() => {
    const onChange = () => {
      setIds(getCandidatePool());
      setBudgetCapState(getBudgetCap());
    };
    window.addEventListener(POOL_EVENT, onChange);
    return () => window.removeEventListener(POOL_EVENT, onChange);
  }, []);

  return { ids, budgetCap };
}
