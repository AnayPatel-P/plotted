# Setting up accounts (Google sign-in + plan sync)

Plotted works fully without this; accounts only add "sign in to sync across devices".
You create the accounts and keys below; nothing secret is committed to the repo.

## 1. Create the Supabase project (≈5 min)

1. Go to <https://supabase.com/dashboard> → **New project**. Name it `plotted`, pick a region near Texas (e.g. `us-east-1` or `us-central`), and set a strong database password (keep it in your password manager).
2. Link this repo and push the database schema:

   ```bash
   npx supabase login
   ```

   ```bash
   npx supabase link --project-ref <your-project-ref>
   ```

   ```bash
   npx supabase db push
   ```

   `db push` applies `supabase/migrations/*` (the `plans` table and its row-level security).

## 2. Create the Google OAuth client (≈10 min)

1. <https://console.cloud.google.com/> → create (or pick) a project → **APIs & Services → OAuth consent screen**: External, app name "Plotted", your support email, scopes `email`, `profile`, `openid`.
2. **Credentials → Create credentials → OAuth client ID** → type **Web application**.
   - Authorized JavaScript origins: `http://localhost:3000` and your production URL later.
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Copy the **Client ID** and **Client secret**.

## 3. Turn on Google in Supabase

Supabase dashboard → **Authentication → Sign In / Providers → Google** → enable, paste the Client ID and secret, save.

Then **Authentication → URL Configuration**:
- Site URL: `http://localhost:3000` for now (your production URL once deployed).
- Redirect URLs: add `http://localhost:3000/**` (and `https://<your-domain>/**` later).

## 4. Point the app at the project

Supabase dashboard → **Project Settings → API**: copy the Project URL and the **publishable** key (never the secret/service-role key). Put them in `web/.env.local` (git-ignored):

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Restart `npm run dev`. A **Sign in to sync** button appears on plan pages.

## Local development (no Google needed)

```bash
npm run db:start
```

```bash
npm run test:rls
```

`db:start` runs Postgres + Auth in Docker with the same migrations; `test:rls` checks that users can't see or change each other's plans. Fill `web/.env.local` from `npx supabase status` to run the app against the local stack. Google sign-in is off locally unless you add credentials to `supabase/.env` and set `enabled = true` under `[auth.external.google]` in `supabase/config.toml`.

## How sync behaves

- Signed out: the plan is saved in the browser only.
- First sign-in on a device: if this browser's plan is untouched and the account already has a plan, the account plan loads; if both have changes, **both are kept** as separate plans (Plan menu → Your plans).
- Signed in: every change saves to the account (and to the browser as a backup). Students can keep several plans per major (save a copy, rename, delete).
- Sign out removes plans from that browser; they stay in the account.
