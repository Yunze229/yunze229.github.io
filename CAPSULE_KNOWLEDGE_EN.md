# Time Capsule + Blog System — Complete Knowledge Base

> **Email placeholder legend**
> - `ADMIN_EMAIL`: Mom's admin email (hxz49 account)
> - `NOTIFY_EMAIL`: Notification email (dyz229 account)

## 1. System Architecture

```
Family member submits form
    ▼
Cloudflare Worker (yunze-capsule.dyz229.workers.dev)
  Rate limiting + Turnstile bot verification
    ├──► hxz49/yunze-letters/letters/<slug>.md  [Private repo — invisible to Yunze]
    └──► Main repo content/capsule/<slug>.md    [Stub — no body content]

Daily at UTC 09:00 → capsule-unlock.yml
  unlock_date <= today AND transferred: false
    ├──► Write full content to main repo (read_by_admin: false, revealed: false)
    ├──► Send email to ADMIN_EMAIL + NOTIFY_EMAIL (with full Chinese + English body)
    └──► Mark private repo letter as transferred: true

CMS admin: read_by_admin: true → revealed: true → Published on blog
```

---

## 2. Workflows

| File | Trigger | Purpose |
|---|---|---|
| Private repo auto-transfer.yml | push(letters/**.md) + UTC 16:00 + dispatch | Sync private → main repo (stub or full) |
| capsule-unlock.yml | UTC 09:00 + dispatch | Write unlocked letters + send email |
| capsule-translate.yml | push(content/capsule/**.md) | Translate title_en / from_en / body_en |
| translate.yml | push(content/posts/**.md) | Translate English blog posts to Chinese |
| ai-review.yml | push to main (draft: true file) | Claude reviews draft → email |
| capsule-suppress.yml | push (capsule file deleted) | Auto-add deleted slug to suppression list |
| deploy.yml | push(main) | Hugo build + staticrypt encrypt private posts → GitHub Pages |

**Critical config in auto-transfer.yml:**
```yaml
concurrency:
  group: auto-transfer
  cancel-in-progress: false   # Prevents concurrent 409 conflicts; queues instead of cancelling
```

---

## 3. Prompts

### AI Draft Review (ai-review.yml)
```
You are a friendly writing assistant helping a 10-year-old child improve their blog post.
Please give 3–5 specific improvement suggestions in simple, easy-to-understand language, covering:
- Is the content clear and complete?
- Is the expression vivid and accurate?
- Are there areas that could be expanded?
- Is the structure clear?

Reply in Chinese, with an encouraging tone, like talking to a friend.

Article content: {content}
```
Model: claude-sonnet-4-6, max_tokens: 1024, result → NOTIFY_EMAIL

### Blog Post Translation (translate.yml)
```
Please translate the following English blog post into Chinese.
The author is a 10-year-old child — the translation should be natural and match how a child speaks.

Return strictly in this format, keeping the delimiters, adding nothing else:

TITLE: [translated title]

---BODY---
[translated body, preserving all Markdown formatting: **bold**, *italic*, ## headings.
Keep IMAGE_N_PLACEHOLDER tokens as-is — do not translate them.]
---END---

Original title: {title}

Original body:
{body_for_claude}
```
Model: claude-sonnet-4-6, max_tokens: 8192. Images are replaced with placeholders before sending and restored after.

### Capsule Letter Translation (capsule-translate.yml)
Translates letter title / sender / body → title_en / from_en / body_en.
Prompt is inlined in the workflow's Python script.

---

## 4. Bugs & Fixes

### E1: Worker email silently dropped
Cause: Fire-and-forget `fetch()` — Cloudflare terminates all pending async work after Response is returned
Fix: `ctx.waitUntil(sendEmail(...))` — keeps Worker alive until email completes

### E2: Form shows "Network error — Unexpected token '<'" (layer 1)
Cause: Hugo template `jsonify` escapes `/` to `\/` in Worker URL inside `<script>`, fetch sends broken URL, GitHub Pages returns HTML 404, `res.json()` fails parsing HTML
Fix: Move URL to `data-api` HTML attribute; JS reads it via `form.dataset.api`, bypassing Hugo's JS escaping

### E3: Form shows "Network error" (layer 2)
Cause: Worker rate-limiter `JSON.parse(raw)` had no try/catch; malformed KV data threw uncaught exception; Cloudflare returned HTML error page; `res.json()` failed again
Fix: Wrap entire fetch handler in top-level try/catch; all responses (including errors) return JSON + CORS headers

### E4: Cron shows green but nothing actually ran
Cause: (1) GitHub Actions free-tier crons often delay hours or skip; (2) `gh_put_file` failed silently with `exit(0)`
Fix: Return `(status, result)` tuple; print full HTTP response on failure; exit with `sys.exit(1)` so GitHub marks the run red

### E5: Concurrent runs produce HTTP 409 SHA mismatch (2026-05-20)
Cause: Two runs simultaneously GET the file SHA; one writes first (SHA advances); the other writes with stale SHA → 409
Fix: Add `concurrency` group to workflow; serializes execution

### E6: git push rejected — "fetch first" (5+ times)
Cause: Multiple writers (CMS auto-commit, workflow commit, local edits) writing same branch; push without prior pull
Fix: `git pull --rebase && git push`

### E7: git pull --rebase fails — "unstaged changes"
Cause: File edited by tool but not staged before rebase
Fix: `git add` the file first, then rebase

### E8: CMS guard blocks "Discard draft" dialog (iteration 1)
Cause: Guard used broad `button` selector, intercepting Discard button inside Sveltia CMS modal
Fix: Add dialog/modal exemption — clicks inside `<dialog>` or `.modal` pass through

### E9: CMS guard blocks date picker (iteration 2)
Cause: ARIA selector too broad; date picker's internal checkboxes also intercepted
Fix: Remove `button` matching; guard only targets `role="switch"`, `role="checkbox"`, `input[type=checkbox]`

### E10: CMS guard reads unlock_date from wrong source (iteration 3)
Cause: Guard read unlock_date from DOM; Sveltia CMS DOM structure is unstable
Fix: Read unlock_date from URL hash (Sveltia CMS routing) instead

### E11: CMS capsule collection missing fields
Cause: `config.yml` capsule collection only had `title` and `title_en`
Fix: Add all missing fields: body, body_en, revealed, read_by_admin, from, from_en, unlock_date, date

### E12: CMS `date` widget type deprecated
Symptom: Warning "deprecated Date field type is not supported"
Fix: `widget: date` → `widget: datetime` + `type: date`

### E13: title_en / from_en / body_en not written to transferred file
Cause: Script read English fields from main repo file, which doesn't exist on first transfer → empty fields
Fix: Read English fields from private repo source file first; main repo fields used only as override protection

### E14: Heatmap dates double-JSON-encoded
Cause: Hugo `jsonify` + automatic HTML-in-script escaping applied twice
Fix: Store dates in `<script type="application/json">` tag (Hugo doesn't escape this); read with `JSON.parse()` in JS

### E15: API Key exposed in chat
Action taken: Immediately warned to revoke; went to console.anthropic.com to invalidate old key; new key stored in GitHub Secrets

### E16: `gh workflow run` returns 403
Cause: `hxz49` is not an admin of the main repo `Yunze229/yunze229.github.io`
Fix: Trigger from GitHub Actions UI, or switch to `Yunze229` account

### E17: translate.yml push race with deploy.yml (found in T5, 2026-05-20)
Cause: translate.yml commits translation then immediately `git push`; races against concurrent deploy.yml push → rejected
Fix: Added `git pull --rebase` before `git push` in the "Commit translations" step (commit `855020a`)

### E18: T8 test design didn't match actual Worker
Cause: Docs described testing USER_MAP password auth, but actual Worker has no such mechanism; auth relies on Turnstile (was skipped when not configured; now active)
Fix: T8 redesigned to test field validation (missing fields → 400, bad date format → 400, valid → 200); docs corrected

### E19: nav-sync / capsule-translate / capsule-unlock missing git pull --rebase (found 2026-05-20 code audit)
Cause: E17 fixed translate.yml, but three other git-writing workflows (nav-sync.yml, capsule-translate.yml, capsule-unlock.yml) were not updated; nav-sync and capsule-translate trigger at the same time as deploy.yml — near-certain race
Fix: Added `git pull --rebase` before `git push` in all three workflows (commit `4293e6a`)

### E20: Worker missing /subscribe endpoint — newsletter form always returns 404 (found 2026-05-20 code audit)
Cause: subscribe/list.html newsletter form POSTs to `{capsule_api}/subscribe`, but Worker only handles `/submit` → 404
Fix: Added /subscribe POST endpoint to Worker — stores email in RATE_LIMIT KV (key=sub:{email}, permanent), returns "Already subscribed" for duplicates, sends admin notification email. Deployed via wrangler deploy (commit b334cf2, 2026-05-20)

---

## 5. Key Configuration

### Accounts & Repositories
- **Yunze229**: Main repo `yunze229.github.io` (blog owner)
- **hxz49**: Private repo `yunze-letters` (mom's account, letter storage)

### Secrets

| Location | Secret | Purpose |
|---|---|---|
| Main repo | ANTHROPIC_API_KEY | Translation + AI review |
| Main repo | RESEND_API_KEY_2 | ai-review → NOTIFY_EMAIL |
| Main repo | LETTERS_PAT | capsule-unlock access to private repo |
| Private repo | MAIN_REPO_TOKEN | auto-transfer writes to main repo |
| Private repo | RESEND_API_KEY | Unlock notification → ADMIN_EMAIL |
| Private repo | RESEND_API_KEY_2 | Unlock notification → NOTIFY_EMAIL |
| CF Worker | USER_MAP | Family member authentication |
| CF Worker | GITHUB_TOKEN | Write to private repo |
| CF Worker | RESEND_API_KEY | Submission notification email |

### Email Routing

| Event | Recipients |
|---|---|
| New letter submitted | ADMIN_EMAIL |
| Letter unlocked | ADMIN_EMAIL + NOTIFY_EMAIL |
| AI draft suggestions | NOTIFY_EMAIL only (hidden from Yunze) |

---

## 6. Test Records

### T1: Concurrent 409 fix (2026-05-20)
Method: Two rapid `gh workflow run` calls; expect second to queue, not run in parallel
Result: Both runs succeeded; no 409 errors ✅

### T2: Form end-to-end (2026-05-18/19)
Method: `curl` POST + browser form submission
Verify: Private repo gets new file → main repo gets stub → ADMIN_EMAIL receives notification
Result: Passed after fixing Worker email + Hugo URL escaping ✅

### T3: CMS guard behavior (2026-05-19, 3 iterations)
Method: Open /admin; try toggling switches during lock period, clicking Discard dialog, clicking date picker
Result: After iteration 3, guard only blocks target toggles without interfering with other UI ✅

### T4: Full letter lifecycle (locked → unlocked → revealed)
Method: Create letter with unlock_date = today; manually trigger capsule-unlock.yml
Verify: Main repo has full body → both inboxes receive email → CMS can toggle revealed
Result: Passed after fixing English field write bug ✅

### T5: Blog post translation (translate.yml)
Method: Push new English post to main
Verify: translate.yml runs → `data/translations/<slug>.yaml` created → Chinese title appears on blog
Result: ✅ Fixed
- Fix: Added `git pull --rebase` before push in "Commit translations" step (commit `855020a`)
- Translation API call succeeded; `data/translations/t5-translation-test.yaml` generated correctly
- Workflow completes with success; no push conflict

### T6: AI draft review (ai-review.yml)
Method: Push `draft: true` article directly to main (not a PR)
Verify: ai-review.yml triggers → NOTIFY_EMAIL receives writing suggestions email
Note: Trigger is push to main with draft:true file, not PR open
Result: ✅ Email sent (Resend id: 2d503068-b10e-4028-9a04-78b082d0c058)

### T7: Capsule letter translation (capsule-translate.yml)
Method: Manually trigger via workflow_dispatch
Verify: Capsule files gain title_en / from_en / body_en fields
Result: ✅ 1 translated (`[TRANSLATE] hoohoo-2028-02-29-...`), 3 skipped (`[SKIP] already translated`)

### T8: Worker field validation
**Note**: Current Worker has no password/USER_MAP mechanism; auth relies on Turnstile (bypassed when unconfigured).
Method: (1) Missing title → expect 400; (2) Bad date format → expect 400; (3) All fields valid → expect 200
Result: ✅ All three cases behaved as expected
- Missing field → `{"error":"请填写所有必填项 / All fields are required"}` (400)
- Bad format → `{"error":"日期格式错误 / Invalid date"}` (400)
- Valid → `{"message":"信已寄出，将于 2099-01-01 开封 / Letter sealed, opens 2099-01-01"}` (200)

### T9: Worker rate limiting
Method: 6 rapid POST requests from same IP within one minute
Result: ✅ Rate limit works, but note:
- **All requests count toward the limit, including ones that fail field validation**
- T8's 3 requests consumed 3 of the 5 allowed; T9 hit 429 on its 3rd request (cumulative total = 6)
- T9 requests 1–2: HTTP 200; requests 3–6: HTTP 429 `Too many requests, retry in ~43s`
- Window: 60s, limit: 5/IP (every request to /submit counts, not just successful ones)

### T10: Suppression list (capsule-suppress.yml)
Method: Delete a capsule file from main repo, push to main
Verify: capsule-suppress.yml triggers → static/capsule-suppressed.txt updated with deleted slug
Result: ✅ Full chain verified
- Log: `Deleted: ['t8ll7rmd-2099-01-01-t8uj0rltll7rmdfs1fli']`
- `Suppressed list updated (HTTP 200): + t8ll7rmd-2099-01-01-t8uj0rltll7rmdfs1fli`
- suppressed.txt updated on remote

### T11: Full CMS publish flow
Method: Wait for a real letter to unlock, then complete all steps in /admin:
1. Receive unlock email; confirm it includes full Chinese + English body
2. Open CMS → Time Capsule → find the letter
3. Toggle `read_by_admin` → true (guard allows this after unlock_date)
4. Toggle `revealed` → true
5. Save; wait for deploy.yml to finish
6. Open /capsule/ page; confirm full letter body is visible
Result: Pending manual test — a letter unlocks on 2026-05-21

---

## 7. Known Issues

| Priority | Issue |
|---|---|
| High | Capsule form inaccessible from mainland China (workers.dev blocked by GFW; need custom domain) |
| Medium | Cloudflare Turnstile not yet active (code ready; need to fill in site key + secret key) |
| Medium | Private articles not truly encrypted (direct URL access still works) |
| Low | Capsule anti-spam (candidates: allowlist + shared password) |
| Low | Growth timeline page (not yet built) |
| Low | Teach Yunze git basics (add / commit / push / open PR) |

---

## 8. API Configuration — Step by Step

> Follow this order when setting up from scratch.

---

### 8.1 Anthropic API Key

1. Go to https://console.anthropic.com → log in with dyz229 account
2. Left menu → **API Keys** → **Create Key**
3. Name it `yunze-blog`; copy the generated `sk-ant-api03-...`
4. Add to main repo Secrets (see 8.6): `ANTHROPIC_API_KEY`
5. **Security**: Key is shown only once — paste it into Secrets immediately; never save to a local file

---

### 8.2 Resend (hxz49 account) — Capsule emails

**Purpose**: New letter submission notification + unlock notification (sent to ADMIN_EMAIL)

1. Go to https://resend.com → sign up with ADMIN_EMAIL
2. Left menu → **API Keys** → **Create API Key**, name `yunze-capsule`, permission: **Full access**
3. Copy the key (`re_...`)
4. Add to private repo Secrets: `RESEND_API_KEY`
5. Add to Cloudflare Worker Secrets: `RESEND_API_KEY` (see 8.4)
6. **Sender domain**: Currently using `onboarding@resend.dev` (Resend test domain, no verification needed)
   - For a custom sender, go to **Domains** → Add Domain → follow DNS instructions

---

### 8.3 Resend (dyz229 account) — AI review emails

**Purpose**: AI draft suggestions sent to NOTIFY_EMAIL; unlock notifications CC'd to dyz229

1. Go to https://resend.com → sign up with NOTIFY_EMAIL (or log in to existing account)
2. Left menu → **API Keys** → **Create API Key**, name `yunze-ai-review`
3. Copy the key
4. Add to main repo Secrets: `RESEND_API_KEY_2`
5. Add to private repo Secrets: `RESEND_API_KEY_2`

---

### 8.4 Cloudflare Worker Setup

**Two Workers:**
- `yunze-capsule` (time capsule form) → yunze-capsule.dyz229.workers.dev
- `yunze-cms-auth` (CMS OAuth) → yunze-cms-auth.dyz229.workers.dev

#### Deploy yunze-capsule Worker

1. Go to https://dash.cloudflare.com → log in with dyz229 account
2. Left menu → **Workers & Pages** → **Create** → **Create Worker**
3. Name it `yunze-capsule`, click **Deploy**
4. Enter the Worker → **Edit Code** → paste contents of `static/capsule-worker/worker.js` → **Save and Deploy**

#### Add Worker Secrets

Worker → **Settings** → **Variables** → **Add variable** (type: **Secret**):

| Secret name | Value | Purpose |
|---|---|---|
| `RESEND_API_KEY` | hxz49's Resend key | Send submission notification email |
| `GITHUB_TOKEN` | hxz49 GitHub PAT (see 8.5) | Write to private repo letters/ |
| `USER_MAP` | JSON string (see format below) | Family member authentication |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret key (see 8.7) | Bot protection (active) |

**USER_MAP format:**
```json
{
  "Grandpa": "1234",
  "Grandma": "5678",
  "Dad": "9012",
  "Grandpa (mom's side)": "3456",
  "Grandma (mom's side)": "7890"
}
```
key = display name (shown in dropdown), value = last 4 digits of phone number

#### Bind KV (rate limit storage)

1. Left menu → **KV** → **Create namespace**, name `capsule-rate-limit`
2. Go back to Worker → **Settings** → **Bindings** → **Add binding**
3. Type: **KV Namespace**, variable name: `RATE_LIMIT_KV`, select the namespace just created

---

### 8.5 GitHub Personal Access Tokens (PATs)

Three PATs are needed for cross-repo write access.

#### PAT 1: MAIN_REPO_TOKEN (used by private repo to write main repo)

1. Log in to **Yunze229** GitHub account
2. Avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
3. Configure:
   - Token name: `capsule-main-repo-write`
   - Expiration: **No expiration** (or 1 year; renew when expired)
   - Resource owner: **Yunze229**
   - Repository access: **Only select repositories** → select `yunze229.github.io`
   - Permissions → **Contents**: **Read and write**
4. Click **Generate token**, copy the token
5. Add to **private repo** `hxz49/yunze-letters` Secrets: `MAIN_REPO_TOKEN`

#### PAT 2: LETTERS_PAT (used by main repo to read private repo)

1. Log in to **hxz49** GitHub account
2. Same path → **Fine-grained tokens** → **Generate new token**
3. Configure:
   - Token name: `capsule-letters-read`
   - Resource owner: **hxz49**
   - Repository access: select `yunze-letters`
   - Permissions → **Contents**: **Read and write** (needed to write transferred: true)
4. Copy the token
5. Add to **main repo** `Yunze229/yunze229.github.io` Secrets: `LETTERS_PAT`

#### PAT 3: GITHUB_TOKEN (used by Cloudflare Worker to write private repo)

1. Log in to **hxz49** account
2. Create Fine-grained token, repository: `yunze-letters`, permission: Contents **Read and write**
3. Copy and add to Cloudflare Worker Secrets: `GITHUB_TOKEN`

---

### 8.6 How to Add GitHub Secrets

#### Main repo (Yunze229/yunze229.github.io)
1. Go to https://github.com/Yunze229/yunze229.github.io
2. **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Secrets to add:
| Secret name | Source |
|---|---|
| `ANTHROPIC_API_KEY` | 8.1 |
| `RESEND_API_KEY_2` | 8.3 (dyz229 account) |
| `LETTERS_PAT` | 8.5 PAT2 |

#### Private repo (hxz49/yunze-letters)
1. Go to https://github.com/hxz49/yunze-letters
2. Same path as above

Secrets to add:
| Secret name | Source |
|---|---|
| `MAIN_REPO_TOKEN` | 8.5 PAT1 |
| `RESEND_API_KEY` | 8.2 (hxz49 account) |
| `RESEND_API_KEY_2` | 8.3 (dyz229 account) |

---

### 8.7 Cloudflare Turnstile (Pending Activation)

**Current status**: Worker code is complete; site key and secret key not yet filled in; Turnstile check is skipped.

Steps to activate:
1. Go to https://dash.cloudflare.com → **Turnstile** → **Add site**
2. Site name: `yunze-capsule`, Domain: `dyz229.workers.dev` (or custom domain once bound)
3. Widget type: **Managed** (automatic bot detection)
4. Click **Create** → you get two values:
   - **Site Key** (public) → add to `hugo.toml`: `turnstile_site_key = "0x4AAAA..."`
   - **Secret Key** (private) → add to Cloudflare Worker Secrets: `TURNSTILE_SECRET`
5. Redeploy the Worker

---

### 8.8 Sveltia CMS OAuth (Cloudflare Worker)

**Purpose**: GitHub OAuth login for the CMS at `/admin`

**Worker**: `yunze-cms-auth` (yunze-cms-auth.dyz229.workers.dev)

1. **Create GitHub OAuth App**:
   - Log in to Yunze229 account → Settings → Developer settings → **OAuth Apps** → **New OAuth App**
   - Application name: `yunze-cms`
   - Homepage URL: `https://yunze229.github.io`
   - Callback URL: `https://yunze-cms-auth.dyz229.workers.dev/callback`
   - Click **Register** → get Client ID and Client Secret

2. **Add to CMS Auth Worker Secrets**:
   - `GITHUB_CLIENT_ID`: Client ID from above
   - `GITHUB_CLIENT_SECRET`: Client Secret from above

3. **Configure in hugo.toml**:
```toml
[params]
  cms_backend = "https://yunze-cms-auth.dyz229.workers.dev"
```

---

### 8.9 From-Scratch Setup Checklist

Complete in order; check off each step:

- [ ] 8.1 Anthropic API Key → main repo ANTHROPIC_API_KEY
- [ ] 8.2 Resend hxz49 account → private repo RESEND_API_KEY + Worker RESEND_API_KEY
- [ ] 8.3 Resend dyz229 account → main repo RESEND_API_KEY_2 + private repo RESEND_API_KEY_2
- [ ] 8.5 PAT1 (MAIN_REPO_TOKEN) → private repo Secret
- [ ] 8.5 PAT2 (LETTERS_PAT) → main repo Secret
- [ ] 8.5 PAT3 (Worker GITHUB_TOKEN) → Cloudflare Worker Secret
- [ ] 8.4 Create KV namespace capsule-rate-limit; bind to Worker
- [ ] 8.4 Fill in USER_MAP (family names + last 4 digits of phone) → Worker Secret
- [ ] 8.4 Deploy yunze-capsule Worker
- [ ] 8.8 Create GitHub OAuth App; deploy yunze-cms-auth Worker
- [x] 8.7 Activate Turnstile (done 2026-05-20)
- [ ] Verify: submit test letter → private repo gets file → main repo gets stub → email received
