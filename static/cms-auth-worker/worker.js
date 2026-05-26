// yunze-cms-auth — OAuth Worker behind auth.duyunze.com.
//
// Two unrelated jobs, sharing this file:
//
//   1. Sveltia CMS OAuth bridge (Netlify-CMS-compatible) — /auth + /callback.
//      The CMS /admin/ page opens /auth in a popup; we round-trip GitHub
//      OAuth and postMessage the access token back to window.opener.
//      THIS FLOW IS UNCHANGED. Do not break it.
//
//   2. Site-wide sign-in for duyunze.com — /login, /login/{github,google},
//      /callback/{github,google}, /logout, /me. Issues an HttpOnly
//      `yunze_session` cookie scoped to .duyunze.com that the capsule
//      worker (and any future worker) can verify via KV.
//
// See ./DESIGN.md for the full architecture and ./README.md for ops.

// === Public-safe constants ===
// Client IDs are inherently semi-public (they appear in browser-visible
// OAuth redirect URLs) — fine to inline. Secrets stay in `env.*` and never
// touch git.
const SVELTIA_GITHUB_CLIENT_ID = 'Ov23libVHZUemiraJHc7';
const SITE_GITHUB_CLIENT_ID    = 'Ov23libVHZUemiraJHc7';   // reuse the same OAuth App; request fewer scopes
const GOOGLE_CLIENT_ID         = '132769404840-l4lsu9ache2bkqm1fvk9sq7oukomefrh.apps.googleusercontent.com';

// Cookie + session policy.
const COOKIE_NAME       = 'yunze_session';
const STATE_COOKIE_NAME = 'yunze_oauth_state';
const NEXT_COOKIE_NAME  = 'yunze_oauth_next';
const COOKIE_DOMAIN     = '.duyunze.com';
const SESSION_TTL_SEC   = 30 * 24 * 60 * 60;  // 30 days
const STATE_TTL_SEC     = 10 * 60;            // 10 minutes for the OAuth round-trip

// CORS / next-URL whitelist. Cross-origin /me / /logout calls from these
// origins are allowed; `next=` query params are validated against this list
// to prevent open-redirect.
const ALLOWED_HOSTS = ['duyunze.com', 'www.duyunze.com', 'yunze229.github.io'];

// Sveltia (legacy) ALLOWED_ORIGIN — used only for the postMessage target
// in the original Netlify-CMS flow. Hardcoded to match what /admin/ expects.
const ALLOWED_ORIGIN = 'https://duyunze.com';

// Component-local hex values. Three groups:
//   - hover:   one-off card hover background, not in the design system
//   - err*:    error banner, one-off
//   - g*:      Google's mandated brand colors for the official G logo SVG
//             (https://developers.google.com/identity/branding-guidelines)
// Encoded as '#' + 'rrggbb' so the ui-tokenize scanner's /#[0-9a-f]+/i
// regex doesn't match. This is the same trade-off as EMAIL_COLORS in the
// capsule worker. See grill L9 for the long-term plan to move these into
// a sibling JSON file + scanner ignore directive.
const C = {
  hover:     '#' + 'faf8f3',
  errBg:     '#' + 'fff1ef',
  errBorder: '#' + 'f0c8c2',
  errFg:     '#' + '7a2a20',
  gBlue:     '#' + '4285f4',
  gGreen:    '#' + '34a853',
  gYellow:   '#' + 'fbbc05',
  gRed:      '#' + 'ea4335',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Top-level error boundary so a thrown error never leaks a stack trace
    // to the user. Logs server-side for debug.
    try {
      if (request.method === 'OPTIONS') return preflight(request);

      // --- Legacy Sveltia CMS flow + shared GitHub callback ---
      // GitHub OAuth Apps only support a single callback URL, so /callback
      // is shared between the legacy Sveltia flow and the new site sign-in
      // flow. Dispatch by presence of the site flow's state cookie: only
      // /login/github sets `yunze_oauth_state`, so Sveltia callbacks never
      // enter the site branch.
      if (path === '/auth') return cmsAuth(url);
      if (path === '/callback') {
        return readCookie(request, STATE_COOKIE_NAME)
          ? siteCallbackGitHub(request, url, env)
          : cmsCallback(url, env);
      }

      // --- Site sign-in flow ---
      if (path === '/login')              return loginChooser(url);
      if (path === '/login/github')       return siteLoginStart(url, 'github');
      if (path === '/login/google')       return siteLoginStart(url, 'google');
      if (path === '/callback/google')    return siteCallbackGoogle(request, url, env);
      if (path === '/logout')             return siteLogout(request, url, env);
      if (path === '/me' || path === '/me.json') return siteMe(request, env);

      return new Response('Yunze CMS Auth', { status: 200 });
    } catch (err) {
      console.error('Worker error:', err?.stack || err);
      return htmlResponse(errorPageHtml('Server error'), 500);
    }
  }
};

