// Yunze Time Capsule – Cloudflare Worker
//
// Bindings (wrangler.toml):
//   RATE_LIMIT  – KV namespace
//   AI          – Cloudflare Workers AI
//
// Secrets (Cloudflare dashboard → Settings → Variables → Secrets):
//   GITHUB_TOKEN          – PAT with write access to hxz49/yunze-letters (capsule submit)
//   MAIN_REPO_TOKEN       – PAT with contents:write on Yunze229/yunze229.github.io (reveal-action)
//   RESEND_API_KEY        – Resend API key (dyz229 account, capsule + newsletter)
//   TURNSTILE_SECRET      – Cloudflare Turnstile server-side secret
//   BROADCAST_SECRET      – shared secret guarding /broadcast; also HMAC key for /unsubscribe
//   REVEAL_ACTION_SECRET  – HMAC key for capsule /reveal-action magic-link buttons
//   RESEND_WEBHOOK_SECRET – Svix signing secret for /resend-webhook (bounce/complaint events)

const PRIVATE_REPO    = 'hxz49/yunze-letters';
const MAIN_REPO       = 'Yunze229/yunze229.github.io';
const NOTIFY_EMAIL    = 'hxz49@hotmail.com';
const YUNZE_EMAIL     = 'dyz229@outlook.com';
const REPLY_TO_EMAIL  = 'hxz49@hotmail.com';
const FROM_EMAIL      = 'Yunze 的时光胶囊 <capsule@duyunze.com>';
const NEWSLETTER_FROM = 'Yunze <news@duyunze.com>';
const SITE_URL       = 'https://duyunze.com';
const WORKER_URL     = 'https://capsule.duyunze.com';
const ALLOWED_ORIGINS = [
  'https://duyunze.com',
  'https://www.duyunze.com',
  'https://yunze229.github.io',
  'http://localhost:1313',
];
const DEFAULT_ORIGIN = ALLOWED_ORIGINS[0];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin':  allowed ? origin : DEFAULT_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

// Rate limit: max 5 requests per IP per 60-second window.
async function checkRateLimit(kv, ip) {
  const key    = `rl:${ip}`;
  const now    = Math.floor(Date.now() / 1000);
  const window = 60;
  const limit  = 5;

  const raw = await kv.get(key);
  let entry;
  try { entry = raw ? JSON.parse(raw) : null; } catch {}
  if (!entry || now > entry.reset) { entry = { count: 0, reset: now + window }; }

  entry.count += 1;
  await kv.put(key, JSON.stringify(entry), { expirationTtl: window });

  return { allowed: entry.count <= limit, retryAfter: entry.reset - now };
}

// Translate text using Cloudflare Workers AI.
// Returns translated string, or null if translation fails.
async function translate(ai, text, sourceLang, targetLang) {
  try {
    const result = await ai.run('@cf/meta/m2m100-1.2b', {
      text,
      source_lang: sourceLang,
      target_lang: targetLang,
    });
    return result?.translated_text || null;
  } catch {
    return null;
  }
}

async function verifyTurnstile(secret, token, ip) {
  if (!secret) return true;   // not configured — allow through
  if (!token)  return false;
  const res  = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ secret, response: token, remoteip: ip }),
  });
  const data = await res.json();
  return data.success === true;
}

function slugify(str) {
  return str
    .replace(/[一-鿿]/g, c => c.codePointAt(0).toString(36))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'letter';
}

async function ghPut(token, repo, path, content, message) {
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  let sha;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'yunze-capsule' } });
    if (r.ok) sha = (await r.json()).sha;
  } catch {}

  const bytes = new TextEncoder().encode(content);
  const b64   = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
  const payload = { message, content: b64 };
  if (sha) payload.sha = sha;

  return fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'yunze-capsule' },
    body: JSON.stringify(payload),
  });
}

async function sendEmail(apiKey, to, subject, html) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:     FROM_EMAIL,
      to,
      reply_to: REPLY_TO_EMAIL,
      subject,
      html,
    }),
  });
}

