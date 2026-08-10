// Single Supabase client for the app. Auth and the feedback layer's cloud sync
// both go through this.
//
// Both env vars are VITE_-prefixed on purpose: the anon key is meant to be
// public (see supabase/README.md) — protection comes from the Row Level
// Security policies in supabase/schema.sql, not from hiding this key. The
// service_role key must NEVER be given this prefix or appear in this file: it
// bypasses RLS entirely, and anything VITE_ is inlined into the shipped bundle.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

/** False when no project is configured — accounts and cloud sync stay off and
 *  the app runs entirely on localStorage, same as before this existed. */
export const isSupabaseConfigured = supabase !== null;
