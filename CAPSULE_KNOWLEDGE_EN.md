# Time Capsule + Blog System — Complete Knowledge Base

> **Email placeholder legend**
> - `ADMIN_EMAIL` = `hxz49@hotmail.com`: Mom (admin / curator / content reviewer)
> - `NOTIFY_EMAIL` = `dyz229@outlook.com`: **Yunze himself** (the 10-year-old kid, blog author — NOT a technical identity)

---

## 🟢 0. 2026-05-22 Email System Overhaul — Key Changes

**All 7 phases of the email-policy migration shipped on 2026-05-22.**
Many original sections below describe pre-migration state — the E1–E20
error log and T1–T11 test records are preserved as historical
archaeology, but for current facts **this section overrides them**:

### Main changes
1. **All senders unified to `*@duyunze.com`**: `onboarding@resend.dev` is fully retired. Now `capsule@duyunze.com`, `news@duyunze.com`, `editor@duyunze.com`, all with `Reply-To: hxz49@hotmail.com`
2. **Resend consolidated to dyz229 single account**: hxz49 Resend key removed; main/private repo `RESEND_API_KEY` (the hxz49 one) deleted; only `RESEND_API_KEY_2` (dyz229, main repo) and Worker's `RESEND_API_KEY` (also dyz229) remain
3. **`dyz229@outlook.com` IS Yunze himself** — this insight reshapes the entire email design semantics. Every email sent to dyz229 is now designed for a 10-year-old to read (anticipation tone, decision power, auto-subscribed to his own newsletter)
4. **Two emails at submission**: in addition to mom's metadata notification, Yunze gets an anticipation email (`💝 你有一封来自 X 的信，《title》，于 YYYY-MM-DD 打开`) containing from + title but **no body**
5. **Two emails at unlock**: split into separate emails (no cc) — mom's version has no buttons + footer saying "decision is Yunze's"; Yunze's version has **magic-link buttons** (✅ make public / 🤐 keep private)
6. **New Worker endpoint `GET /reveal-action`**: HMAC verify → fetch main repo capsule file → update `revealed:` → commit (idempotent). Lets Yunze decide-without-CMS
7. **New Worker endpoint `POST /resend-webhook`**: Svix signature verifies inbound Resend events. Hard bounce + complaint → auto `KV delete sub:` + `KV put blocklist:`; `/subscribe` rejects blocklisted addresses (self-cleaning subscriber list)
8. **Bilingual newsletter subject**: `📝 中文标题 · English title`
9. **Private repo auto-transfer.yml no longer sends email**: unlock emails come *solely* from main repo `capsule-unlock.yml`. auto-transfer is file-sync-only
10. **DMARC `rua=` moved to mom's mailbox**: aggregate reports no longer bother Yunze

