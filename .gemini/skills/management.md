# Blog Management Skill (Gemini Native)

This skill provides expert guidance for managing the **duyunze.com** blog's advanced subsystems, including the Voice Diary, Comments, and Capsule systems.

## Subsystems Reference

### 1. Voice Diary (Phase V.1)
- **Audio Storage**: R2 bucket `yunze-media`, path `voice-diary/YYYY-MM/`.
- **Flow**: Record → `POST /voice/transcribe` (Whisper) → `POST /voice/polish` (Claude) → `POST /voice/publish` (Private Repo).
- **Auth**: Requires `yunze_session` (Admin role).

### 2. Comments (Phase E.1)
- **Database**: D1 `yunze-comments`.
- **Management**: Mom receives email with HMAC delete link.
- **Cleanup**: Admin can `DELETE /comments/:id`.

### 3. Capsule
- **Submission**: `POST /submit` (Auth required).
- **Reveal**: Magic-link logic in `worker.js` via `REVEAL_ACTION_SECRET`.

## Operational Workflows

### Debugging Worker Issues
1. Check Cloudflare Logs for `yunze-capsule` or `yunze-cms-auth`.
2. Verify Secrets (see `architecture/SKILL-secrets-index.md` in docs).
3. Check `yunze_session` cookie presence.

### Content Recovery
- If a post is accidentally deleted, check the Git history or the private repo `yunze-private` (for voice/capsule).

## Maintenance
- **Resend**: Monitor bounce rates via the dashboard; the `/resend-webhook` handles auto-cleanup.
- **Secrets**: Rotate `REVEAL_ACTION_SECRET` and `BROADCAST_SECRET` annually (coordinated update required).
