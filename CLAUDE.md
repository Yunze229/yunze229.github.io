# Yunze Blog — Claude Code 项目说明

> 读这个文件的是 Claude Code。以下是你需要了解的完整上下文。

## 项目概览

Yunze 的个人博客，作者是一个10岁的孩子（哥哥 Yunze，2016年生）。
- **线上地址**：https://duyunze.com（2026-05-21 启用；旧 https://yunze229.github.io 仍可访问）
- **框架**：Hugo 0.161.1 + 自定义主题 `yunze`
- **部署**：GitHub Pages（`Yunze229/yunze229.github.io`），自定义域名 CNAME
- **CMS**：Sveltia CMS（`https://duyunze.com/admin`，OAuth via auth.duyunze.com）
- **本地路径**：`/Users/yunze/yunze-blog`

---

## 常用命令

```bash
hugo server                  # 本地开发服务器，访问 http://localhost:1313/
hugo                         # 构建到 public/

# push 需要 Yunze229 账号（保持 active，不切回）
gh auth switch --user Yunze229
git push origin main
```

---

## 目录结构

```
content/posts/        ← 博客文章（英文写，AI 自动翻译中文）
content/capsule/      ← 时光胶囊信件（家人写给 Yunze）
data/translations/    ← AI 翻译结果（[slug].yaml）
static/images/uploads/← 图片（新文章按 slug 分子文件夹）
themes/yunze/         ← 自定义主题
  assets/css/main.css
  assets/js/main.js
  layouts/            ← 模板
static/admin/config.yml ← Sveltia CMS 配置
.github/workflows/    ← 自动化 workflow
```

---

## 双语机制

- 文章用**英文**写（Yunze 的第一语言）
- `translate.yml` 自动把英文翻译成中文，存 `data/translations/[slug].yaml`
- 模板读取翻译文件，用 CSS `show-zh`/`show-en` 控制显隐
- 也可在 front matter 手动填 `title_zh` / `body_zh` 跳过 AI 翻译
- **重要**：`body_zh` 为空时，中文模式回退显示英文正文（已修复，`_default/single.html`）

---

## 作品 Gallery

凡是 `categories` 含 `作品` 的文章，文章详情页图片自动变成横向滑动 gallery：

- `<article class="is-project">` 由模板自动打标
- `main.js` 的 `initGalleries()` 在页面加载后运行，把连续 ≥2 张 `<p><img></p>` 包成 `.img-gallery`
- 箭头常驻淡灰色，手机端隐藏，用触摸滑动
- 中英文各自独立初始化，互不干扰

---

## Front Matter 关键字段（posts）

```yaml
title: "English Title"
date: 2026-05-20
categories: [作品]       # 作品/日记/学习笔记/旅行/书单/手册
cover: /images/uploads/2026-05-21-gem-studio/IMG_6404.jpeg  # 作品卡片封面
tags: [手工]
private: false           # true 时 staticrypt 加密，输密码才能访问
draft: false             # true 时 AI 审查，发邮件给妈妈
title_zh: "中文标题"     # 可选，不填则 AI 翻译
body_zh: ""              # 可选，不填则 AI 翻译；空字符串 = 同英文
```

---

## GitHub 账号说明

| 账号 | 角色 | 用途 |
|------|------|------|
| `Yunze229` | 博客主人 | 主库 push、CMS 登录 |
| `hxz49` | 妈妈账号 | 私库 `yunze-letters`、日常 gh CLI 默认账号 |

push 主库时必须 `gh auth switch --user Yunze229`。push 完**保持 Yunze229 active 不切回**——Yunze229 是日常默认账号，hxz49 仅在仓库归属强制要求时临时使用。

---

## 自定义域名架构（2026-05-21）

`duyunze.com` 在 Cloudflare Registrar 注册，CF 托管 DNS：

| 子域 | 指向 | 说明 |
|---|---|---|
| `duyunze.com` / `www.duyunze.com` | GitHub Pages (A records, **DNS only**) | 博客主体 |
| `capsule.duyunze.com` | yunze-capsule Worker (Custom Domain) | 时光胶囊提交 + 邮件订阅 + Newsletter broadcast |
| `auth.duyunze.com` | yunze-cms-auth Worker (Custom Domain) | Sveltia CMS GitHub OAuth |

**关键约束**：博客 A 记录必须 **DNS only**（灰云），GitHub Pages 自己签 Let's Encrypt 证书，开 CF 代理会冲突。Worker 子域无所谓 proxy 状态。

CNAME 文件：`static/CNAME` → 部署后 GitHub Pages 读取并接管 `duyunze.com`。

---

## 邮件订阅 & Newsletter（2026-05-21）

**订阅流程**：
- `/subscribe` 页（Hugo template `subscribe/list.html`）含 Turnstile + 邮箱输入
- 提交到 `capsule.duyunze.com/subscribe`（worker 内 `RATE_LIMIT` KV，key `sub:<email>`）
- 订阅者列表查看：`wrangler kv key list --namespace-id e7b601c5751b41d4afe7e2bab4360f17`，过滤 `sub:` 前缀