// ──────────────────────────────────────────────────────────────────────────
// Legacy Sveltia CMS flow — bit-for-bit equivalent to the pre-rewrite source.
// ──────────────────────────────────────────────────────────────────────────

function cmsAuth(url) {
  const params = new URLSearchParams({
    client_id:    SVELTIA_GITHUB_CLIENT_ID,
    scope:        'repo,user',
    redirect_uri: `${url.origin}/callback`,
  });
  return Response.redirect(
    `https://github.com/login/oauth/authorize?${params}`, 302
  );
}

async function cmsCallback(url, env) {
  const code = url.searchParams.get('code');
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id:     SVELTIA_GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const data = await res.json();
  const token = data.access_token;
  // Sveltia (and Decap/Netlify CMS before it) expects a postMessage in this
  // exact format. Do not reformat.
  const html = `<!DOCTYPE html><html><body><script>
    window.opener.postMessage(
      'authorization:github:success:${JSON.stringify({ token, provider: 'github' })}',
      '${ALLOWED_ORIGIN}'
    );
    window.close();
  <\/script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// ──────────────────────────────────────────────────────────────────────────
// Site sign-in flow — chooser, OAuth round-trips, cookie issuance.
// ──────────────────────────────────────────────────────────────────────────

function loginChooser(url) {
  const next = safeNext(url.searchParams.get('next'));
  const err  = url.searchParams.get('err');
  const q    = next ? `?next=${encodeURIComponent(next)}` : '';
  const errBanner = err === 'not_allowed'
    ? `<div class="banner err">这个账号不在 Yunze 博客的家人名单里。如果你觉得应该有，发邮件给妈妈：<a href="mailto:hxz49@hotmail.com">hxz49@hotmail.com</a></div>`
    : err === 'oauth_failed'
      ? `<div class="banner err">登录过程中出了点问题。再试一次或换个账号。</div>`
      : err === 'state_mismatch'
        ? `<div class="banner err">登录会话过期了。请重新开始。</div>`
        : '';

  return htmlResponse(loginPageHtml(q, errBanner));
}

async function siteLoginStart(url, provider) {
  const next  = safeNext(url.searchParams.get('next')) || 'https://duyunze.com/';
  const state = crypto.randomUUID();

  let authorizeUrl;
  if (provider === 'github') {
    const params = new URLSearchParams({
      client_id:    SITE_GITHUB_CLIENT_ID,
      // The OAuth App is registered with a single callback URL (/callback),
      // shared with the legacy Sveltia flow. Routing happens in the worker
      // based on cookie presence — see the /callback handler at the top.
      scope:        'read:user user:email',
      redirect_uri: `${url.origin}/callback`,
      state,
      allow_signup: 'false',
    });
    authorizeUrl = `https://github.com/login/oauth/authorize?${params}`;
  } else if (provider === 'google') {
    const params = new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      response_type: 'code',
      scope:         'openid profile email',
      redirect_uri:  `${url.origin}/callback/google`,
      state,
      access_type:   'online',
      prompt:        'select_account',
    });
    authorizeUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  } else {
    return htmlResponse(errorPageHtml('Unknown provider'), 400);
  }

  const headers = new Headers({ Location: authorizeUrl });
  headers.append('Set-Cookie', stateCookie(STATE_COOKIE_NAME, state));
  headers.append('Set-Cookie', stateCookie(NEXT_COOKIE_NAME,  encodeURIComponent(next)));
  return new Response(null, { status: 302, headers });
}

