// Phase E.2 — Tiptap comment editor + thread renderer.
//
// Bundled by Hugo's js.Build (esbuild). Loaded by partials/comments.html
// only on pages that include it (post detail pages — see single.html).
//
// State flow:
//   1. On DOMContentLoaded → init() runs
//   2. init() parallel-fetches /me + /comments?slug=<pathname>
//   3. Renders the comment thread (always visible, even when logged out)
//   4. If logged in → reveals the editor, mounts Tiptap
//      If logged out → reveals the "Sign in to read…" CTA
//   5. User interactions (submit, reply, delete) hit the capsule worker

import { Editor }         from '@tiptap/core';
import StarterKit         from '@tiptap/starter-kit';
import Link               from '@tiptap/extension-link';
import Placeholder        from '@tiptap/extension-placeholder';
import CharacterCount     from '@tiptap/extension-character-count';
import TaskList           from '@tiptap/extension-task-list';
import TaskItem           from '@tiptap/extension-task-item';

const API  = 'https://capsule.duyunze.com';
const AUTH = 'https://auth.duyunze.com';
const MAX  = 2000;

let user     = null;   // /me payload or null
let editor   = null;   // Tiptap Editor instance
let comments = [];     // flat list from GET /comments
let replyTo  = null;   // parent_id when replying, null for top-level

// ── DOM helpers ───────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v != null) e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function bilingual(zh, en) {
  return el('span', { class: 'bilingual-inline' },
    el('span', { class: 'lang-zh-inline' }, zh),
    el('span', { class: 'lang-en-inline' }, en));
}

