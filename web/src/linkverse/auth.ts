// Email/password auth via Supabase. Kept intentionally small: this app has one
// thing that needs an account (the tracked-creators pipeline surviving a
// device change), not a user-management product.
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export type AuthState = {
  user: User | null;
  /** True until the initial session check resolves — lets callers avoid a
   *  flash of "signed out" UI before Supabase has answered. */
  loading: boolean;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, loading: supabase !== null });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setState({ user: data.session?.user ?? null, loading: false });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setState({ user: session?.user ?? null, loading: false });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export async function signInWithPassword(email: string, password: string): Promise<string | null> {
  if (!supabase) return "Accounts are not configured for this deployment.";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error?.message ?? null;
}

export async function signUpWithPassword(email: string, password: string): Promise<string | null> {
  if (!supabase) return "Accounts are not configured for this deployment.";
  const { error } = await supabase.auth.signUp({ email, password });
  return error?.message ?? null;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}
