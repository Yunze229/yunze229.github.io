# yunze-cms-auth Worker — Design (Phase A)

> The OAuth Worker behind `auth.duyunze.com`. Two unrelated jobs:
>
> 1. **Sveltia CMS OAuth bridge** — the original purpose. `/admin/` login → GitHub OAuth → window.opener postMessage. Unchanged. **Do not break.**
> 2. **Site-wide sign-in** — NEW (this design). Gives whitelisted family members an HttpOnly cookie that the main site + capsule worker recognize, so capsule submit / comments / voice can require login.

## Endpoint inventory

| Path | Method | Purpose | Who calls it |
|---|---|---|---|
| `/auth` | GET | **[Legacy]** Kick off Sveltia OAuth | `/admin/` login button |
| `/callback` | GET | **[Shared]** Sveltia OR site GitHub callback (dispatched by cookie) | GitHub OAuth redirect |
| `/login` | GET | Sign-in chooser HTML page (GitHub or Google) | duyunze.com header button |
| `/login/github` | GET | Kick off GitHub OAuth (site flow) | login chooser |
| `/login/google` | GET | Kick off Google OAuth | login chooser |
| `/callback/google` | GET | Site Google callback → set cookie + redirect | Google OAuth redirect |
| `/logout` | GET | Clear cookie + redirect | duyunze.com header button |
| `/me` | GET | JSON `{provider, id, name, email}` or 401 | duyunze.com JS (CORS) |

## Cookie

```
Set-Cookie: yunze_session=<uuid>;
            Domain=.duyunze.com;       # subdomain-shared
            Path=/;
            Max-Age=2592000;            # 30 days
            HttpOnly;                   # JS cannot read
            Secure;                     # HTTPS only
            SameSite=Lax
```

Worker validates by `KV.get('session:' + value)`.

## KV schema (binding `ALLOWLIST` → namespace `RATE_LIMIT`)

```
allow:github:<login_lowercase>      → {"name":"Yunze","role":"owner","added":"2026-05-26"}
allow:google:<email_lowercase>      → {"name":"妈妈","role":"family","added":"2026-05-26"}
session:<uuid-v4>                   → {"provider":"github","id":"Yunze229","name":"Yunze","email":"...","exp":<unix>}
                                       TTL 30d (auto-expire via KV expirationTtl)
```

`name` from the allowlist entry **overrides** what GitHub/Google reports — so capsule submit can show "妈妈" as `from:` even when login is `hxz49`.

`role` field reserved for future use (e.g., capsule worker treats `role:owner` differently from `role:family`).

## Required Worker secrets

| Secret | Source | Used by |
|---|---|---|
| `GITHUB_CLIENT_SECRET` | **existing** — GitHub OAuth App `Ov23libVHZUemiraJHc7` | legacy `/callback` (Sveltia) |
| `SITE_GITHUB_CLIENT_SECRET` | **NEW** — same GitHub OAuth App, or a new one for site auth | `/callback/github` |
| `GOOGLE_CLIENT_ID` | **NEW** — from Google Cloud Console | `/login/google` (public, but easier as env) |
| `GOOGLE_CLIENT_SECRET` | **NEW** — from Google Cloud Console | `/callback/google` |
| `ALLOWED_RETURN_HOSTS` | **NEW** — comma-separated `duyunze.com,www.duyunze.com,yunze229.github.io` | open-redirect protection |

Setting:
```bash
wrangler secret put GOOGLE_CLIENT_SECRET --name yunze-cms-auth
# paste value, hit enter
```

Or in CF dashboard → Workers → yunze-cms-auth → Settings → Variables and Secrets.

## GitHub OAuth App configuration

The existing GitHub OAuth App (Client ID `Ov23libVHZUemiraJHc7`, name "Yunze Blog CMS") **needs no change**. GitHub OAuth Apps allow only one callback URL (multiple URLs are a GitHub Apps feature). To work within that, this worker shares `/callback` between both flows and dispatches on cookie presence:

- `/login/github` sets a short-lived `yunze_oauth_state` cookie before redirecting to GitHub
- `/callback` checks for that cookie:
  - **Cookie present** → site sign-in flow (verify state, exchange code, set session cookie)
  - **Cookie absent** → legacy Sveltia flow (exchange code, postMessage back to /admin/)

The same `client_id` + `client_secret` are reused for both flows. Different `scope` requested per flow:
- Legacy `/auth` → `scope=repo,user` (Sveltia needs repo write)
- New `/login/github` → `scope=read:user user:email` (site auth only needs identity)

> ⚠️ Subtle interaction: if a user starts a site login (sets the state cookie), abandons it, and within 10 minutes tries to log into /admin/ via the Sveltia flow, the stale state cookie would route them to the wrong branch. State verification will fail (the new GitHub callback has no matching code+state), and they'll be bounced to `/login?err=state_mismatch`. They retry, the cookie is cleared on the error redirect, and the next /admin/ attempt works. Acceptable.

## Google OAuth App configuration