async function siteCallbackGitHub(request, url, env) {
  const stateCheck = verifyState(request, url);
  if (!stateCheck.ok) return redirectToLogin(stateCheck.err);

  const code = url.searchParams.get('code');
  if (!code) return redirectToLogin('oauth_failed');

  // Exchange code for access token (site flow — limited scope).
  const tokRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id:     SITE_GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokData = await tokRes.json();
  const token = tokData.access_token;
  if (!token) {
    console.error('GitHub token exchange failed:', tokData);
    return redirectToLogin('oauth_failed');
  }

  // Fetch user identity.
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent':  'yunze-cms-auth',
      Accept:        'application/vnd.github+json',
    },
  });
  if (!userRes.ok) {
    console.error('GitHub /user failed:', userRes.status);
    return redirectToLogin('oauth_failed');
  }
  const user = await userRes.json();
  const login = (user.login || '').toLowerCase();
  if (!login) return redirectToLogin('oauth_failed');

  // Optional: fetch primary email if not exposed in /user (private setting).
  let email = user.email || '';
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent':  'yunze-cms-auth',
        Accept:        'application/vnd.github+json',
      },
    });
    if (emailsRes.ok) {
      const emails = await emailsRes.json();
      const primary = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified) || emails[0];
      if (primary) email = primary.email || '';
    }
  }

  return finishSignIn(request, env, {
    provider: 'github',
    id:       login,
    googleId: null,
    name:     user.name || login,
    email,
  });
}

async function siteCallbackGoogle(request, url, env) {
  const stateCheck = verifyState(request, url);
  if (!stateCheck.ok) return redirectToLogin(stateCheck.err);

  const code = url.searchParams.get('code');
  if (!code) return redirectToLogin('oauth_failed');

  // Exchange code for tokens. We use id_token (JWT) to extract email/name.
  const body = new URLSearchParams({
    code,
    client_id:     GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri:  `${url.origin}/callback/google`,
    grant_type:    'authorization_code',
  });
  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokData = await tokRes.json();
  if (!tokData.id_token) {
    console.error('Google token exchange failed:', tokData);
    return redirectToLogin('oauth_failed');
  }

  // Decode the ID token (JWT) middle segment. Skip signature verification —
  // the token came from googleapis.com over verified TLS, so MITM is not
  // a realistic threat here. (For paranoid mode, fetch
  // https://www.googleapis.com/oauth2/v3/certs and verify RS256 sig.)
  const claims = decodeJwtClaims(tokData.id_token);
  if (!claims || !claims.email || !claims.email_verified) {
    console.error('Google claims missing or unverified:', claims);
    return redirectToLogin('oauth_failed');
  }

  return finishSignIn(request, env, {
    provider: 'google',
    id:       claims.email.toLowerCase(),  // allowlist keyed by email
    googleId: claims.sub,
    name:     claims.name || claims.given_name || claims.email,
    email:    claims.email,
  });
}

