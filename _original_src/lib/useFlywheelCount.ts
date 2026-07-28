import { useEffect, useState } from "react";
import { getFlywheelCount, OUTCOME_EVENT } from "./outcomeStore";

export function useFlywheelCount() {
  const [count, setCount] = useState(() => getFlywheelCount());

  useEffect(() => {
    const onChange = () => setCount(getFlywheelCount());
    window.addEventListener(OUTCOME_EVENT, onChange);
    return () => window.removeEventListener(OUTCOME_EVENT, onChange);
  }, []);

  return count;
}
