# 时光胶囊 + 博客系统完整知识库

> **邮箱占位符说明**
> - `ADMIN_EMAIL`：妈妈管理员邮箱（hxz49 账号）
> - `NOTIFY_EMAIL`：通知邮箱（dyz229 账号）

## 一、系统架构

```
家人提交表单
    ▼
Cloudflare Worker (yunze-capsule.dyz229.workers.dev)
  速率限制 + Turnstile 人机验证
    ├──► hxz49/yunze-letters/letters/<slug>.md  【私库，Yunze不可见】
    └──► 主库 content/capsule/<slug>.md  【stub，无正文】

每天 UTC 09:00 → capsule-unlock.yml
  unlock_date<=today AND transferred:false
    ├──► 写完整内容到主库 (read_by_admin:false, revealed:false)
    ├──► 发邮件 ADMIN_EMAIL + NOTIFY_EMAIL (含中英文正文)
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
| deploy.yml | push(main) | Hugo 构建 + private:true 文章 staticrypt 加密 → GitHub Pages |

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
模型：claude-sonnet-4-6，max_tokens:1024，结果→NOTIFY_EMAIL

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

### E17：translate.yml git push 被并发 deploy.yml 抢先（T5 测试发现，2026-05-20）
根因：translate.yml 翻译完成后直接 `git push`，与同时触发的 deploy.yml 竞争，push 被拒（fetch first）
修正：translate.yml 的 "Commit translations" 步骤加 `git pull --rebase`，先同步再推送（commit `855020a`）

### E18：T8 设计文档与实际 Worker 不符
根因：文档描述 T8 测试 USER_MAP 密码认证，但实际 Worker 代码无此机制；认证靠 Turnstile（当时未激活则放行，现已激活）
修正：T8 改为测字段校验（缺必填字段→400，格式错误→400，正确→200），文档同步更正

### E19：nav-sync / capsule-translate / capsule-unlock 缺 git pull --rebase（2026-05-20 代码审查发现）
根因：E17 修了 translate.yml，但另外三个写 git 的 workflow（nav-sync.yml、capsule-translate.yml、capsule-unlock.yml）未同步修正，仍是直接 `git push`；nav-sync 和 capsule-translate 与 deploy.yml 同时触发，必然竞争
修正：三个 workflow 的 commit 步骤均加 `git pull --rebase`（commit `4293e6a`）

### E20：Worker 缺少 /subscribe 端点，订阅表单永远 404（2026-05-20 代码审查发现）
根因：subscribe/list.html 中的 newsletter 表单向 `{capsule_api}/subscribe` 发 POST，但 Worker 只有 `/submit`，返回 404
修正：Worker 加 /subscribe POST 端点，邮箱存 RATE_LIMIT KV（key=sub:{email}，永久），重复订阅返回"已订阅"，新订阅发邮件通知 NOTIFY_EMAIL（commit b334cf2，2026-05-20 wrangler deploy 生效）

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
| 新信件提交 | ADMIN_EMAIL |
| 信件到期开封 | hxz49 + NOTIFY_EMAIL |
| AI 草稿建议 | NOTIFY_EMAIL（不让 Yunze 看） |

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

### T5：博客文章翻译（translate.yml）
方法：在 content/posts/ 新建英文文章，commit push 到 main
验证：Actions 页查看 translate.yml 运行 → data/translations/<slug>.yaml 生成 → 博客页面中文标题显示正常
预期日志：`Saved: data/translations/xxx.yaml`
结果：✅ 已修复
- 修复：translate.yml 的 "Commit translations" 步骤加了 `git pull --rebase`（commit `855020a`）
- 翻译 API 调用成功，`data/translations/t5-translation-test.yaml` 正确生成
- 修复后 workflow 以 success 完成，无 push 冲突

### T6：AI 草稿建议（ai-review.yml）
方法：新建 draft:true 的文章，push 到 main（不是开 PR，是直接 push）
验证：ai-review.yml 触发 → NOTIFY_EMAIL 收到"📝 AI 草稿建议"邮件，含建议内容
注意：触发条件是 push to main + draft:true，不是 PR
结果：✅ 邮件成功发出（Resend id: 2d503068-b10e-4028-9a04-78b082d0c058）

### T7：时光胶囊信件翻译（capsule-translate.yml）
方法：手动触发 capsule-translate.yml（workflow_dispatch）
验证：content/capsule/ 下信件文件新增 title_en / from_en / body_en 字段
预期日志：`[TRANSLATE] xxx.md`
结果：✅ 1 封翻译（`[TRANSLATE] hoohoo-2028-02-29-...`），3 封已跳过（`[SKIP] already translated`）

### T8：Worker 字段校验
**注意**：当前 Worker 无密码/USER_MAP 机制，认证靠 Turnstile（已激活，TURNSTILE_SECRET 已配置）。T8 测字段校验和格式校验。
方法：(1) 缺 title 字段 → 期望 400；(2) unlock_date 格式错误 → 期望 400；(3) 所有字段正确 → 期望 200
结果：✅ 三种情况全部符合预期
- 缺字段 → `{"error":"请填写所有必填项 / All fields are required"}` (400)
- 格式错误 → `{"error":"日期格式错误 / Invalid date"}` (400)
- 正确 → `{"message":"信已寄出，将于 2099-01-01 开封 / Letter sealed, opens 2099-01-01"}` (200)
### T9：Worker 速率限制
方法：同一 IP 1分钟内连续发送 6 次提交
结果：✅ 速率限制生效，但触发时机需注意：
- **速率限制对所有请求计数，包括字段校验失败的请求**
- T8 测试消耗了 3 次计数，T9 从第 3 次起触发 429（累计已达 5 次上限）
- T9 第1-2次：HTTP 200 成功；第3-6次：HTTP 429 `请求过于频繁，请 ~43 秒后再试`
- 窗口期：60 秒，上限：5次/IP（所有到达 /submit 的请求都计数，非仅成功请求）
### T10：屏蔽名单（capsule-suppress.yml）
方法：删除 content/capsule/t8ll7rmd-2099-01-01-...md，push 到 main
验证：capsule-suppress.yml 触发 → static/capsule-suppressed.txt 新增 slug
结果：✅ 全链路通过
- workflow 日志：`Deleted: ['t8ll7rmd-2099-01-01-t8uj0rltll7rmdfs1fli']`
- `Suppressed list updated (HTTP 200): + t8ll7rmd-2099-01-01-t8uj0rltll7rmdfs1fli`
- suppressed.txt 远端已更新

### T11：CMS 完整公开流程
方法：等一封信件到期开封后，在 /admin 完整走一遍：
1. 收到开封邮件，确认包含中英文正文
2. 打开 CMS → 时光胶囊 → 找到该信件
3. 切换 `read_by_admin` → true（守卫允许，因为 unlock_date 已过）
4. 切换 `revealed` → true
5. 保存，等待 deploy.yml 完成
6. 打开博客 /capsule/ 页面，确认信件全文可见
验证：六步全部通过，公开后信件在博客正确显示
结果：需等真实信件到期后手动测试（2026-05-21 有一封到期）


---

## 七、待解决

| 优先级 | 问题 |
|---|---|
| 高 | 时光胶囊表单大陆可访问（workers.dev 被 GFW 封，需绑自定义域名） |
| ✅ | Cloudflare Turnstile 已激活（site key 在 hugo.toml，TURNSTILE_SECRET 已加到 Worker，2026-05-20） |
| ✅ | 私密文章 staticrypt 加密（deploy.yml 构建后自动加密，直接输 URL 弹密码框，密码存 PRIVATE_PASS Secret，2026-05-20） |
| 低 | 时光胶囊防乱写（候选：白名单+共享密码） |
| 低 | 成长时间轴页面 |
| 低 | 教 yunze 用 git |

---

## 八、API 配置详细步骤

> 从零搭建时，按此顺序操作。

---

### 8.1 Anthropic API Key

1. 打开 https://console.anthropic.com → 登录 dyz229 账号
2. 左侧菜单 → **API Keys** → **Create Key**
3. 名称填 `yunze-blog`，复制生成的 `sk-ant-api03-...`
4. 添加到主库 Secrets（见 8.6）：`ANTHROPIC_API_KEY`
5. **安全提示**：Key 只显示一次，立即粘贴到 Secrets，不要存本地文件

---

### 8.2 Resend（hxz49 账号）——时光胶囊邮件

**用途**：新信件提交通知 + 开封通知（发往 ADMIN_EMAIL）

1. 打开 https://resend.com → 用 ADMIN_EMAIL 注册
2. 左侧 **API Keys** → **Create API Key**，名称 `yunze-capsule`，权限选 **Full access**
3. 复制 Key（`re_...`）
4. 添加到私库 Secrets：`RESEND_API_KEY`
5. 添加到 Cloudflare Worker Secrets：`RESEND_API_KEY`（见 8.4）
6. **发件域名**：目前用 `onboarding@resend.dev`（Resend 测试域名，无需验证）
   - 如需自定义发件人，左侧 **Domains** → Add Domain → 按提示加 DNS 记录

---

### 8.3 Resend（dyz229 账号）——AI审查邮件

**用途**：AI 草稿建议发往 NOTIFY_EMAIL，开封通知抄送 dyz229

1. 打开 https://resend.com → 用 NOTIFY_EMAIL 注册（或已有账号登录）
2. 左侧 **API Keys** → **Create API Key**，名称 `yunze-ai-review`
3. 复制 Key
4. 添加到主库 Secrets：`RESEND_API_KEY_2`
5. 添加到私库 Secrets：`RESEND_API_KEY_2`

---

### 8.4 Cloudflare Worker 配置

**两个 Worker**：
- `yunze-capsule`（时光胶囊表单）→ yunze-capsule.dyz229.workers.dev
- `yunze-cms-auth`（CMS OAuth）→ yunze-cms-auth.dyz229.workers.dev

#### 部署 yunze-capsule Worker

1. 打开 https://dash.cloudflare.com → 登录 dyz229 账号
2. 左侧 **Workers & Pages** → **Create** → **Create Worker**
3. 名称填 `yunze-capsule`，点 **Deploy**
4. 进入 Worker → **Edit Code** → 粘贴 `static/capsule-worker/worker.js` 的内容 → **Save and Deploy**

#### 添加 Worker Secrets

进入 Worker → **Settings** → **Variables** → **Add variable**（类型选 **Secret**）：

| Secret 名 | 值 | 说明 |
|---|---|---|
| `RESEND_API_KEY` | hxz49 账号的 Resend Key | 发提交通知邮件 |
| `GITHUB_TOKEN` | hxz49 的 GitHub PAT（见 8.5） | 写私库 letters/ |
| `USER_MAP` | JSON 字符串（见下方格式） | 家人身份认证 |
| `TURNSTILE_SECRET` | Cloudflare Turnstile 密钥（见 8.7） | 防机器人（已激活） |

**USER_MAP 格式**：
```json
{
  "爷爷": "1234",
  "奶奶": "5678",
  "爸爸": "9012",
  "外公": "3456",
  "外婆": "7890"
}
```
key = 姓名（下拉选项），value = 手机末4位

#### 绑定 KV（速率限制存储）

1. 左侧 **KV** → **Create namespace**，名称 `capsule-rate-limit`
2. 回到 Worker → **Settings** → **Bindings** → **Add binding**
3. 类型选 **KV Namespace**，变量名填 `RATE_LIMIT_KV`，选刚创建的 namespace

---

### 8.5 GitHub Personal Access Tokens（PAT）

需要创建两个 PAT，分别用于两个方向的跨库写入。

#### PAT 1：MAIN_REPO_TOKEN（私库用，写主库）

1. 登录 **Yunze229** GitHub 账号
2. 右上角头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
3. 配置：
   - Token name：`capsule-main-repo-write`
   - Expiration：**No expiration**（或1年，到期后需更新）
   - Resource owner：**Yunze229**
   - Repository access：**Only select repositories** → 选 `yunze229.github.io`
   - Permissions → **Contents**：**Read and write**
4. 点 **Generate token**，复制 token
5. 添加到 **私库** `hxz49/yunze-letters` Secrets：`MAIN_REPO_TOKEN`

#### PAT 2：LETTERS_PAT（主库用，读私库）

1. 登录 **hxz49** GitHub 账号
2. 同上路径 → **Fine-grained tokens** → **Generate new token**
3. 配置：
   - Token name：`capsule-letters-read`
   - Resource owner：**hxz49**
   - Repository access：选 `yunze-letters`
   - Permissions → **Contents**：**Read and write**（需要写 transferred:true）
4. 复制 token
5. 添加到 **主库** `Yunze229/yunze229.github.io` Secrets：`LETTERS_PAT`

#### PAT 3：Cloudflare Worker 用的 GITHUB_TOKEN

1. 登录 **hxz49** 账号
2. 创建 Fine-grained token，仓库选 `yunze-letters`，权限 Contents: **Read and write**
3. 复制后添加到 Cloudflare Worker Secrets：`GITHUB_TOKEN`

---

### 8.6 GitHub Secrets 添加方法

#### 主库（Yunze229/yunze229.github.io）
1. 打开 https://github.com/Yunze229/yunze229.github.io
2. **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

需要添加的 Secrets：
| Secret 名 | 来源 |
|---|---|
| `ANTHROPIC_API_KEY` | 8.1 |
| `RESEND_API_KEY_2` | 8.3（dyz229 账号） |
| `LETTERS_PAT` | 8.5 PAT2 |

#### 私库（hxz49/yunze-letters）
1. 打开 https://github.com/hxz49/yunze-letters
2. 同上路径

需要添加的 Secrets：
| Secret 名 | 来源 |
|---|---|
| `MAIN_REPO_TOKEN` | 8.5 PAT1 |
| `RESEND_API_KEY` | 8.2（hxz49 账号） |
| `RESEND_API_KEY_2` | 8.3（dyz229 账号） |

---

### 8.7 Cloudflare Turnstile（已激活）

**当前状态**：已激活。site key 在 hugo.toml，TURNSTILE_SECRET 已加到 Worker，两个表单（/submit + /subscribe）均需通过验证。

激活步骤：
1. 打开 https://dash.cloudflare.com → **Turnstile** → **Add site**
2. Site name：`yunze-capsule`，Domain：`dyz229.workers.dev`（或绑定的自定义域名）
3. Widget type：**Managed**（自动判断人机）
4. 点 **Create** → 得到两个值：
   - **Site Key**（公开）→ 填入 `hugo.toml`：`turnstile_site_key = "0x4AAAA..."`
   - **Secret Key**（私密）→ 添加到 Cloudflare Worker Secrets：`TURNSTILE_SECRET`
5. 重新部署 Worker

---

### 8.8 Sveltia CMS OAuth（Cloudflare Worker）

**用途**：CMS 后台 `/admin` 登录用 GitHub OAuth

**Worker**：`yunze-cms-auth`（yunze-cms-auth.dyz229.workers.dev）

1. **创建 GitHub OAuth App**：
   - 登录 Yunze229 账号 → Settings → Developer settings → **OAuth Apps** → **New OAuth App**
   - Application name：`yunze-cms`
   - Homepage URL：`https://yunze229.github.io`
   - Callback URL：`https://yunze-cms-auth.dyz229.workers.dev/callback`
   - 点 **Register** → 得到 Client ID 和 Client Secret

