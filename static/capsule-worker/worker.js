// Yunze Time Capsule – Cloudflare Worker
//
// Secrets to set in Cloudflare dashboard (Settings → Variables → Secrets):
//
//   GITHUB_TOKEN   – PAT with repo write access to hxz49/yunze-letters
//   RESEND_API_KEY – for notification emails to admin
//   USER_MAP       – JSON string, format:
//     {
//       "爷爷": {"password": "XXXX", "tz": "Asia/Shanghai"},
//       "奶奶": {"password": "XXXX", "tz": "Asia/Shanghai"},
//       "爸爸": {"password": "XXXX", "tz": "Asia/Shanghai"},
//       "妈妈": {"password": "XXXX", "tz": "America/Los_Angeles"},
//       "Yunze": {"password": "XXXX", "tz": "America/Los_Angeles"}
//     }
//   Replace XXXX with the last 4 digits of each person's phone number.

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
  const key     = `rl:${ip}`;
  const now     = Math.floor(Date.now() / 1000);
  const window  = 60;
  const limit   = 5;

  const raw   = await kv.get(key);
  const entry = raw ? JSON.parse(raw) : { count: 0, reset: now + window };

  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + window;
  }

  entry.count += 1;
  await kv.put(key, JSON.stringify(entry), { expirationTtl: window });

  return { allowed: entry.count <= limit, retryAfter: entry.reset - now };
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>给 Yunze 写一封信</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f4f1;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border-radius:16px;padding:40px;max-width:540px;width:100%;box-shadow:0 2px 20px rgba(0,0,0,.08)}
  h1{font-size:1.4rem;font-weight:700;margin-bottom:6px;color:#1a1a1a}
  .subtitle{color:#777;font-size:.9rem;margin-bottom:28px;line-height:1.6}
  label{display:block;font-size:.83rem;font-weight:600;color:#444;margin-bottom:5px}
  input,select,textarea{width:100%;padding:10px 13px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:.95rem;font-family:inherit;color:#1a1a1a;background:#fafaf9;transition:border .15s}
  input:focus,select:focus,textarea:focus{outline:none;border-color:#1a1a1a;background:#fff}
  textarea{min-height:200px;resize:vertical;line-height:1.7}
  .field{margin-bottom:18px}
  .hint{font-size:.78rem;color:#999;margin-top:4px}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .unlock-tabs{display:flex;gap:8px;margin-bottom:10px}
  .tab{flex:1;padding:7px;border:1.5px solid #e0e0e0;border-radius:7px;background:#fafaf9;cursor:pointer;font-size:.83rem;text-align:center;transition:all .15s}
  .tab.active{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
  .panel{display:none}.panel.show{display:block}
  .check-row{display:flex;align-items:center;gap:10px;padding:10px 13px;border:1.5px solid #e0e0e0;border-radius:8px;background:#fafaf9;cursor:pointer}
  .check-row input[type=checkbox]{width:16px;height:16px;margin:0;cursor:pointer}
  .check-row span{font-size:.88rem;color:#444;line-height:1.4}
  .submit-btn{width:100%;padding:13px;background:#1a1a1a;color:#fff;border:none;border-radius:8px;font-size:.97rem;font-weight:600;cursor:pointer;transition:opacity .15s;margin-top:4px}
  .submit-btn:hover{opacity:.82}
  .submit-btn:disabled{opacity:.35;cursor:not-allowed}
  .msg{padding:13px 15px;border-radius:8px;font-size:.88rem;margin-top:14px;display:none;line-height:1.5}
  .msg.ok{background:#e8f5e9;color:#2e7d32;display:block}
  .msg.err{background:#fce4ec;color:#c62828;display:block}
  .divider{border:none;border-top:1px solid #f0f0f0;margin:22px 0}
</style>
</head>
<body>
<div class="card">
  <h1>📬 给 Yunze 写一封信</h1>
  <p class="subtitle">这封信会被安全保存，直到开封日才能打开。<br>请用 Yunze 妈妈给你设置的用户名和密码登录。</p>

  <div class="row">
    <div class="field">
      <label>你是</label>
      <select id="username">
        <option value="">请选择…</option>
        <option value="爷爷">爷爷</option>
        <option value="奶奶">奶奶</option>
        <option value="爸爸">爸爸</option>
        <option value="妈妈">妈妈</option>
        <option value="Yunze">Yunze（写给未来的自己）</option>
      </select>
    </div>
    <div class="field">
      <label>密码</label>
      <input type="password" id="password" placeholder="4位数字" maxlength="4" inputmode="numeric">
      <div class="hint">Yunze 妈妈设置的密码</div>
    </div>
  </div>

  <hr class="divider">

  <div class="field">
    <label>信的标题</label>
    <input type="text" id="title" placeholder="例如：写给 18 岁的你">
  </div>

  <div class="field">
    <label>什么时候打开？</label>
    <div class="unlock-tabs">
      <div class="tab active" onclick="setMode('age')">按年龄选</div>
      <div class="tab" onclick="setMode('date')">自定义日期</div>
    </div>
    <div id="panel-age" class="panel show">
      <select id="unlock-age">
        <option value="2028-02-29">12岁生日（2028-02-29）</option>
        <option value="2029-02-28">13岁生日（2029-02-28）</option>
        <option value="2030-02-28">14岁生日（2030-02-28）</option>
        <option value="2031-02-28">15岁生日（2031-02-28）</option>
        <option value="2032-02-29">16岁生日（2032-02-29）</option>
        <option value="2033-02-28">17岁生日（2033-02-28）</option>
        <option value="2034-02-28">18岁生日（2034-02-28）</option>
        <option value="2035-02-28">19岁生日（2035-02-28）</option>
        <option value="2036-02-29">20岁生日（2036-02-29）</option>
        <option value="2037-02-28">21岁生日（2037-02-28）</option>
        <option value="2041-02-28">25岁生日（2041-02-28）</option>
        <option value="2046-02-28">30岁生日（2046-02-28）</option>
        <option value="2056-02-29">40岁生日（2056-02-29）</option>
      </select>
    </div>
    <div id="panel-date" class="panel">
      <input type="date" id="unlock-date">
    </div>
  </div>

  <div class="field">
    <label>信的内容</label>
    <textarea id="body" placeholder="想对 Yunze 说的话……"></textarea>
  </div>

  <div class="field">
    <label class="check-row">
      <input type="checkbox" id="show-preview" checked>
      <span>锁定期间显示信的标题和发件人<br><small style="color:#999">（内容仍然隐藏，到了开封日才能看到）</small></span>
    </label>
  </div>

  <button class="submit-btn" id="submit-btn" onclick="submit()">寄出这封信 ✉️</button>
  <div id="msg" class="msg"></div>
</div>

<script>
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
document.getElementById('unlock-date').min = tomorrow.toISOString().slice(0, 10);

let mode = 'age';
function setMode(m) {
  mode = m;
  document.querySelectorAll('.tab').forEach((t,i) => t.className = 'tab' + ((m==='age'&&i===0)||(m==='date'&&i===1)?' active':''));
  document.getElementById('panel-age').className = 'panel' + (m==='age'?' show':'');
  document.getElementById('panel-date').className = 'panel' + (m==='date'?' show':'');
}

async function submit() {
  const btn = document.getElementById('submit-btn');
  const msgEl = document.getElementById('msg');
  msgEl.className = 'msg';

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value.trim();
  const title    = document.getElementById('title').value.trim();
  const body     = document.getElementById('body').value.trim();
  const unlock   = mode === 'age'
    ? document.getElementById('unlock-age').value
    : document.getElementById('unlock-date').value;
  const showPreview = document.getElementById('show-preview').checked;

  if (!username) { return err('请选择你是谁'); }
  if (!password) { return err('请输入密码'); }
  if (!title)    { return err('请填写信的标题'); }
  if (!body)     { return err('请写一些内容'); }
  if (!unlock)   { return err('请选择开封日期'); }

  btn.disabled = true;
  btn.textContent = '寄出中…';

  try {
    const res = await fetch('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, title, unlock_date: unlock, body, show_preview: showPreview })
    });
    const data = await res.json();
    if (res.ok) {
      msgEl.className = 'msg ok';
      msgEl.textContent = data.message;
      document.getElementById('title').value = '';
      document.getElementById('body').value = '';
      document.getElementById('password').value = '';
    } else {
      err(data.error || '提交失败，请稍后再试');
    }
  } catch {
    err('网络错误，请检查网络后重试');
  }
  btn.disabled = false;
  btn.textContent = '寄出这封信 ✉️';
}

function err(msg) {
  const el = document.getElementById('msg');
  el.className = 'msg err';
  el.textContent = msg;
}
</script>
</body>
</html>`;

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
  const b64 = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
  const payload = { message, content: b64 };
  if (sha) payload.sha = sha;

  return fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'yunze-capsule' },
    body: JSON.stringify(payload)
  });
}

async function sendEmail(apiKey, subject, html) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: NOTIFY_EMAIL, subject, html })
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (pathname === '/' || pathname === '') {
      return new Response(HTML_PAGE, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    if (pathname === '/submit' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (pathname === '/submit' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkRateLimit(env.RATE_LIMIT, ip);
      if (!rl.allowed) {
        return Response.json(
          { error: `请求过于频繁，请 ${rl.retryAfter} 秒后再试` },
          { status: 429, headers: { ...corsHeaders(origin), 'Retry-After': String(rl.retryAfter) } }
        );
      }

      let body;
      try { body = await request.json(); } catch {
        return Response.json({ error: '请求格式错误' }, { status: 400, headers: corsHeaders(origin) });
      }

      const { username, password, title, unlock_date, body: letter, show_preview } = body;

      if (!username || !password || !title || !unlock_date || !letter) {
        return Response.json({ error: '请填写所有必填项' }, { status: 400, headers: corsHeaders(origin) });
      }

      // Authenticate
      let userMap;
      try { userMap = JSON.parse(env.USER_MAP); } catch {
        return Response.json({ error: '服务器配置错误，请联系管理员' }, { status: 500, headers: corsHeaders(origin) });
      }

      const user = userMap[username];
      if (!user) {
        return Response.json({ error: '用户名不存在' }, { status: 403, headers: corsHeaders(origin) });
      }
      if (String(password) !== String(user.password)) {
        return Response.json({ error: '密码错误' }, { status: 403, headers: corsHeaders(origin) });
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(unlock_date)) {
        return Response.json({ error: '日期格式错误' }, { status: 400, headers: corsHeaders(origin) });
      }

      const today = new Date().toISOString().slice(0, 10);
      const titleSlug = slugify(title);
      const userSlug = slugify(username) || username.codePointAt(0).toString(36);
      const filename = `letters/${userSlug}-${unlock_date}-${titleSlug}.md`;

      const frontmatter = [
        '---',
        `title: "${title.replace(/"/g, '\\"')}"`,
        `date: ${today}`,
        `unlock_date: "${unlock_date}"`,
        `from: "${username}"`,
        `tz: "${user.tz}"`,
        `show_preview: ${show_preview ? 'true' : 'false'}`,
        `revealed: false`,
        `transferred: false`,
        '---',
        '',
        letter,
      ].join('\n');

      const ghRes = await ghPut(env.GITHUB_TOKEN, PRIVATE_REPO, filename, frontmatter,
        `letter: ${username} → ${unlock_date}`);

      if (!ghRes.ok) {
        const errBody = await ghRes.text();
        console.error('GitHub error:', ghRes.status, ghRes.statusText, errBody);
        return Response.json({ error: `保存失败 (${ghRes.status})，请联系管理员` }, { status: 500, headers: corsHeaders(origin) });
      }

      const emailRes = await sendEmail(
        env.RESEND_API_KEY,
        `📬 新的时光胶囊信件：${username}写给Yunze`,
        `<p><strong>${username}</strong> 刚写了一封信，将于 <strong>${unlock_date}</strong> 开封。</p>
         <p>标题：${title}</p>
         <p>文件：<code>${filename}</code></p>`
      );
      if (!emailRes.ok) {
        const emailErr = await emailRes.text();
        console.error('Email error:', emailRes.status, emailErr);
      }

      return Response.json({
        message: `信已寄出！将在 ${unlock_date} 开封。谢谢${username}的心意 💌`
      }, { headers: corsHeaders(origin) });
    }

    return new Response('Not Found', { status: 404 });
  }
};
