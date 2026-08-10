# Supabase setup

Accounts and outcome storage for the feedback layer. Until this is configured
the app falls back to `localStorage`, which works but does not survive a change
of device — the reason for adding it.

## What you do

1. Create a project at <https://supabase.com/dashboard> (free tier is enough).
2. **SQL Editor → New query** → paste `schema.sql` from this directory → Run.
   It creates one table and its Row Level Security policies.
3. **Authentication → Sign In / Providers** → keep **Email** enabled. If you want
   "magic link only", turn off *Confirm password* there; otherwise the default
   email + password flow is fine.
4. **Project Settings → API** → copy three values:

   | Value | Where it goes | Secret? |
   |---|---|---|
   | Project URL | `VITE_SUPABASE_URL` | no — ships in the bundle |
   | `anon` public key | `VITE_SUPABASE_ANON_KEY` | no — ships in the bundle, RLS is what protects the data |
   | `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` | **yes — server only, never in the frontend** |

The `anon` key being public is by design: it can only do what RLS allows, which
is "read and write your own rows once signed in". The `service_role` key
bypasses RLS entirely, so it must never appear in client code or in a `VITE_`
variable — anything prefixed `VITE_` is inlined into the JavaScript bundle and
is therefore public.

## Where the values go

Local (`web/.env.local`, gitignored):

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Vercel (Project → Settings → Environment Variables, all three environments):
the same two, plus `SUPABASE_SERVICE_ROLE_KEY` if a server-side function ever
needs to bypass RLS. Nothing today does — the client talks to Supabase directly
with the anon key, and RLS scopes it.

## Data model

One row per (user, category, creator):

```
user_id  uuid     -> auth.users
category text     -> action_camera | sunscreen | supplement
creator_id text   -> YouTube channel id
stage    text     -> tracked | contacted | replied | signed | declined
note     text
updated_at timestamptz  (set by trigger, not by the client)
```

`updated_at` is written by a database trigger rather than trusted from the
client, because "when did this last change" is what a stale-pipeline view
depends on.