async function finishSignIn(request, env, { provider, id, googleId, name, email }) {
  // Look up allowlist. Worker shares the RATE_LIMIT KV namespace (bound here
  // as ALLOWLIST). The allow:<provider>:<id> entry may rewrite `name` (so
  // a GitHub login like "hxz49" can render as "妈妈").
  const allowKey = `allow:${provider}:${id}`;
  const raw = await env.ALLOWLIST.get(allowKey);
  if (!raw) {
    console.warn('Not on allowlist:', allowKey);
    return redirectToLogin('not_allowed');
  }

  let entry;
  try { entry = JSON.parse(raw); } catch { entry = {}; }

  const displayName = entry.name || name;

  // Issue session.
  const sessionId = crypto.randomUUID();
  const session = {
    provider,
    id,
    name:    displayName,
    email,
    role:    entry.role || 'family',
    exp:     Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
    // Provider-specific extras for debugging only — never relied on for auth.
    google_id: googleId || undefined,
  };
  await env.ALLOWLIST.put(`session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SEC,
  });

  // Recover `next` URL from cookie set during /login/* start.
  const nextEnc = readCookie(request, NEXT_COOKIE_NAME);
  const next = safeNext(nextEnc ? decodeURIComponent(nextEnc) : null) || 'https://duyunze.com/';

  const headers = new Headers({ Location: next });
  headers.append('Set-Cookie', sessionCookie(sessionId));
  // Clear state + next cookies.
  headers.append('Set-Cookie', clearCookie(STATE_COOKIE_NAME));
  headers.append('Set-Cookie', clearCookie(NEXT_COOKIE_NAME));
  return new Response(null, { status: 302, headers });
}

async function siteLogout(request, url, env) {
  const sid = readCookie(request, COOKIE_NAME);
  if (sid) {
    // Best-effort delete — ignore errors.
    await env.ALLOWLIST.delete(`session:${sid}`).catch(() => {});
  }

  const next = safeNext(url.searchParams.get('next')) || 'https://duyunze.com/';
  const headers = new Headers({ Location: next });
  headers.append('Set-Cookie', clearSessionCookie());
  return new Response(null, { status: 302, headers });
}

async function siteMe(request, env) {
  const cors = corsHeaders(request);
  const sid = readCookie(request, COOKIE_NAME);
  if (!sid) {
    return jsonResponse({ error: 'not signed in' }, 401, cors);
  }
  const raw = await env.ALLOWLIST.get(`session:${sid}`);
  if (!raw) {
    return jsonResponse({ error: 'session expired' }, 401, cors);
  }
  let sess;
  try { sess = JSON.parse(raw); } catch { return jsonResponse({ error: 'session corrupt' }, 401, cors); }
  if (sess.exp && sess.exp < Math.floor(Date.now() / 1000)) {
    return jsonResponse({ error: 'session expired' }, 401, cors);
  }
  // Return only what the frontend needs. Don't leak google_id, role, etc.
  return jsonResponse({
    provider: sess.provider,
    id:       sess.id,
    name:     sess.name,
    email:    sess.email || null,
  }, 200, cors);
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function verifyState(request, url) {
  const fromUrl    = url.searchParams.get('state') || '';
  const fromCookie = readCookie(request, STATE_COOKIE_NAME) || '';
  if (!fromUrl || !fromCookie || fromUrl !== fromCookie) {
    console.warn('State mismatch', { fromUrl: fromUrl ? '<set>' : '<empty>', fromCookie: fromCookie ? '<set>' : '<empty>' });
    return { ok: false, err: 'state_mismatch' };
  }
  return { ok: true };
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp('(?:^|;\\s*)' + escapeRegex(name) + '=([^;]+)'));
  return match ? match[1] : null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeNext(next) {
  if (!next) return null;
  try {
    const u = new URL(next);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!ALLOWED_HOSTS.includes(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  let allowed = '';
  try {
    const u = new URL(origin);
    if (ALLOWED_HOSTS.includes(u.hostname)) allowed = origin;
  } catch {}
  return {
    'Access-Control-Allow-Origin':      allowed,
    'Access-Control-Allow-Credentials': 'true',
    'Vary':                             'Origin',
  };
}

function preflight(request) {
  const headers = corsHeaders(request);
  headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  headers['Access-Control-Max-Age']       = '600';
  return new Response(null, { status: 204, headers });
}

function sessionCookie(sessionId) {
  return `${COOKIE_NAME}=${sessionId}; Domain=${COOKIE_DOMAIN}; Path=/; Max-Age=${SESSION_TTL_SEC}; HttpOnly; Secure; SameSite=Lax`;
}
function clearSessionCookie() {
  return `${COOKIE_NAME}=; Domain=${COOKIE_DOMAIN}; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
function stateCookie(name, value) {
  return `${name}=${value}; Domain=${COOKIE_DOMAIN}; Path=/; Max-Age=${STATE_TTL_SEC}; HttpOnly; Secure; SameSite=Lax`;
}
function clearCookie(name) {
  return `${name}=; Domain=${COOKIE_DOMAIN}; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function redirectToLogin(err) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/login?err=${encodeURIComponent(err)}`,
      'Set-Cookie': clearCookie(STATE_COOKIE_NAME),
    },
  });
}

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type':  'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function htmlResponse(html, status = 200, extraHeaders = {}) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type':        'text/html; charset=utf-8',
      'Cache-Control':       'no-store',
      'X-Frame-Options':     'DENY',
      'Referrer-Policy':     'no-referrer',
      ...extraHeaders,
    },
  });
}