### New secrets added
- Main repo GH Actions: `REVEAL_ACTION_SECRET` (Python HMAC signs magic-link tokens)
- Worker: `MAIN_REPO_TOKEN` (PAT with scope = Yunze229/yunze229.github.io contents:write), `REVEAL_ACTION_SECRET` (HMAC verify, same value as main repo's), `RESEND_WEBHOOK_SECRET` (Svix signature verify, from Resend dashboard)

### Secrets removed
- Main repo `RESEND_API_KEY` (hxz49)
- Private repo `RESEND_API_KEY` + `RESEND_API_KEY_2`

### Full migration narrative
See plugin `yunze-blog-docs`'s `email-policy` skill (4 files; includes per-phase commit hash index, cross-system HMAC compatibility verification, Cloudflare bot-fight-mode gotcha note, etc.).

---

## 1. System Architecture

```
Family member submits form
    ▼
Cloudflare Worker (capsule.duyunze.com)
  Rate limiting + Turnstile bot verification
    ├──► hxz49/yunze-letters/letters/<slug>.md  [Private repo, invisible to Yunze]
    └──► Two parallel emails (FROM capsule@duyunze.com, dyz229 Resend):
         ├─ Mom version: 📬 New letter received: <from> → <unlock_date>
         │   (metadata only, no body)
         └─ Yunze version: 💝 You have a letter from <from>,
                            《<title>》, opens on <unlock_date>
                            (with title + sender, NO body — preserves anticipation)

Daily at UTC 09:00 → main repo capsule-unlock.yml
  unlock_date <= today AND transferred: false
    ├──► Write full content to main repo (read_by_admin: false, revealed: false)
    ├──► Two parallel emails (FROM capsule@duyunze.com):
    │    ├─ Mom version: 💌 Letter opened: <from> wrote to Yunze (<title>)
    │    │              Full bilingual body + footer saying "decision is Yunze's"
    │    └─ Yunze version: 💌 Your letter is open: <from> wrote to you — <title>
    │                       Same full body + magic-link buttons (✅ publish / 🤐 keep private)
    └──► Mark private repo letter as transferred: true

Parallel: private repo auto-transfer.yml (every push + UTC 16:00) → file sync only (incl. stub mode)
          Does NOT send email anymore (removed in Phase 5)

Yunze clicks ✅ or 🤐 button:
    ▼
Worker /reveal-action?slug=&action=&token=
  HMAC verify → fetch main repo capsule file → update revealed: → commit
    ▼
deploy.yml rebuilds → published / hidden state takes effect immediately

OR CMS path (equivalent): admin sets read_by_admin: true → revealed: true → published

Deliverability: Resend → /resend-webhook (Svix-signed) → hard bounce / complaint
                auto KV delete sub: + KV put blocklist: → future subscribes rejected
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

### Secrets (post-2026-05-22 actual state)

| Location | Secret | Purpose |
|---|---|---|
| Main repo | ANTHROPIC_API_KEY | Translation + AI review + Claude API |
| Main repo | RESEND_API_KEY_2 | capsule-unlock + ai-review (dyz229 account; capsule-unlock now also uses this after Phase 1; original RESEND_API_KEY was deleted) |
| Main repo | LETTERS_PAT | unlock workflow accesses private repo letters/ |
| Main repo | BROADCAST_SECRET | deploy.yml → Worker /broadcast auth; same value as Worker secret of same name |
| Main repo | REVEAL_ACTION_SECRET | Python HMAC signs magic-link tokens; same value as Worker secret (Phase 3.3) |
| Main repo | PRIVATE_PASS | staticrypt encryption of `private: true` posts |
| Private repo | MAIN_REPO_TOKEN | auto-transfer writes to main repo |
| CF Worker | GITHUB_TOKEN | Write to private repo letters/ |
| CF Worker | MAIN_REPO_TOKEN | /reveal-action writes to main repo content/capsule/ (Phase 3.4; a SEPARATE PAT from the private repo's same-named secret — different owner, different scope, different purpose) |
| CF Worker | RESEND_API_KEY | Submit notification + Yunze anticipation + newsletter broadcast (dyz229) |
| CF Worker | TURNSTILE_SECRET | /submit + /subscribe bot verification |
| CF Worker | BROADCAST_SECRET | /broadcast auth + /unsubscribe HMAC token signing |
| CF Worker | REVEAL_ACTION_SECRET | /reveal-action HMAC verify |
| CF Worker | RESEND_WEBHOOK_SECRET | /resend-webhook Svix signature verify (Phase 4.2) |
| CF Worker | USER_MAP | Legacy — worker.js doesn't read it; effectively unused |

> 🪦 **Deleted secrets (2026-05-22 Phase 5)**: main repo `RESEND_API_KEY` (hxz49), private repo `RESEND_API_KEY` + `RESEND_API_KEY_2`. References to these in older docs/commits are pre-migration.

### Email Routing (post-2026-05-22)

| Event | To | From | Body contents |
|---|---|---|---|
| New letter — mom notification | ADMIN_EMAIL | `Yunze 的时光胶囊 <capsule@duyunze.com>` | metadata + file path; NO body |
| New letter — Yunze anticipation | NOTIFY_EMAIL | same | from + title + unlock_date; NO body |
| Letter unlocked — mom version | ADMIN_EMAIL | same | full body + footer "decision is Yunze's"; no buttons |
| Letter unlocked — Yunze version | NOTIFY_EMAIL | same | full body + ✅ publish / 🤐 keep private magic-link buttons |
| AI draft suggestion | NOTIFY_EMAIL | `Yunze 的写作助手 <editor@duyunze.com>` | Claude's improvement suggestions (`dyz229@outlook.com` IS Yunze, so this **is for the author himself**, not "hidden from him") |
| Newsletter new post | all KV `sub:*` subscribers | `Yunze <news@duyunze.com>` | Bilingual subject `📝 中文 · English`; RFC 8058 one-click unsubscribe header |
| Resend bounce/complaint webhook | Worker `/resend-webhook` | Resend (Svix) → Worker | Auto-writes `blocklist:` KV, self-cleans subscriber list |
| DMARC aggregate report | ADMIN_EMAIL (since Phase 4.3, 2026-05-22) | ISPs (Gmail/Outlook/etc.) | XML report, for admin (no longer for Yunze) |

All user-facing emails set `Reply-To: hxz49@hotmail.com` — replies route to mom, not Yunze.

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

## 6-B. Blog Theme & Features (added 2026-05-20)

### Project image gallery
- Trigger: post has `作品` in `categories` → `<article class="is-project">`
- `initGalleries()` in `main.js`: finds `.is-project` → runs `buildGalleries()` on each `.post-en`/`.post-zh` → wraps runs of ≥2 consecutive `<p><img></p>` into `.img-gallery`
- CSS: horizontal scroll-snap, arrow buttons always visible in light transparent gray, hidden on mobile
- Each language div gets its own independent gallery instance; CSS controls show/hide

### Bilingual content fallback fix
- When `body_zh` is empty, the Chinese div falls back to showing the English content (`_default/single.html`)
- Before fix: having `title_zh` but no `body_zh` caused the Chinese view to show a blank page

### CMS photo organization
- The `posts` collection overrides the global `media_folder`: `static/images/uploads/{{slug}}/`
- New uploads go into a subfolder named after the post slug automatically
- Old images remain in the flat `static/images/uploads/` directory — existing post links are unaffected

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

### 8.2 + 8.3 ⚠️ Obsolete (consolidated 2026-05-22)

> The original 8.2 (Resend hxz49 account) and 8.3 (Resend dyz229 account)
> described a two-account model that **no longer exists** after Phase 1+5
> on 2026-05-22. We now use **one account (dyz229)**. For from-scratch
> setup, follow the merged section below.

### 8.2-NEW Resend Setup (**single account = dyz229**)

**Purpose**: ALL emails — submission notifications, unlock notifications
(both mom and Yunze versions), AI draft critique, newsletter broadcasts.

1. Go to https://resend.com → log in with NOTIFY_EMAIL (dyz229)
2. **Verify domain `duyunze.com`**: left menu **Domains** → **Add Domain** → enter `duyunze.com` → follow the prompts to add SPF / DKIM / MX / DMARC records in Cloudflare DNS → wait for Verified ✅. Once this is done, any `*@duyunze.com` subaddress can send mail
3. **Create API Key**: left menu **API Keys** → **Create API Key**, name `yunze-blog`, permission **Full access** → copy the `re_...` value
4. **Add to Worker Secrets**: `RESEND_API_KEY` = this key (see 8.4)
5. **Add to main repo GH Actions Secrets**: `RESEND_API_KEY_2` = **the same key** (the name `_2` is a historical artifact — it used to mean "second account" but with consolidation we kept the variable name to avoid editing all call sites at once; see plugin `architecture/SKILL-resend-accounts.md`)
6. **Configure webhook (Phase 4.2)**: left menu **Webhooks** → **Add Endpoint**
   - URL: `https://capsule.duyunze.com/resend-webhook`
   - Events to listen to: ✅ `email.bounced` + ✅ `email.complained`
   - After saving, open the endpoint detail page and copy the **Signing Secret** (`whsec_...`) → add to Worker Secrets: `RESEND_WEBHOOK_SECRET`

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

#### Add Worker Secrets (post-2026-05-22)

Worker → **Settings** → **Variables** → **Add variable** (type: **Secret**):

| Secret name | Value | Purpose |
|---|---|---|
| `RESEND_API_KEY` | **dyz229** Resend key (see 8.2-NEW) | Sends all emails (submit notify, Yunze anticipation, newsletter) |
| `GITHUB_TOKEN` | hxz49 fine-grained PAT, scope: `hxz49/yunze-letters` contents:write (see 8.5 PAT 3) | Write to private repo letters/ |
| `MAIN_REPO_TOKEN` | **Yunze229** fine-grained PAT, scope: `Yunze229/yunze229.github.io` contents:write | `/reveal-action` writes to main repo content/capsule/ flipping `revealed:` field (Phase 3.4) |
| `BROADCAST_SECRET` | random string; **must equal** the main repo GH secret of the same name | `/broadcast` auth + `/unsubscribe` HMAC signing |
| `REVEAL_ACTION_SECRET` | random 32-byte hex; **must equal** the main repo GH secret of the same name | `/reveal-action` HMAC verify of magic-link tokens (Phase 3.4) |
| `RESEND_WEBHOOK_SECRET` | `whsec_...` from Resend dashboard webhook detail page | `/resend-webhook` Svix signature verify (Phase 4.2) |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret key (see 8.7) | `/submit` + `/subscribe` bot protection |

> 🪦 The old `USER_MAP` secret is still in the Worker but worker.js doesn't read it; effectively unused. Can be deleted safely or left in place.

**Worker endpoints (post-2026-05-22):**
- `POST /submit` — family submits a capsule (Turnstile + rate-limit)
- `POST /subscribe` — newsletter subscription (Turnstile + rate-limit + blocklist gate)
- `POST /broadcast` — deploy.yml triggers post-deploy broadcast
- `GET/POST /unsubscribe` — one-click unsubscribe (HMAC)
- `GET /reveal-action` — Yunze clicks magic-link button to flip `revealed:` (HMAC)
- `POST /resend-webhook` — Resend bounce/complaint event receiver (Svix signed)

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

#### PAT 4: Worker's MAIN_REPO_TOKEN (Phase 3.4, added 2026-05-22)

Needed so the Worker's `/reveal-action` handler can write to main repo's `content/capsule/<slug>.md` flipping `revealed:`.

1. Log in to **Yunze229** account
2. **Fine-grained tokens** → **Generate new token**
3. Configure:
   - Token name: `yunze-capsule-worker`
   - Expiration: 1 year (regenerate when expired)
   - Resource owner: **Yunze229**
   - Repository access: **Only select repositories** → `yunze229.github.io`
   - Permissions → **Contents**: **Read and write**
4. Copy the token, add to Cloudflare Worker Secrets: `MAIN_REPO_TOKEN`
5. **Don't confuse this with PAT 1 (the private repo's MAIN_REPO_TOKEN)** — same name but different owner, different scope, different purpose. PAT 1 lives in private repo GH Actions; PAT 4 lives in Worker secrets.