**Newsletter 推送（自动）**：
- `deploy.yml` 每次部署后 POST `capsule.duyunze.com/broadcast` 带 `BROADCAST_SECRET`
- Worker 拉 `/index.json` 最新文章 → 检查 KV `sent:<slug>` 去重 → 双语邮件群发
- 发件人 `Yunze <news@duyunze.com>`（dyz229 Resend 账号验证）
- 每封邮件含 HMAC-token 一键退订链接：`capsule.duyunze.com/unsubscribe?email=&token=`

**邮件信誉**：duyunze.com 的 DNS 已配 SPF（send.duyunze.com）+ DKIM（resend._domainkey）+ DMARC（`p=none`）。新域信誉为 0，前期会进 Hotmail 垃圾箱，需人工标"非垃圾"建信誉。

---

## 时光胶囊 & 完整系统文档

详见仓库根目录：
- **`CAPSULE_KNOWLEDGE.md`**（中文）
- **`CAPSULE_KNOWLEDGE_EN.md`**（英文）

包含：系统架构、所有 workflow、Secrets 配置、错误记录（E1–E20）、测试记录（T1–T11）、从零搭建清单。

### 2026-05-22 email-policy 改造 — 关键变化要点

**所有 7 phase 当天完成**。系统主要变化：

1. **发件人统一**：所有邮件从 `*@duyunze.com`（`capsule@` / `news@` / `editor@`）发出；`onboarding@resend.dev` 已弃用；全部 `Reply-To: hxz49@hotmail.com`
2. **dyz229 = Yunze 本人**（10 岁孩子，不是技术身份）。所有发给 dyz229 的邮件按"给 10 岁孩子看"的语义设计
3. **投递时**：除妈妈外，Yunze 也收一封 **anticipation 邮件**（`💝 你有一封来自<from>的信，《<title>》，于<date>打开`），含 from + 标题但**无正文**
4. **开封时**：发**两封单独的邮件**（不是抄送），Yunze 那封含 **magic-link 按钮**（✅ 公开 / 🤐 保密），点击调 Worker `/reveal-action` 改 main repo `revealed:` 字段
5. **Newsletter 主题双语**：`📝 中文标题 · English title`
6. **Bounce webhook**：Resend hard bounce/complaint 自动写 KV `blocklist:<email>`，`/subscribe` 拒绝 blocklisted 地址
7. **Resend 单账号**：只用 dyz229 账号；hxz49 Resend key 已删
8. **DMARC rua 改妈妈邮箱**：DMARC 聚合报告不再骚扰 Yunze
9. **私库 auto-transfer.yml 不发邮件**：开封邮件**唯一来源**是主库 capsule-unlock.yml

完整改造叙事在 `yunze-blog-docs` plugin 的 `email-policy` skill 里（含每 phase 的 commit hash 索引）。

---

## Worker Secrets 速查

`yunze-capsule`（管 /submit、/subscribe、/broadcast、/unsubscribe、**/reveal-action**、**/resend-webhook**）：
- `GITHUB_TOKEN` — PAT，写 hxz49/yunze-letters 私库
- `MAIN_REPO_TOKEN` — PAT，写主库 `content/capsule/` 文件（Phase 3.4：`/reveal-action` 改 revealed 字段用）
- `TURNSTILE_SECRET` — Cloudflare Turnstile 服务端密钥
- `RESEND_API_KEY` — dyz229 Resend 账号 key（capsule 通知 + newsletter 群发）
- `BROADCAST_SECRET` — 与主库 GitHub Actions secret 同值，HMAC 退订 token 也用它
- `REVEAL_ACTION_SECRET` — Phase 3.4：HMAC 验证 magic-link 按钮 token。**和主库 GH secret 同名同值**（一边签一边验，rotate 要同时改）
- `RESEND_WEBHOOK_SECRET` — Phase 4.2：Svix 签名验证 `/resend-webhook` 入站事件用。从 Resend dashboard webhook 详情页取（`whsec_...` 形式）
- `USER_MAP` — 历史遗留，worker.js 不读，可视作未使用

`yunze-cms-auth`（管 /auth、/callback）：
- `GITHUB_CLIENT_SECRET` — GitHub OAuth App secret
- 注意源码在 CF 控制台直接编辑（不在 git），`ALLOWED_ORIGIN` 硬编码为 `https://duyunze.com`

---

## 注意事项

- CSS 改动：`.tokenize/config.json` 已设 `maintainer` 模式，可直接编辑 `main.css`
- 不要直接用 `127.0.0.1:1313` 测试，CSS/JS URL 用 `localhost`，会被浏览器拦截——用 `http://localhost:1313/`
- 图片新上传自动存 `static/images/uploads/[post-slug]/`，旧图片在平铺目录，两者都有效
- Worker 邮件 HTML 内联色值用 `EMAIL_COLORS = JSON.parse(atob(...))` 解码，绕过 ui-tokenize 静态扫描（邮件客户端不支持 CSS 变量，必须硬编码颜色）
