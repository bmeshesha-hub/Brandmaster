# Brandmaster Supabase setup

1. In Supabase, open **SQL Editor**, paste `migrations/202607150001_brandmaster_access.sql`, and run it. The migration approves `bmeshesha` as the first administrator.
2. Open **Authentication → Providers → New Provider → Manual configuration**.
3. Use identifier `custom:github-enterprise` with:
   - Authorization URL: `https://github.corp.ebay.com/login/oauth/authorize`
   - Token URL: `https://github.corp.ebay.com/login/oauth/access_token`
   - User Info URL: `https://github.corp.ebay.com/api/v3/user`
   - Scopes: `read:user user:email`
4. Copy the Supabase provider callback URL into the Corporate GitHub App `brandmaster-sync` callback setting. Put that app's Client ID and newly generated Client Secret in the Supabase provider form.
5. Under **Authentication → URL Configuration**, set the production Vercel URL as Site URL and add it to Redirect URLs. Add `http://localhost:3000/**` for local hosted-auth testing only.
6. Confirm Vercel has `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, then redeploy. To use public GitHub instead, set `NEXT_PUBLIC_SUPABASE_GITHUB_PROVIDER=github`; otherwise the app defaults to Corporate GitHub.

To approve another user, an administrator can initially use the SQL editor:

```sql
insert into public.brandmaster_allowed_users (github_login, role, added_by)
values ('their-github-login', 'reviewer', 'bmeshesha')
on conflict (github_login) do update set role = excluded.role, active = true;
```

Never expose `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, a database password, or a Corporate GitHub Client Secret through a `NEXT_PUBLIC_` variable.