In Google Cloud Console → APIs & Services → Credentials → Create OAuth Client ID:
- Application type: Web application
- Name: `duyunze.com auth`
- Authorized redirect URI: `https://auth.duyunze.com/callback/google`
- After create, copy Client ID + Client Secret

Scopes requested by worker: `openid profile email` (standard OIDC trio).

## Session validation flow (for other workers / Hugo JS)

**Frontend (Hugo header partial):**
```js
fetch('https://auth.duyunze.com/me', { credentials: 'include' })
  .then(r => r.ok ? r.json() : null)
  .then(user => {
    if (user) {
      btn.textContent = user.name;
      btn.onclick = () => location.href = 'https://auth.duyunze.com/logout?next=' + encodeURIComponent(location.href);
    } else {
      btn.textContent = 'Sign in';
      btn.onclick = () => location.href = 'https://auth.duyunze.com/login?next=' + encodeURIComponent(location.href);
    }
  });
```

**Capsule worker (Phase B) — server-side verify:**
```js
// In capsule-worker request handler:
async function verifySession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)yunze_session=([^;]+)/);
  if (!m) return null;
  const raw = await env.ALLOWLIST.get('session:' + m[1]);
  if (!raw) return null;
  const sess = JSON.parse(raw);
  if (sess.exp < Math.floor(Date.now() / 1000)) return null;
  return sess; // {provider, id, name, email}
}
```

The capsule worker needs the same KV binding added: in `wrangler.toml`, point `ALLOWLIST` at the same namespace id `e7b601c5751b41d4afe7e2bab4360f17`. (Capsule worker already has `RATE_LIMIT` bound to that namespace — adding a second binding name to the same id is fine.)

## CORS

`/me` and `/logout` are called from `https://duyunze.com` JS with `credentials: 'include'`. Worker responds with:
```
Access-Control-Allow-Origin: https://duyunze.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

The allowed-origin list mirrors `ALLOWED_RETURN_HOSTS` to handle `www.` and the legacy `yunze229.github.io`.

## State / CSRF on OAuth flow

The `state` parameter sent to GitHub/Google includes the `next` URL (URL-encoded), validated on return against `ALLOWED_RETURN_HOSTS`. This prevents an attacker crafting a `next=https://evil.com` from a phishing email — the callback rejects unknown hosts.

State integrity: signed with HMAC-SHA256 using `GITHUB_CLIENT_SECRET` (any worker secret works as a signing key here). State expires 10 minutes after issuance.

## Error pages

- **Not on allowlist**: friendly HTML "This site is invite-only. Ask mom (hxz49@hotmail.com)." with a link back to `/`.
- **OAuth error from provider** (user denied, network failure): generic HTML "Something went wrong. Try again or reach out."
- **Invalid state / expired**: redirect back to `/login` with `?err=expired`.

## What this design does NOT do

- No registration flow. Allowlist is manually curated via `wrangler kv put`.
- No password / 2FA — fully delegated to GitHub / Google.
- No account-linking (a user logging in via both providers gets two separate session entries with the same `name`).
- No CSRF token on state-changing endpoints (none exist in this Worker — all GETs are read or redirect).

## Deploy checklist (one-time)

- [ ] GitHub OAuth App: add callback URL `https://auth.duyunze.com/callback/github`
- [ ] Google Cloud Console: create OAuth client, redirect `https://auth.duyunze.com/callback/google`
- [ ] `wrangler secret put SITE_GITHUB_CLIENT_SECRET` (reuse existing GitHub secret, or new)
- [ ] `wrangler secret put GOOGLE_CLIENT_ID`
- [ ] `wrangler secret put GOOGLE_CLIENT_SECRET`
- [ ] `wrangler secret put ALLOWED_RETURN_HOSTS` (`duyunze.com,www.duyunze.com,yunze229.github.io`)
- [ ] `wrangler kv key put --binding ALLOWLIST 'allow:github:Yunze229' '{"name":"Yunze","role":"owner"}'`
- [ ] `wrangler kv key put --binding ALLOWLIST 'allow:github:hxz49' '{"name":"妈妈","role":"family"}'`
- [ ] `wrangler deploy` from `static/cms-auth-worker/`
- [ ] Smoke test: visit `https://auth.duyunze.com/login` → both buttons → both flows complete → cookie set → `/me` returns JSON

## What ships in Phase A vs later

**Phase A (this design)**: cms-auth Worker itself + login chooser + cookie issuance + `/me`.

**Phase A.4 (next)**: Hugo header partial updated to show Sign in / Hi, Name + Sign out button.

**Phase B**: capsule worker reads `yunze_session` cookie + KV `ALLOWLIST`, gates `/submit`. Form removes `sender` input.

**Phase C**: giscus script load-gated on cookie presence. "GitHub 讨论" link added to article footer linking to `Yunze229/blog-feedback` issue form.

**Phase D**: capsule worker `/voice/*` endpoints stop reading `ALLOWED_VOICE_LOGINS` hardcoded constant, use `KV.get('allow:github:' + login)` instead.