---

### 8.6 How to Add GitHub Secrets

#### Main repo (Yunze229/yunze229.github.io)
1. Go to https://github.com/Yunze229/yunze229.github.io
2. **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Secrets to add:
| Secret name | Source |
|---|---|
| `ANTHROPIC_API_KEY` | 8.1 |
| `RESEND_API_KEY_2` | 8.2-NEW (dyz229 account; this is now also the key for capsule-unlock.yml) |
| `LETTERS_PAT` | 8.5 PAT 2 |
| `BROADCAST_SECRET` | self-generated random string; same value as Worker secret |
| `REVEAL_ACTION_SECRET` | self-generated (32-byte hex); same value as Worker secret (Phase 3.3) |
| `PRIVATE_PASS` | self-generated; staticrypt encryption of `private: true` posts |

#### Private repo (hxz49/yunze-letters)
1. Go to https://github.com/hxz49/yunze-letters
2. Same path as above

Secrets to add:
| Secret name | Source |
|---|---|
| `MAIN_REPO_TOKEN` | 8.5 PAT 1 |

> 🪦 The original `RESEND_API_KEY` + `RESEND_API_KEY_2` were deleted (Phase 5, 2026-05-22) — private repo's auto-transfer.yml no longer sends email.

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

### 8.9 From-Scratch Setup Checklist (post-2026-05-22 version)