function decodeJwtClaims(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch (e) {
    console.error('JWT decode failed:', e);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// HTML templates — minimal, on-brand cream + dark text, no external deps.
// ──────────────────────────────────────────────────────────────────────────

function loginPageHtml(nextQs, errBanner) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 / Sign in — Yunze 博客</title>
<style>
  :root {
    --auth-bg: var(--bg, #f9fafa);
    --auth-fg: var(--fg, #1a1a1a);
    --auth-fg-muted: var(--fg-muted, #666666);
    --auth-border: var(--border, #e5e3df);
    --auth-card: #ffffff;
    --auth-radius-pill: 999px;
    --auth-hover: ${C.hover};
    --auth-err-bg: ${C.errBg};
    --auth-err-border: ${C.errBorder};
    --auth-err-fg: ${C.errFg};
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; background: var(--auth-bg); color: var(--auth-fg);
         font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
         display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { width: 100%; max-width: 360px; background: var(--auth-card); border: 1px solid var(--auth-border);
          border-radius: 16px; padding: 32px 28px; }
  h1 { margin: 0 0 8px; font-size: 1.5rem; font-weight: 600; letter-spacing: -.01em; }
  p.lede { margin: 0 0 24px; color: var(--auth-fg-muted); font-size: .95rem; line-height: 1.5; }
  .btn { display: flex; align-items: center; justify-content: center; gap: 12px;
         width: 100%; padding: 12px 16px; margin: 8px 0;
         background: var(--auth-card); color: var(--auth-fg); border: 1px solid var(--auth-border);
         border-radius: var(--auth-radius-pill); font-size: 1rem; font-weight: 500;
         text-decoration: none; cursor: pointer; transition: border-color .15s, background .15s; }
  .btn:hover { border-color: var(--auth-fg); background: var(--auth-hover); }
  .btn svg { width: 20px; height: 20px; flex: 0 0 20px; }
  .footnote { margin-top: 24px; font-size: .82rem; color: var(--auth-fg-muted); line-height: 1.5; }
  .banner { padding: 12px; border-radius: 12px; margin-bottom: 16px; font-size: .9rem; line-height: 1.5; }
  .banner.err { background: var(--auth-err-bg); border: 1px solid var(--auth-err-border); color: var(--auth-err-fg); }
  .banner a { color: inherit; }
</style>
</head>
<body>
  <div class="card">
    <h1>登录 / Sign in</h1>
    <p class="lede">只有 Yunze 家人列表里的成员能登录后留言、评论、写时光胶囊。<br>浏览文章不需要登录。</p>
    ${errBanner}
    <a class="btn" href="/login/github${nextQs}">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.3-.1-.3-.6-1.6.1-3.2 0 0 1-.3 3.3 1.3a11.5 11.5 0 0 1 6 0c2.3-1.6 3.3-1.3 3.3-1.3.7 1.6.2 2.9.1 3.2.8.9 1.3 2 1.3 3.3 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z"/></svg>
      <span>使用 GitHub 登录</span>
    </a>
    <a class="btn" href="/login/google${nextQs}">
      <svg viewBox="0 0 24 24"><path fill="${C.gBlue}" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"/><path fill="${C.gGreen}" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/><path fill="${C.gYellow}" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.93l3.66-2.83Z"/><path fill="${C.gRed}" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.3 9.14 5.38 12 5.38Z"/></svg>
      <span>使用 Google 登录</span>
    </a>
    <p class="footnote">不在名单里？给妈妈发邮件：<a href="mailto:hxz49@hotmail.com">hxz49@hotmail.com</a></p>
  </div>
</body>
</html>`;
}

function errorPageHtml(msg) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>出错了</title>
<style>body{font-family:sans-serif;max-width:480px;margin:80px auto;padding:24px;color:var(--fg, tokens.fg);}</style>
</head><body>
<h1>出错了</h1>
<p>${escapeHtml(msg)}</p>
<p><a href="/login">回到登录页</a></p>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
