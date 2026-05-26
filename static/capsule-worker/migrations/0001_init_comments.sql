-- Phase E.1 — Comments backend for duyunze.com.
-- See [[yunze-blog-comments]] memory for the full design.
--
-- Apply with:
--   wrangler d1 migrations apply yunze-comments --remote
--
-- The two tables live in the D1 database `yunze-comments` (bound as
-- COMMENTS_DB in capsule-worker's wrangler.toml). Authentication is
-- handled upstream by the yunze-cms-auth Worker (HttpOnly session cookie
-- + KV `allow:<provider>:<id>` allowlist); comments tables only store
-- what's needed for rendering + ownership checks.

CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 'github' or 'google'. Matches the KV `allow:<provider>:<id>` scheme.
  provider    TEXT NOT NULL,

  -- For github: lowercased login (e.g. "hxz49"). For google: lowercased
  -- email (e.g. "mom@example.com"). Same key the allowlist uses, so a
  -- KV lookup of `allow:<provider>:<provider_id>` confirms membership.
  -- A user renaming their GitHub login becomes a "new" user — acceptable
  -- for a 10-person family blog.
  provider_id TEXT NOT NULL,

  email       TEXT,           -- optional, for admin contact only
  name        TEXT NOT NULL,  -- display name (preferred from allowlist entry)
  avatar      TEXT,           -- OAuth avatar URL, may be NULL
  created_at  INTEGER NOT NULL,        -- unix seconds
  is_blocked  INTEGER NOT NULL DEFAULT 0,

  UNIQUE(provider, provider_id)
);

CREATE TABLE comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  -- The post URL pathname this comment belongs to, e.g.
  -- '/posts/2026-05-26-from-fabric-to-bag/'. Always starts and ends with '/'.
  slug        TEXT NOT NULL,

  user_id     INTEGER NOT NULL REFERENCES users(id),

  -- NULL = top-level comment. Otherwise FK to a top-level comment's id.
  -- The POST handler enforces 2-level-only nesting: if a user replies to
  -- comment X where X.parent_id IS NOT NULL, the new comment is stored
  -- with parent_id = X.parent_id (i.e. attached to the same top-level
  -- root, sibling to X). This keeps the data shape strictly 2 levels deep.
  parent_id   INTEGER REFERENCES comments(id),

  body_html   TEXT NOT NULL,           -- sanitized HTML (whitelist applied server-side)
  body_len    INTEGER NOT NULL,        -- rendered plain-text length, ≤ 2000

  created_at  INTEGER NOT NULL,        -- unix seconds
  deleted_at  INTEGER                  -- soft-delete; NULL = visible
);

-- Hot path: render a post's comment thread in chronological order.
CREATE INDEX idx_comments_slug ON comments(slug, created_at ASC);

-- Used when fetching all replies under a given top-level comment, and when
-- the POST handler flattens deeply-nested replies to 2 levels.
CREATE INDEX idx_comments_parent ON comments(parent_id);