Complete in order; check off each step:

- [ ] 8.1 Anthropic API Key → main repo `ANTHROPIC_API_KEY`
- [ ] 8.2-NEW Resend dyz229 single account → API Key into Worker `RESEND_API_KEY` + main repo `RESEND_API_KEY_2` (same key, two copies)
- [ ] 8.2-NEW Resend domain verify `duyunze.com` + configure webhook → Worker `RESEND_WEBHOOK_SECRET`
- [ ] 8.5 PAT 1 (private repo's `MAIN_REPO_TOKEN`, for auto-transfer.yml) → private repo Secret
- [ ] 8.5 PAT 2 (main repo's `LETTERS_PAT`, for capsule-unlock.yml) → main repo Secret
- [ ] 8.5 PAT 3 (Worker's `GITHUB_TOKEN`, writes private repo letters/) → Worker Secret
- [ ] 8.5 PAT 4 (Worker's `MAIN_REPO_TOKEN`, writes main repo content/capsule/) → Worker Secret (Phase 3.4)
- [ ] Self-generate `BROADCAST_SECRET` (random string) → Worker + main repo Secret (must match)
- [ ] Self-generate `REVEAL_ACTION_SECRET` (32-byte hex) → Worker + main repo Secret (must match; Phase 3.3)
- [ ] Self-generate `PRIVATE_PASS` (for staticrypt) → main repo Secret
- [ ] 8.4 Create KV namespace (binding name `RATE_LIMIT`, namespace id in `wrangler.toml`)
- [ ] 8.7 Turnstile site key + secret → hugo.toml + Worker `TURNSTILE_SECRET`
- [ ] 8.8 GitHub OAuth App + CMS Auth Worker secrets (`GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`)
- [ ] Cloudflare DNS: SPF + DKIM + DMARC (`v=DMARC1; p=none; rua=mailto:hxz49@hotmail.com`)
- [ ] Verify: submit test letter → private repo gets file → main repo gets stub → BOTH mom and Yunze get their emails

> Phase 4.2 webhook end-to-end verification script: see plugin `email-policy/SKILL-mechanisms.md` (note: must set an explicit User-Agent on the test request or Cloudflare bot fight mode returns 1010).
