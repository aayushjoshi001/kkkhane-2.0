# KKKhane 2.0 — Complete Migration & Disconnection Guide

This guide outlines step-by-step instructions to completely separate this repository from the old Vercel account, old Supabase database, old GitHub repository, and old domain (`kkkhane.com`).

---

## 1. Disconnect & Link to Your Own GitHub Repository

Disconnect from the original GitHub repository and point to a fresh repository under your own GitHub account:

```bash
# 1. Open terminal in project folder:
cd "/Users/aayushjoshi/kkkhane 2.0"

# 2. Remove the old remote repository link:
git remote remove origin

# 3. Create a new empty repository on https://github.com/new and link it:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_NEW_REPO_NAME.git

# 4. Rename default branch to main and push your code:
git branch -M main
git push -u origin main
```

---

## 2. Create Your Own Supabase Database

1. Sign up / Log in to [supabase.com](https://supabase.com) and create a **New Project** under your own account.
2. Note your **Project Reference ID** (found in Project Settings → General).
3. Link your local project and run migrations to create all database tables and schema:
   ```bash
   npx supabase link --project-ref YOUR_NEW_PROJECT_REF
   npm run db:push
   ```
4. Copy your new API keys from **Supabase Settings → API**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

---

## 3. Deploy to Your Own Vercel Account

1. Log in to [vercel.com](https://vercel.com).
2. Click **Add New... → Project**.
3. Import your **new GitHub repository** created in Step 1.
4. Add the following **Environment Variables** in Vercel:

| Variable Name | Value Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your new Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your new Supabase Anon Public Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Your new Supabase Service Role Secret Key |
| `NEXT_PUBLIC_APP_URL` | `https://your-new-domain.com` (or Vercel URL) |
| `CRON_SECRET` | Generate random 32-char string (`openssl rand -hex 32`) |
| `REVALIDATE_SECRET` | Generate random 32-char string |
| `SRMS_API_KEY` | Generate random 32-char string |

5. Click **Deploy**.

---

## 4. Attach Your Custom Domain

1. In your new Vercel project dashboard, navigate to **Settings → Domains**.
2. Add your custom domain (e.g., `mynewdomain.com`).
3. Update DNS settings at your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.):
   - **A Record**: Point `@` to Vercel's IP `76.76.21.21`
   - **CNAME Record**: Point `www` to `cname.vercel-dns.com`
4. Update `NEXT_PUBLIC_APP_URL` in Vercel Environment Variables to match your new domain.

---

## 5. Update Local Environment (`.env.local`)

Update your local `.env.local` file located at `/Users/aayushjoshi/kkkhane 2.0/.env.local`:

```env
# --- Supabase (Your New Project) ---
NEXT_PUBLIC_SUPABASE_URL=https://your-new-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_new_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_new_service_role_key

# --- App Origin ---
NEXT_PUBLIC_APP_URL=http://localhost:3000

# --- Local Development Options ---
SHOW_DEMO_ACCOUNTS=true
```

---

## Verification Checklist

- [ ] `git remote -v` points to your personal GitHub repository.
- [ ] Supabase migrations applied via `npm run db:push`.
- [ ] Vercel project linked to your GitHub repo and building cleanly.
- [ ] Custom domain SSL certificate active on Vercel.
- [ ] App resolves to your custom domain without any references to `kkkhane.com`.