2. **添加到 CMS Auth Worker Secrets**：
   - `GITHUB_CLIENT_ID`：上一步的 Client ID
   - `GITHUB_CLIENT_SECRET`：上一步的 Client Secret

3. **hugo.toml 中配置**：
```toml
[params]
  cms_backend = "https://yunze-cms-auth.dyz229.workers.dev"
```

---

### 8.9 从零搭建检查清单

按顺序操作，每步完成打勾：

- [ ] 8.1 Anthropic API Key → 主库 ANTHROPIC_API_KEY
- [ ] 8.2 Resend hxz49 账号 → 私库 RESEND_API_KEY + Worker RESEND_API_KEY
- [ ] 8.3 Resend dyz229 账号 → 主库 RESEND_API_KEY_2 + 私库 RESEND_API_KEY_2
- [ ] 8.5 PAT1（MAIN_REPO_TOKEN）→ 私库 Secret
- [ ] 8.5 PAT2（LETTERS_PAT）→ 主库 Secret
- [ ] 8.5 PAT3（Worker GITHUB_TOKEN）→ Cloudflare Worker Secret
- [ ] 8.4 创建 KV namespace capsule-rate-limit，绑定到 Worker
- [ ] 8.4 填写 USER_MAP（家人名单+手机末4位）→ Worker Secret
- [ ] 8.4 部署 yunze-capsule Worker
- [ ] 8.8 创建 GitHub OAuth App，部署 yunze-cms-auth Worker
- [x] 8.7 激活 Turnstile（已完成 2026-05-20）
- [ ] 验证：提交测试信件 → 私库出现文件 → 主库出现 stub → 收到邮件