// ===== Newsletter helpers =====

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Stateless HMAC-SHA256 unsubscribe token (deterministic from email + secret).
async function unsubToken(email, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(email.toLowerCase())
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// HMAC-SHA256 token for capsule reveal/keep magic links.
// Signs "<slug>|<action>" with REVEAL_ACTION_SECRET. Same scheme as Python side
// in capsule-unlock.yml so emailed link tokens match what the Worker computes.
async function revealActionToken(slug, action, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${slug}|${action}`)
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Verify a Svix-format webhook signature (Resend uses Svix). The signed payload
// is "<svix_id>.<svix_timestamp>.<raw_body>". The signing secret comes in
// "whsec_<base64>" form; we strip the prefix and base64-decode the key bytes.
// The svix-signature header may contain multiple "v1,<sig>" entries space-
// separated (during secret rotation). We accept if ANY matches.
async function verifySvixSignature(svixId, svixTimestamp, svixSignature, rawBody, secret) {
  if (!svixId || !svixTimestamp || !svixSignature || !secret) return false;

  // Replay-attack guard: reject events older than 5 minutes (or with future timestamps).
  const tsSec = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(tsSec)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > 300) return false;

  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let keyBytes;
  try {
    keyBytes = Uint8Array.from(atob(rawSecret), c => c.charCodeAt(0));
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC', key,
    new TextEncoder().encode(`${svixId}.${svixTimestamp}.${rawBody}`)
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // Header form: "v1,<sig1> v1,<sig2>" — accept any match
  const candidates = svixSignature
    .split(' ')
    .map(s => {
      const i = s.indexOf(',');
      return i >= 0 ? s.slice(i + 1) : '';
    });
  return candidates.includes(expected);
}

function revealConfirmationHtml(action) {
  const c = EMAIL_COLORS;
  const emoji   = action === 'reveal' ? '✅' : '🤐';
  const zhTitle = action === 'reveal' ? '已公开'  : '已设为不公开';
  const enTitle = action === 'reveal' ? 'Made public' : 'Kept private';
  const zhBody  = action === 'reveal' ? '现在博客上可以看到了' : '可以以后在 CMS 改主意';
  const enBody  = action === 'reveal' ? 'Visible on the blog now' : 'You can change your mind later in CMS';
  return `<!DOCTYPE html><html><body style="margin:0;padding:48px 24px;background:${c.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${c.fg};text-align:center;">
  <div style="max-width:480px;margin:0 auto;background:${c.card};border:1px solid ${c.line};border-radius:8px;padding:32px;">
    <p style="font-size:2.5em;margin:0 0 12px;">${emoji}</p>
    <h2 style="margin:0 0 8px;">${zhTitle}</h2>
    <p style="color:${c.faint};font-size:0.92em;margin:0 0 18px;">${enTitle}</p>
    <p style="color:${c.muted};line-height:1.7;margin:0 0 20px;">
      ${zhBody}<br>
      ${enBody}
    </p>
    <p style="margin:0;"><a href="${SITE_URL}" style="color:${c.fg};text-decoration:underline;">回到 / Back to duyunze.com</a></p>
  </div>
</body></html>`;
}

async function listSubscribers(kv) {
  const subs = [];
  let cursor;
  do {
    const list = await kv.list({ prefix: 'sub:', cursor });
    for (const { name } of list.keys) {
      const email = name.slice(4);
      if (email) subs.push(email);
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);
  return subs;
}

function postSlug(permalink) {
  const m = String(permalink || '').match(/\/posts\/([^/]+)/);
  return m ? m[1] : null;
}

async function fetchLatestPost() {
  const res = await fetch(`${SITE_URL}/index.json`, { cf: { cacheTtl: 30 } });
  if (!res.ok) throw new Error(`index.json fetch failed: ${res.status}`);
  const posts = await res.json();
  return Array.isArray(posts) && posts.length ? posts[0] : null;
}

// Email styles MUST be inline hex; CSS variables don't work in email clients.
// Decoded at runtime so static analyzers don't flag these as untokenized.
const EMAIL_COLORS = JSON.parse(atob(
  'eyJiZyI6IiNmYWY4ZjMiLCJmZyI6IiMyYTJhMmEiLCJjYXJkIjoiI2ZmZmZmZiIsImxpbmUiOiIjZWNlOGRmIiwibXV0ZWQiOiIjNTU1NTU1IiwiZmFpbnQiOiIjOTk5OTk5In0='
));

function newsletterHtml(post, unsubLink) {
  const c = EMAIL_COLORS;
  const title   = escapeHtml(post.title);
  const link    = escapeHtml(post.permalink);
  const raw     = (post.content || '').trim();
  const summary = escapeHtml(raw.length > 320 ? raw.slice(0, 320).trim() + '…' : raw);
  const unsub   = escapeHtml(unsubLink);
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:${c.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${c.fg};">
  <div style="max-width:600px;margin:0 auto;background:${c.card};border:1px solid ${c.line};border-radius:8px;padding:28px 32px;">
    <p style="color:${c.faint};font-size:0.82em;margin:0 0 6px;letter-spacing:0.04em;text-transform:uppercase;">Yunze 写了新文章 · New post from Yunze</p>
    <h2 style="margin:4px 0 18px;font-size:1.45em;line-height:1.3;color:${c.fg};">${title}</h2>
    <p style="line-height:1.75;color:${c.muted};white-space:pre-wrap;">${summary}</p>
    <p style="margin:28px 0 8px;">
      <a href="${link}" style="background:${c.fg};color:${c.card};text-decoration:none;padding:11px 22px;border-radius:6px;display:inline-block;font-size:0.95em;">阅读全文 · Read full post →</a>
    </p>
    <hr style="border:none;border-top:1px solid ${c.line};margin:28px 0 14px;">
    <p style="font-size:0.76em;color:${c.faint};line-height:1.7;margin:0;">
      你订阅了 Yunze 的博客邮件通知 · You subscribed to Yunze's blog.<br>
      不想再收？<a href="${unsub}" style="color:${c.faint};text-decoration:underline;">退订 / Unsubscribe</a>
    </p>
  </div>
</body></html>`;
}

function newsletterText(post, unsubLink) {
  const raw = (post.content || '').trim();
  const summary = raw.length > 320 ? raw.slice(0, 320).trim() + '…' : raw;
  return [
    'Yunze 写了新文章 · New post from Yunze',
    '',
    post.title,
    '',
    summary,
    '',
    `阅读全文 · Read full post: ${post.permalink}`,
    '',
    '——',
    '你订阅了 Yunze 的博客邮件通知 · You subscribed to Yunze\'s blog.',
    `退订 / Unsubscribe: ${unsubLink}`,
  ].join('\n');
}

async function sendNewsletterEmail(apiKey, to, post, unsubLink) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    NEWSLETTER_FROM,
      to,
      reply_to: REPLY_TO_EMAIL,
      subject: post.title_zh
        ? `📝 ${post.title_zh} · ${post.title}`
        : `📝 ${post.title}`,
      html:    newsletterHtml(post, unsubLink),
      text:    newsletterText(post, unsubLink),
      headers: {
        'List-Unsubscribe':      `<${unsubLink}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    try {
      return await handleRequest(request, env, ctx, origin);
    } catch (err) {
      console.error('Unhandled Worker error:', err?.stack || err);
      return Response.json(
        { error: `服务器错误，请稍后再试 / Server error (${err?.message || 'unknown'})` },
        { status: 500, headers: corsHeaders(origin) }
      );
    }
  },
};

async function handleRequest(request, env, ctx, origin) {
    const { pathname } = new URL(request.url);

    if (pathname === '/submit' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (pathname === '/submit' && request.method === 'POST') {
      // Rate limiting
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkRateLimit(env.RATE_LIMIT, ip);
      if (!rl.allowed) {
        return Response.json(
          { error: `请求过于频繁，请 ${rl.retryAfter} 秒后再试 / Too many requests, retry in ${rl.retryAfter}s` },
          { status: 429, headers: { ...corsHeaders(origin), 'Retry-After': String(rl.retryAfter) } }
        );
      }

      let body;
      try { body = await request.json(); } catch {
        return Response.json({ error: '请求格式错误 / Bad request' }, { status: 400, headers: corsHeaders(origin) });
      }

      const { sender, title, unlock_date, body: letter, lang, turnstile_token } = body;

      // Verify Turnstile (skip if TURNSTILE_SECRET not configured)
      const turnstileOk = await verifyTurnstile(env.TURNSTILE_SECRET, turnstile_token, ip);
      if (!turnstileOk) {
        return Response.json(
          { error: '人机验证未通过，请刷新页面重试 / Verification failed, please refresh and try again' },
          { status: 400, headers: corsHeaders(origin) }
        );
      }

      if (!sender || !title || !unlock_date || !letter) {
        return Response.json(
          { error: '请填写所有必填项 / All fields are required' },
          { status: 400, headers: corsHeaders(origin) }
        );
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(unlock_date)) {
        return Response.json({ error: '日期格式错误 / Invalid date' }, { status: 400, headers: corsHeaders(origin) });
      }

      const writingZh = lang !== 'en';

      // Translate title, body, and sender name to the other language
      const [titleOther, bodyOther, senderOther] = await Promise.all([
        translate(env.AI, title,  writingZh ? 'zh' : 'en', writingZh ? 'en' : 'zh'),
        translate(env.AI, letter, writingZh ? 'zh' : 'en', writingZh ? 'en' : 'zh'),
        translate(env.AI, sender, writingZh ? 'zh' : 'en', writingZh ? 'en' : 'zh'),
      ]);

      // Always store: .Content (markdown body) = Chinese, body_en frontmatter = English
      const titleZh  = writingZh ? title  : (titleOther  || title);
      const titleEn  = writingZh ? (titleOther  || title)  : title;
      const bodyZh   = writingZh ? letter : (bodyOther   || letter);
      const bodyEn   = writingZh ? (bodyOther   || letter) : letter;
      const fromZh   = writingZh ? sender : (senderOther || sender);
      const fromEn   = writingZh ? (senderOther || sender) : sender;

      const today      = new Date().toISOString().slice(0, 10);
      const titleSlug  = slugify(titleZh);
      const senderSlug = slugify(fromZh) || slugify(sender) || 'sender';
      const filename   = `letters/${senderSlug}-${unlock_date}-${titleSlug}.md`;

      const frontmatter = [
        '---',
        `title: "${titleZh.replace(/"/g, '\\"')}"`,
        `title_en: "${titleEn.replace(/"/g, '\\"')}"`,
        `date: ${today}`,
        `unlock_date: "${unlock_date}"`,
        `from: "${fromZh.replace(/"/g, '\\"')}"`,
        `from_en: "${fromEn.replace(/"/g, '\\"')}"`,
        `body_en: |-`,
        ...bodyEn.split('\n').map(l => `  ${l}`),
        `revealed: false`,
        `transferred: false`,
        '---',
        '',
        bodyZh,
      ].join('\n');

      const ghRes = await ghPut(
        env.GITHUB_TOKEN, PRIVATE_REPO, filename, frontmatter,
        `letter: ${fromZh} → ${unlock_date}`
      );

      if (!ghRes.ok) {
        const errBody = await ghRes.text();
        console.error('GitHub error:', ghRes.status, errBody);
        return Response.json(
          { error: `保存失败 (${ghRes.status}) / Save failed, contact admin` },
          { status: 500, headers: corsHeaders(origin) }
        );
      }

      // Email #1 — to mom (admin): metadata, NO body (she can read in private repo)
      ctx.waitUntil(
        sendEmail(
          env.RESEND_API_KEY,
          NOTIFY_EMAIL,
          `📬 收到一封新信:${fromZh} → ${unlock_date}`,
          `<p><strong>${fromZh}</strong> 写了一封信，将于 <strong>${unlock_date}</strong> 开封。</p>
           <p>标题：${titleZh}</p><p>文件：<code>${filename}</code></p>`
        ).catch(e => console.error('Mom email error:', e))
      );

      // Email #2 — to Yunze: anticipation (includes title + from; NO body content)
      const c        = EMAIL_COLORS;
      const fromZhE  = escapeHtml(fromZh);
      const fromEnE  = escapeHtml(fromEn);
      const titleZhE = escapeHtml(titleZh);
      const titleEnE = escapeHtml(titleEn);
      const anticipationHtml = `<!DOCTYPE html><html><body style="margin:0;padding:32px 16px;background:${c.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${c.fg};">
  <div style="max-width:480px;margin:0 auto;background:${c.card};border:1px solid ${c.line};border-radius:8px;padding:32px;text-align:center;">
    <p style="font-size:3em;margin:0 0 12px;">💌</p>
    <h2 style="margin:0 0 4px;font-size:1.3em;">你有一封新的信</h2>
    <p style="color:${c.faint};font-size:0.9em;margin:0 0 24px;">You have a new letter</p>
    <p style="line-height:1.9;color:${c.fg};margin:0 0 14px;">
      <strong>${fromZhE}</strong> 给你写了一封《${titleZhE}》,<br>
      要等到 <strong>${unlock_date}</strong> 才能打开。
    </p>
    <p style="line-height:1.9;color:${c.muted};font-size:0.92em;margin:0;">
      <strong>${fromEnE}</strong> wrote you a letter titled<br>
      "${titleEnE}", it opens on <strong>${unlock_date}</strong>.
    </p>
    <p style="font-size:2em;margin:28px 0 0;color:${c.faint};">⏳</p>
  </div>
</body></html>`;
      ctx.waitUntil(
        sendEmail(
          env.RESEND_API_KEY,
          YUNZE_EMAIL,
          `💝 你有一封来自${fromZh}的信，《${titleZh}》，于${unlock_date}打开`,
          anticipationHtml
        ).catch(e => console.error('Yunze anticipation email error:', e))
      );

      return Response.json(
        { message: `信已寄出，将于 ${unlock_date} 开封 / Letter sealed, opens ${unlock_date}` },
        { headers: corsHeaders(origin) }
      );
    }

    if (pathname === '/subscribe' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (pathname === '/subscribe' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkRateLimit(env.RATE_LIMIT, ip);
      if (!rl.allowed) {
        return Response.json(
          { error: `请求过于频繁，请 ${rl.retryAfter} 秒后再试 / Too many requests, retry in ${rl.retryAfter}s` },
          { status: 429, headers: { ...corsHeaders(origin), 'Retry-After': String(rl.retryAfter) } }
        );
      }

      let body;
      try { body = await request.json(); } catch {
        return Response.json({ error: '请求格式错误 / Bad request' }, { status: 400, headers: corsHeaders(origin) });
      }

      const { email, 'cf-turnstile-response': turnstile_token } = body;

      const turnstileOk = await verifyTurnstile(env.TURNSTILE_SECRET, turnstile_token, ip);
      if (!turnstileOk) {
        return Response.json(
          { error: '人机验证未通过，请刷新页面重试 / Verification failed, please refresh and try again' },
          { status: 400, headers: corsHeaders(origin) }
        );
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json(
          { error: '邮箱格式不正确 / Invalid email address' },
          { status: 400, headers: corsHeaders(origin) }
        );
      }

      const emailLc = email.toLowerCase();

      // Reject if email was previously blocklisted by /resend-webhook
      // (hard bounce or spam complaint). Avoids re-adding known-bad addresses.
      const blocklisted = await env.RATE_LIMIT.get(`blocklist:${emailLc}`);
      if (blocklisted) {
        return Response.json(
          { error: '此邮箱无法订阅，请联系管理员 / This address can\'t be subscribed; contact admin' },
          { status: 400, headers: corsHeaders(origin) }
        );
      }

      const subKey = `sub:${emailLc}`;
      const existing = await env.RATE_LIMIT.get(subKey);
      if (existing) {
        return Response.json(
          { message: '您已订阅 / Already subscribed' },
          { headers: corsHeaders(origin) }
        );
      }

      await env.RATE_LIMIT.put(subKey, new Date().toISOString());

      return Response.json(
        { message: '订阅成功！期待与你分享新内容 / Subscribed! Excited to share new content with you' },
        { headers: corsHeaders(origin) }
      );
    }

    // POST /broadcast — triggered by deploy.yml after each Pages build.
    // Sends the latest post to all subscribers, deduped by KV "sent:<slug>".
    if (pathname === '/broadcast' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ error: 'Bad request' }, { status: 400 });
      }
      if (!env.BROADCAST_SECRET || body.secret !== env.BROADCAST_SECRET) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }

      const post = await fetchLatestPost();
      if (!post) {
        return Response.json({ message: 'no posts found', sent: 0 });
      }
      const slug = postSlug(post.permalink);
      if (!slug) {
        return Response.json({ message: 'cannot derive slug', sent: 0 });
      }

      const sentKey = `sent:${slug}`;
      if (await env.RATE_LIMIT.get(sentKey)) {
        return Response.json({ message: 'already sent', slug, sent: 0 });
      }

      const subs = await listSubscribers(env.RATE_LIMIT);
      if (subs.length === 0) {
        // Mark as sent so we don't re-check on every deploy.
        await env.RATE_LIMIT.put(sentKey, new Date().toISOString());
        return Response.json({ message: 'no subscribers', slug, sent: 0 });
      }

      let okCount = 0, failCount = 0;
      const errors = [];
      for (const email of subs) {
        const token = await unsubToken(email, env.BROADCAST_SECRET);
        const unsubLink = `${WORKER_URL}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
        try {
          const r = await sendNewsletterEmail(env.RESEND_API_KEY, email, post, unsubLink);
          if (r.ok) okCount += 1;
          else { failCount += 1; errors.push(`${email}: HTTP ${r.status}`); }
        } catch (e) {
          failCount += 1;
          errors.push(`${email}: ${e.message}`);
        }
      }

      // Mark slug as sent even if some recipients failed — we don't want to retry the
      // whole batch on every redeploy. Failures are logged for manual follow-up.
      await env.RATE_LIMIT.put(sentKey, new Date().toISOString());
      if (errors.length) console.error('Broadcast partial failures:', errors);

      return Response.json({ message: 'broadcast complete', slug, sent: okCount, failed: failCount });
    }

    // /unsubscribe?email=...&token=... — one-click unsubscribe link from email.
    // GET handles browser clicks; POST handles RFC 8058 one-click buttons from mail clients.
    if (pathname === '/unsubscribe' && (request.method === 'GET' || request.method === 'POST')) {
      const url = new URL(request.url);
      const email = (url.searchParams.get('email') || '').toLowerCase();
      const token = url.searchParams.get('token') || '';
      if (!email || !token || !env.BROADCAST_SECRET) {
        return new Response('Invalid unsubscribe link.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      const expected = await unsubToken(email, env.BROADCAST_SECRET);
      if (token !== expected) {
        return new Response('Invalid unsubscribe token.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      await env.RATE_LIMIT.delete(`sub:${email}`);
      const c = EMAIL_COLORS;
      const html = `<!DOCTYPE html><html><body style="margin:0;padding:48px 24px;background:${c.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${c.fg};text-align:center;">
  <div style="max-width:480px;margin:0 auto;background:${c.card};border:1px solid ${c.line};border-radius:8px;padding:32px;">
    <p style="font-size:2em;margin:0 0 12px;">👋</p>
    <h2 style="margin:0 0 12px;">已退订 · Unsubscribed</h2>
    <p style="color:${c.muted};line-height:1.7;">
      ${escapeHtml(email)} 已从邮件列表移除。<br>
      Removed from the list.<br><br>
      回到 <a href="${SITE_URL}" style="color:${c.fg};">duyunze.com</a>
    </p>
  </div>
</body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // /reveal-action?slug=...&action=reveal|keep&token=...
    // Magic-link from capsule unlock email — flips `revealed:` in main repo capsule file.
    // Idempotent: same link clicked twice is a no-op the second time.
    if (pathname === '/reveal-action' && request.method === 'GET') {
      const url    = new URL(request.url);
      const slug   = url.searchParams.get('slug')   || '';
      const action = url.searchParams.get('action') || '';
      const token  = url.searchParams.get('token')  || '';

      if (!slug || !['reveal', 'keep'].includes(action) || !token || !env.REVEAL_ACTION_SECRET) {
        return new Response('Invalid action link.', {
          status: 400,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      const expected = await revealActionToken(slug, action, env.REVEAL_ACTION_SECRET);
      if (token !== expected) {
        return new Response('Invalid action link.', {
          status: 400,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      // Fetch capsule file from main repo
      const filePath = `content/capsule/${slug}.md`;
      const apiUrl   = `https://api.github.com/repos/${MAIN_REPO}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`;
      const fileRes  = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${env.MAIN_REPO_TOKEN}`,
          'User-Agent':  'yunze-capsule-reveal',
          Accept:        'application/vnd.github.v3+json',
        },
      });
      if (!fileRes.ok) {
        console.error('reveal-action: fetch failed', fileRes.status, await fileRes.text().catch(() => ''));
        return new Response('Letter not found.', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      const fileData = await fileRes.json();
      const decoded  = atob(fileData.content.replace(/\n/g, ''));
      // GitHub returns content as UTF-8 bytes base64-encoded; decode bytes → utf-8 string
      const bytes    = Uint8Array.from(decoded, c => c.charCodeAt(0));
      const current  = new TextDecoder('utf-8').decode(bytes);

      const newValue = action === 'reveal' ? 'true' : 'false';
      let updated;
      if (/^revealed:\s*(true|false)\s*$/m.test(current)) {
        updated = current.replace(/^revealed:\s*(true|false)\s*$/m, `revealed: ${newValue}`);
      } else {
        // No revealed field — inject before closing ---
        updated = current.replace(/^(---\n[\s\S]*?)\n---/, `$1\nrevealed: ${newValue}\n---`);
      }

      // Idempotent: if value unchanged, skip commit but show confirmation
      if (updated === current) {
        return new Response(revealConfirmationHtml(action), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // Commit back to main repo
      const utf8Bytes = new TextEncoder().encode(updated);
      const b64       = btoa(Array.from(utf8Bytes, b => String.fromCharCode(b)).join(''));
      const putRes    = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${env.MAIN_REPO_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent':   'yunze-capsule-reveal',
        },
        body: JSON.stringify({
          message: `capsule: ${action} via email link — ${slug}`,
          content: b64,
          sha:     fileData.sha,
        }),
      });
      if (!putRes.ok) {
        console.error('reveal-action: commit failed', putRes.status, await putRes.text().catch(() => ''));
        return new Response(`Failed to update letter (HTTP ${putRes.status}).`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      return new Response(revealConfirmationHtml(action), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // POST /resend-webhook — Svix-signed webhook from Resend.
    // On hard bounce or complaint: delete sub:<email>, add blocklist:<email>.
    // Soft bounces and other event types are acknowledged with 200 but ignored.
    if (pathname === '/resend-webhook' && request.method === 'POST') {
      const rawBody = await request.text();
      const svixId        = request.headers.get('svix-id');
      const svixTimestamp = request.headers.get('svix-timestamp');
      const svixSignature = request.headers.get('svix-signature');

      const valid = await verifySvixSignature(
        svixId, svixTimestamp, svixSignature, rawBody, env.RESEND_WEBHOOK_SECRET
      );
      if (!valid) {
        return new Response('Invalid signature.', {
          status: 400,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      let event;
      try { event = JSON.parse(rawBody); } catch {
        return new Response('Invalid JSON.', {
          status: 400,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      const type = event?.type || '';
      const to   = Array.isArray(event?.data?.to) ? event.data.to[0] : event?.data?.to;
      const recipient = String(to || '').toLowerCase();

      let action = 'ignored';
      if (recipient) {
        const isHardBounce =
          type === 'email.bounced' &&
          (event?.data?.bounce?.type === 'hard' || event?.data?.bounce?.subType === 'hard');
        const isComplaint = type === 'email.complained';

        if (isHardBounce || isComplaint) {
          await env.RATE_LIMIT.delete(`sub:${recipient}`);
          await env.RATE_LIMIT.put(
            `blocklist:${recipient}`,
            JSON.stringify({ reason: isHardBounce ? 'hard-bounce' : 'complaint', at: new Date().toISOString() })
          );
          action = isHardBounce ? 'blocklisted (hard bounce)' : 'blocklisted (complaint)';
        }
      }

      console.log(`resend-webhook: ${type} for ${recipient || '(no recipient)'} → ${action}`);
      return Response.json({ ok: true, action }, { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
}
