import { useEffect, useState } from "react";
import type { Dataset } from "./schema";

interface DatasetState {
  data: Dataset | null;
  loading: boolean;
  error: string | null;
}

let cache: Dataset | null = null;
let inflight: Promise<Dataset> | null = null;

function loadDataset(): Promise<Dataset> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch(`${import.meta.env.BASE_URL}dataset.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`dataset.json HTTP ${res.status}`);
        return res.json();
      })
      .then((json: Dataset) => {
        cache = json;
        return json;
      });
  }
  return inflight;
}

export function useDataset(): DatasetState {
  const [state, setState] = useState<DatasetState>({
    data: cache,
    loading: !cache,
    error: null,
  });

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    loadDataset()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
