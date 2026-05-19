// Yunze Time Capsule – Cloudflare Worker
//
// Bindings (wrangler.toml):
//   RATE_LIMIT  – KV namespace
//   AI          – Cloudflare Workers AI
//
// Secrets (Cloudflare dashboard → Settings → Variables → Secrets):
//   GITHUB_TOKEN   – PAT with write access to hxz49/yunze-letters
//   RESEND_API_KEY – Resend API key for notification emails

const PRIVATE_REPO   = 'hxz49/yunze-letters';
const NOTIFY_EMAIL   = 'hxz49@hotmail.com';
const FROM_EMAIL     = 'onboarding@resend.dev';
const ALLOWED_ORIGIN = 'https://yunze229.github.io';

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN || origin === 'http://localhost:1313';
  return {
    'Access-Control-Allow-Origin':  allowed ? origin : ALLOWED_ORIGIN,
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

async function sendEmail(apiKey, subject, html) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: NOTIFY_EMAIL, subject, html }),
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

      const { sender, title, unlock_date, body: letter, lang } = body;

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

      ctx.waitUntil(
        sendEmail(
          env.RESEND_API_KEY,
          `📬 新的时光胶囊：${fromZh} → ${unlock_date}`,
          `<p><strong>${fromZh}</strong> 写了一封信，将于 <strong>${unlock_date}</strong> 开封。</p>
           <p>标题：${titleZh}</p><p>文件：<code>${filename}</code></p>`
        ).catch(e => console.error('Email error:', e))
      );

      return Response.json(
        { message: `信已寄出，将于 ${unlock_date} 开封 / Letter sealed, opens ${unlock_date}` },
        { headers: corsHeaders(origin) }
      );
    }

    return new Response('Not Found', { status: 404 });
}
