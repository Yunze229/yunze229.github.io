# yunze-cms-auth Worker

The OAuth Worker behind **`auth.duyunze.com`**. Two jobs:

1. **Sveltia CMS OAuth bridge** — `/admin/` login → GitHub OAuth → window.opener postMessage.
2. **Site-wide sign-in** (Phase A in progress) — allowlisted GitHub + Google sign-in for capsule submit, comments, voice diary.

See [`DESIGN.md`](./DESIGN.md) for the full architecture, endpoint inventory, cookie schema, KV schema, and deploy checklist.

## Deploy

```bash
cd static/cms-auth-worker
wrangler whoami        # confirm you're on dyz229@icloud.com's account
wrangler deploy
```

Note: `wrangler deploy` reads `wrangler.toml` in this directory. The Worker name is `yunze-cms-auth` (matches the existing deployed Worker — will overwrite).

## Set secrets (one-time)

```bash
wrangler secret put GITHUB_CLIENT_SECRET            # legacy CMS flow (already set, just confirm)
wrangler secret put SITE_GITHUB_CLIENT_SECRET       # NEW — can reuse same value
wrangler secret put GOOGLE_CLIENT_ID                # NEW
wrangler secret put GOOGLE_CLIENT_SECRET            # NEW
wrangler secret put ALLOWED_RETURN_HOSTS            # NEW — e.g. "duyunze.com,www.duyunze.com"
```

## Manage allowlist

```bash
# Add a family member by GitHub login:
wrangler kv key put --binding ALLOWLIST 'allow:github:hxz49' \
  '{"name":"妈妈","role":"family","added":"2026-05-26"}'

# Add by Google email:
wrangler kv key put --binding ALLOWLIST 'allow:google:hxz49@hotmail.com' \
  '{"name":"妈妈","role":"family","added":"2026-05-26"}'

# List current allowlist:
wrangler kv key list --binding ALLOWLIST | grep '^allow:'

# Remove someone:
wrangler kv key delete --binding ALLOWLIST 'allow:github:somebody'
```

## Local dev (optional)

```bash
wrangler dev --remote     # talks to real GitHub OAuth + real KV, careful
```

## Roll back

If a deploy goes bad and Sveltia CMS login breaks:

```bash
git log --oneline -- worker.js     # find the last known-good commit
git show <sha>:static/cms-auth-worker/worker.js > /tmp/rollback.js
# Either: commit a revert + redeploy
# Or: paste /tmp/rollback.js into CF dashboard → Edit code → Save and Deploy
# The dashboard path is faster in an emergency.
```

The CF dashboard always wins over `wrangler deploy` if it was edited last — they share the same backing store.
