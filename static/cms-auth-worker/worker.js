// yunze-cms-auth — OAuth Worker behind auth.duyunze.com.
//
// === Current responsibilities ===
//   1. Sveltia CMS OAuth bridge (Netlify-CMS compatible)
//      GET /auth      → redirect to GitHub authorize
//      GET /callback  → exchange code for token, postMessage back to /admin
//
// === Phase A (in progress) ===
// This file currently mirrors the original CF-dashboard-edited source verbatim
// so that the CMS keeps working through the migration. The new site-wide
// sign-in endpoints (/login, /callback/github, /callback/google, /logout, /me)
// will be added in the next commit. See DESIGN.md for the full plan.
//
// History:
//   - 2026-05-26 — first checked into git from CF dashboard (was dashboard-only
//     since the CMS was deployed). Pulled by hand from the Quick Edit pane.

const GITHUB_CLIENT_ID = 'Ov23libVHZUemiraJHc7';
const ALLOWED_ORIGIN = 'https://duyunze.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/auth') {
      const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        scope: 'repo,user',
        redirect_uri: `${url.origin}/callback`,
      });
      return Response.redirect(
        `https://github.com/login/oauth/authorize?${params}`, 302
      );
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });
      const data = await res.json();
      const token = data.access_token;
      const html = `<!DOCTYPE html><html><body><script>
        window.opener.postMessage(
          'authorization:github:success:${JSON.stringify({ token, provider: 'github' })}',
          '${ALLOWED_ORIGIN}'
        );
        window.close();
      <\/script></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }

    return new Response('Yunze CMS Auth', { status: 200 });
  }
};