function formatDate(unixSec) {
  const d = new Date(unixSec * 1000);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function showMsg(text) {
  const msg = $('comments-msg');
  if (!msg) return;
  msg.textContent = text;
  msg.hidden = false;
  clearTimeout(showMsg._t);
  showMsg._t = setTimeout(() => { msg.hidden = true; }, 5000);
}

// ── API calls ─────────────────────────────────────────────────────────────

async function fetchMe() {
  try {
    const r = await fetch(AUTH + '/me', { credentials: 'include' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function fetchComments(slug) {
  try {
    const r = await fetch(API + '/comments?slug=' + encodeURIComponent(slug));
    if (!r.ok) return [];
    return (await r.json()).comments || [];
  } catch { return []; }
}

async function postComment(payload) {
  const r = await fetch(API + '/comments', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    err.loginUrl = data.login_url;
    throw err;
  }
  return data;
}

async function deleteComment(id) {
  const r = await fetch(API + '/comments/' + id, {
    method:      'DELETE',
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`Delete failed (HTTP ${r.status})`);
}

// ── Thread rendering ──────────────────────────────────────────────────────

function buildTree(flat) {
  // 2-level model: parent_id NULL = root, otherwise attaches to a root.
  // The server flattens deeper attempts, so we don't need to walk parent chains.
  const byId = new Map();
  flat.forEach(c => byId.set(c.id, { ...c, children: [] }));
  const roots = [];
  flat.forEach(c => {
    const node = byId.get(c.id);
    if (c.parent_id == null) {
      roots.push(node);
    } else {
      const parent = byId.get(c.parent_id);
      if (parent) parent.children.push(node);
      else roots.push(node); // orphaned (parent deleted); show as root
    }
  });
  // Sort: roots oldest first, replies oldest first too.
  roots.sort((a, b) => a.created_at - b.created_at);
  roots.forEach(r => r.children.sort((a, b) => a.created_at - b.created_at));
  return roots;
}

function renderThread() {
  const list = $('comments-list');
  list.innerHTML = '';
  const tree = buildTree(comments);
  if (tree.length === 0) {
    list.appendChild(el('p', { class: 'comments-empty' },
      bilingual('还没有评论。', 'No comments yet.')));
    return;
  }
  tree.forEach(c => list.appendChild(renderRoot(c)));
}

function renderRoot(c) {
  const root = renderOne(c, false);
  if (c.children && c.children.length) {
    const replies = el('div', { class: 'comment-replies' });
    c.children.forEach(child => replies.appendChild(renderOne(child, true)));
    root.appendChild(replies);
  }
  return root;
}

function renderOne(c, isReply) {
  const initial = (c.user.name || '?').trim().charAt(0).toUpperCase() || '?';
  const avatar = c.user.avatar
    ? el('img', { class: 'comment-avatar', src: c.user.avatar, alt: '' })
    : el('div', { class: 'comment-avatar comment-avatar--initial' }, initial);

  const nameSpan = el('span', { class: 'comment-name' }, c.user.name);
  const badge = c.user.is_admin
    ? el('span', { class: 'comment-badge' }, bilingual('作者', 'Author'))
    : null;
  const date = el('time', { class: 'comment-date' }, formatDate(c.created_at));

  const meta = el('div', { class: 'comment-meta' }, nameSpan, badge, date);
  const head = el('header', { class: 'comment-head' }, avatar, meta);

  const body = el('div', { class: 'comment-body' });
  body.innerHTML = c.body_html; // already server-sanitized

  const actions = el('div', { class: 'comment-actions' });
  // Reply only on top-level (2-level limit; replies-to-replies fold to sibling)
  if (user && !isReply) {
    actions.appendChild(el('button', {
      class: 'comment-action',
      type:  'button',
      onclick: () => setReplyTo(c.id, c.user.name),
    }, bilingual('回复', 'Reply')));
  }
  // Delete: own comment, or admin
  const isOwn = user && c.user.provider === user.provider
    && c.user.name === user.name; // proxy for own — server enforces real check
  if (user && (isOwn || user.is_admin)) {
    actions.appendChild(el('button', {
      class: 'comment-action comment-action--delete',
      type:  'button',
      onclick: () => onDelete(c.id),
    }, bilingual('删除', 'Delete')));
  }

  return el('article', { class: 'comment' + (isReply ? ' comment--reply' : ''), 'data-id': c.id },
    head, body, actions);
}

// ── Editor + actions ──────────────────────────────────────────────────────

function setReplyTo(parentId, parentName) {
  replyTo = parentId;
  const hint = $('reply-hint');
  if (!hint) return;
  hint.hidden = false;
  $('reply-hint-name').textContent = parentName;
  $('reply-hint-name-en').textContent = parentName;
  if (editor) editor.commands.focus();
}

function clearReplyTo() {
  replyTo = null;
  const hint = $('reply-hint');
  if (hint) hint.hidden = true;
}

async function onDelete(id) {
  if (!confirm('确定删除这条评论？/ Delete this comment?')) return;
  try {
    await deleteComment(id);
    comments = comments.filter(c => c.id !== id);
    renderThread();
    updateCount();
  } catch (e) {
    showMsg(e.message);
  }
}

async function onSubmit() {
  if (!editor) return;
  const html = editor.getHTML();
  const n = editor.storage.characterCount.characters();
  if (n === 0 || n > MAX) return;

  const btn = $('comments-submit');
  btn.disabled = true;
  try {
    const created = await postComment({
      slug:      location.pathname,
      parent_id: replyTo,
      body_html: html,
    });
    comments.push(created);
    renderThread();
    updateCount();
    editor.commands.clearContent();
    clearReplyTo();
    updateCounter();
  } catch (e) {
    if (e.status === 401) {
      const next = encodeURIComponent(location.href);
      showMsg(`会话过期了，去 ${AUTH}/login?next=${next} 重新登录`);
    } else {
      showMsg(e.message || '提交失败');
    }
  } finally {
    btn.disabled = false;
    updateCounter();
  }
}

function updateCounter() {
  if (!editor) return;
  const n = editor.storage.characterCount.characters();
  const c = $('comments-counter');
  if (c) c.textContent = n + ' / ' + MAX;
  const b = $('comments-submit');
  if (b) b.disabled = (n === 0 || n > MAX);
}

function updateCount() {
  const countEl = $('comments-count');
  if (!countEl) return;
  const n = comments.length;
  countEl.innerHTML = '';
  if (n === 0) {
    countEl.appendChild(bilingual('暂无评论', 'NO COMMENTS YET'));
  } else {
    const zh = n + ' 条评论';
    const en = n + ' COMMENT' + (n === 1 ? '' : 'S');
    countEl.appendChild(bilingual(zh, en));
  }
}

function mountEditor() {
  const target = $('comments-editor');
  if (!target) return;
  editor = new Editor({
    element: target,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        autolink: true,
      }),
      Placeholder.configure({ placeholder: 'Share your thoughts...' }),
      CharacterCount.configure({ limit: MAX }),
      TaskList,
      TaskItem.configure({ nested: false }),
    ],
    autofocus: false,
    onUpdate: updateCounter,
    onSelectionUpdate: updateToolbarState,
  });
  wireToolbar();
  updateCounter();
  updateToolbarState();
}

function wireToolbar() {
  const block = $('tb-block');
  if (block) block.addEventListener('change', (e) => {
    const v = e.target.value;
    if (!editor) return;
    if (v === 'paragraph') editor.chain().focus().setParagraph().run();
    else if (v === 'h2')   editor.chain().focus().toggleHeading({ level: 2 }).run();
    else if (v === 'h3')   editor.chain().focus().toggleHeading({ level: 3 }).run();
  });

  const buttons = [
    ['tb-bold',      () => editor.chain().focus().toggleBold().run()],
    ['tb-italic',    () => editor.chain().focus().toggleItalic().run()],
    ['tb-strike',    () => editor.chain().focus().toggleStrike().run()],
    ['tb-code',      () => editor.chain().focus().toggleCode().run()],
    ['tb-codeblock', () => editor.chain().focus().toggleCodeBlock().run()],
    ['tb-ul',        () => editor.chain().focus().toggleBulletList().run()],
    ['tb-ol',        () => editor.chain().focus().toggleOrderedList().run()],
    ['tb-task',      () => editor.chain().focus().toggleTaskList().run()],
    ['tb-link',      () => promptLink()],
    ['tb-quote',     () => editor.chain().focus().toggleBlockquote().run()],
    ['tb-hr',        () => editor.chain().focus().setHorizontalRule().run()],
  ];
  for (const [id, fn] of buttons) {
    const b = $(id);
    if (b) b.addEventListener('click', fn);
  }

  $('comments-submit') && $('comments-submit').addEventListener('click', onSubmit);
  $('reply-cancel')    && $('reply-cancel').addEventListener('click', clearReplyTo);
}

function updateToolbarState() {
  if (!editor) return;
  const map = {
    'tb-bold':      editor.isActive('bold'),
    'tb-italic':    editor.isActive('italic'),
    'tb-strike':    editor.isActive('strike'),
    'tb-code':      editor.isActive('code'),
    'tb-codeblock': editor.isActive('codeBlock'),
    'tb-ul':        editor.isActive('bulletList'),
    'tb-ol':        editor.isActive('orderedList'),
    'tb-task':      editor.isActive('taskList'),
    'tb-link':      editor.isActive('link'),
    'tb-quote':     editor.isActive('blockquote'),
  };
  for (const [id, on] of Object.entries(map)) {
    const b = $(id);
    if (!b) continue;
    b.classList.toggle('tb-btn--active', !!on);
  }
  const block = $('tb-block');
  if (block) {
    if (editor.isActive('heading', { level: 2 }))      block.value = 'h2';
    else if (editor.isActive('heading', { level: 3 })) block.value = 'h3';
    else                                               block.value = 'paragraph';
  }
}

function promptLink() {
  const url = prompt('链接 URL / Link URL');
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    alert('链接必须以 http:// 或 https:// 开头 / Link must start with http(s)://');
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  const root = $('article-comments');
  if (!root) return;

  const slug = location.pathname;
  const [me, list] = await Promise.all([
    fetchMe(),
    fetchComments(slug),
  ]);
  user = me;
  comments = list;

  updateCount();
  renderThread();

  const cta = $('comments-cta');
  const wrap = $('comments-editor-wrap');
  if (user) {
    if (cta)  cta.hidden = true;
    if (wrap) wrap.hidden = false;
    mountEditor();
  } else {
    if (cta)  cta.hidden = false;
    if (wrap) wrap.hidden = true;
    if (cta) {
      const next = encodeURIComponent(location.href);
      cta.href = AUTH + '/login?next=' + next;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
