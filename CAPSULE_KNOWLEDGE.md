# 时光胶囊 + 博客系统完整知识库

## 一、系统架构

```
家人提交表单
    ▼
Cloudflare Worker (yunze-capsule.dyz229.workers.dev)
  验证身份(USER_MAP) + 速率限制 + Turnstile
    ├──► hxz49/yunze-letters/letters/<slug>.md  【私库，Yunze不可见】
    └──► 主库 content/capsule/<slug>.md  【stub，无正文】

每天 UTC 09:00 → capsule-unlock.yml
  unlock_date<=today AND transferred:false
    ├──► 写完整内容到主库 (read_by_admin:false, revealed:false)
    ├──► 发邮件 hxz49@hotmail.com + dyz229@outlook.com (含中英文正文)
    └──► 私库标记 transferred:true

CMS 管理员：read_by_admin:true → revealed:true → 公开
```

---

## 二、所有 Workflow

| 文件 | 触发 | 作用 |
|---|---|---|
| 私库 auto-transfer.yml | push(letters/**.md) + UTC16:00 + dispatch | 私库→主库同步 stub/full |
| capsule-unlock.yml | UTC 09:00 + dispatch | 到期信件写主库+发邮件 |
| capsule-translate.yml | push(content/capsule/**.md) | 翻译 title_en/from_en/body_en |
| translate.yml | push(content/posts/**.md) | 博客文章英→中翻译 |
| ai-review.yml | PR opened（draft:true） | Claude 审查草稿→邮件 |
| capsule-suppress.yml | push（capsule文件被删） | 自动加入屏蔽名单 |
| deploy.yml | push(main) | Hugo 构建→GitHub Pages |

**auto-transfer.yml 关键配置：**
```yaml
concurrency:
  group: auto-transfer
  cancel-in-progress: false   # 防并发 409，后来的排队不取消
```

---

## 三、所有提示词

### AI 草稿建议（ai-review.yml）
```
你是一个友善的写作助手，帮助一个10岁的孩子改善他的博客文章。
请用简单易懂的语言给出3-5条具体的改进建议，包括：
- 内容是否清晰完整
- 表达是否准确生动
- 有没有可以展开的地方
- 结构是否清晰

用中文回复，语气要鼓励，像朋友一样说话。

文章内容：{content}
```
模型：claude-sonnet-4-6，max_tokens:1024，结果→dyz229@outlook.com

### 博客文章翻译（translate.yml）
```
请将以下英文博客文章翻译成中文。博客作者是一个10岁的孩子，翻译要自然、符合小孩说话方式。

严格按以下格式返回，保留分隔符，不要添加其他内容：

TITLE: [翻译后的标题]

---BODY---
[翻译后的正文，保持所有Markdown格式不变。IMAGE_N_PLACEHOLDER 原样保留。]
---END---

原文标题: {title}
原文正文: {body_for_claude}
```
模型：claude-sonnet-4-6，max_tokens:8192，图片先替换占位符再还原

### 时光胶囊信件翻译（capsule-translate.yml）
翻译 title/from/body → title_en/from_en/body_en，prompt 内联在 workflow Python 脚本中。

---

## 四、所有错误与修正

### E1：Worker 邮件静默丢弃
根因：fire-and-forget fetch()，Response 返回后 Cloudflare 立即终止异步
修正：ctx.waitUntil(sendEmail(...))

### E2：表单报"网络错误 Unexpected token '<'"（第一层）
根因：Hugo 模板 jsonify 把 URL 里的 / 转义成 \/，fetch 发往错误地址，收到 HTML 404，json() 失败
修正：URL 改放 data-api HTML 属性，JS 用 form.dataset.api 读取

### E3：表单报"网络错误"（第二层）
根因：Worker 速率限制 JSON.parse(raw) 无 try/catch，KV 异常→Cloudflare 返回 HTML→json() 再次失败
修正：整个 fetch handler 加顶层 try/catch，所有响应均返回 JSON + CORS headers

### E4：cron 绿灯但实际未执行
根因：(1) GitHub Actions 免费仓库 cron 常延迟/跳过；(2) gh_put_file 失败时 exit(0) 静默
修正：返回 (status,result) 元组，失败打印完整响应，最终 sys.exit(1) 标红

### E5：并发 run 产生 HTTP 409 SHA mismatch（2026-05-20）
根因：两个 run 同时 GET SHA，一个先写成功后 SHA 变了，另一个用旧 SHA 写 → 409
修正：加 concurrency group，串行化执行

### E6：git push 被拒"fetch first"（5+次）
根因：多方（CMS/workflow/本地）同时写同一分支，push 前未 pull
修正：git pull --rebase && git push

### E7：git pull --rebase 报"unstaged changes"
根因：Edit 修改文件后未 stage 直接 rebase
修正：先 git add 再 rebase

### E8：CMS 守卫阻断"放弃草稿"对话框（迭代1）
根因：守卫用 button 选择器，modal 里的 Discard 按钮也被拦截
修正：加 dialog/modal 豁免，点击在对话框内直接放行

### E9：CMS 守卫阻断日期选择器（迭代2）
根因：ARIA 选择器太宽，日期选择器内 checkbox 被拦截
修正：移除 button 匹配，只保留 role="switch/checkbox" + input[type=checkbox]

### E10：CMS 守卫读 unlock_date 位置错误（迭代3）
根因：从 DOM 读字段，Sveltia CMS DOM 结构不稳定
修正：改从 URL hash（Sveltia 路由）读取

### E11：CMS capsule 集合字段缺失
根因：config.yml capsule 集合只有 title/title_en
修正：补全 body/body_en/revealed/read_by_admin/from/from_en/unlock_date/date

### E12：CMS date 字段已废弃
现象：警告 "deprecated Date field type"
修正：widget:date → widget:datetime + type:date

### E13：title_en/from_en/body_en 未写入转移文件
根因：脚本从主库读英文字段，第一次转移时主库文件不存在→字段为空
修正：英文字段优先从私库源文件读，主库字段只作覆盖保护

### E14：热力图日期双重 JSON 编码
根因：Hugo jsonify + HTML-in-script 自动转义叠加
修正：改用 <script type="application/json"> 标签存数据，JS 用 JSON.parse() 读

### E15：API Key 泄露
处置：立即提示撤销，console.anthropic.com 废弃旧 Key，新 Key 存 GitHub Secrets

### E16：gh workflow run 报 403
根因：hxz49 不是主库管理员
修正：从 GitHub Actions UI 触发，或切换 Yunze229 账号

---

## 五、关键配置

### 账号与仓库
- Yunze229：主库 yunze229.github.io（博客主人）
- hxz49：私库 yunze-letters（妈妈账号）

### Secrets
| 位置 | Secret | 用途 |
|---|---|---|
| 主库 | ANTHROPIC_API_KEY | 翻译+AI审查 |
| 主库 | RESEND_API_KEY_2 | ai-review→dyz229 |
| 主库 | LETTERS_PAT | unlock 访问私库 |
| 私库 | MAIN_REPO_TOKEN | auto-transfer 写主库 |
| 私库 | RESEND_API_KEY | 开封→hxz49 |
| 私库 | RESEND_API_KEY_2 | 开封→dyz229 |
| CF Worker | USER_MAP | 家人认证 |
| CF Worker | GITHUB_TOKEN | 写私库 |
| CF Worker | RESEND_API_KEY | 提交通知 |

### 邮件路由
| 事件 | 收件人 |
|---|---|
| 新信件提交 | hxz49@hotmail.com |
| 信件到期开封 | hxz49 + dyz229@outlook.com |
| AI 草稿建议 | dyz229@outlook.com（不让 Yunze 看） |

---

## 六、测试记录

### T1：并发409修复（2026-05-20）
方法：连续两次 gh workflow run；预期：第一个running，第二个pending
结果：两个 run 均 success，无 409 ✅

### T2：表单提交端到端（2026-05-18/19）
方法：curl POST + 浏览器表单
验证：私库新文件 → 主库 stub → hxz49 收到邮件
结果：修复 Worker + Hugo URL 转义后 ✅

### T3：CMS 守卫行为（2026-05-19，迭代3次）
方法：打开 /admin，测试锁定期切换开关、Discard 对话框、日期选择器
结果：第3次迭代后守卫只拦目标开关 ✅

### T4：信件全流程（锁定→到期→开封）
方法：创建 unlock_date=今天 的测试信件，手动触发 capsule-unlock.yml
验证：主库包含正文 → 两个邮箱收信 → CMS 可切换 revealed
结果：修复英文字段写入 bug 后 ✅

---

## 七、待解决

| 优先级 | 问题 |
|---|---|
| 高 | 时光胶囊表单大陆可访问（workers.dev 被 GFW 封，需绑自定义域名） |
| 中 | Cloudflare Turnstile 激活（代码已写，需填 site key + secret key） |
| 中 | 私密文章真正加密（现在直接输 URL 可访问） |
| 低 | 时光胶囊防乱写（候选：白名单+共享密码） |
| 低 | 成长时间轴页面 |
| 低 | 教 yunze 用 git |
