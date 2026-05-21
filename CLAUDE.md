# Yunze Blog — Claude Code 项目说明

> 读这个文件的是 Claude Code。以下是你需要了解的完整上下文。

## 项目概览

Yunze 的个人博客，作者是一个10岁的孩子（哥哥 Yunze，2016年生）。
- **线上地址**：https://yunze229.github.io
- **框架**：Hugo 0.161.1 + 自定义主题 `yunze`
- **部署**：GitHub Pages（`Yunze229/yunze229.github.io`）
- **CMS**：Sveltia CMS（`/admin`，Cloudflare OAuth）
- **本地路径**：`/Users/yunze/yunze-blog`

---

## 常用命令

```bash
hugo server                  # 本地开发服务器，访问 http://localhost:1313/
hugo                         # 构建到 public/

# push 需要切换账号
gh auth switch --user Yunze229
git push origin main
gh auth switch --user hxz49   # 用完切回
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

push 主库时必须 `gh auth switch --user Yunze229`，操作完切回 `hxz49`。

---

## 时光胶囊 & 完整系统文档

详见仓库根目录：
- **`CAPSULE_KNOWLEDGE.md`**（中文）
- **`CAPSULE_KNOWLEDGE_EN.md`**（英文）

包含：系统架构、所有 workflow、Secrets 配置、错误记录（E1–E20）、测试记录（T1–T11）、从零搭建清单。

---

## 注意事项

- CSS 改动：`.tokenize/config.json` 已设 `maintainer` 模式，可直接编辑 `main.css`
- 不要直接用 `127.0.0.1:1313` 测试，CSS/JS URL 用 `localhost`，会被浏览器拦截——用 `http://localhost:1313/`
- 图片新上传自动存 `static/images/uploads/[post-slug]/`，旧图片在平铺目录，两者都有效
