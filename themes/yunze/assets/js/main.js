// Theme toggle
const html = document.documentElement;
const toggleBtn = document.getElementById('theme-toggle');

function getTheme() {
  return localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function setTheme(t) {
  html.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
}

setTheme(getTheme());

if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  });
}

// Language toggle
const langBtns = document.querySelectorAll('.lang-btn');
const langRoot = document.querySelector('.lang-root');

function getLang() {
  return localStorage.getItem('lang') || 'zh';
}

function setLang(l) {
  localStorage.setItem('lang', l);
  if (langRoot) {
    langRoot.classList.remove('show-zh', 'show-en');
    langRoot.classList.add('show-' + l);
  }
  langBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === l);
  });
}

if (langRoot) setLang(getLang());

langBtns.forEach(btn => {
  btn.addEventListener('click', () => setLang(btn.dataset.lang));
});

// Image gallery (project posts)
function buildGalleries(container) {
  const children = Array.from(container.children);
  let run = [];

  function flush() {
    if (run.length < 2) { run = []; return; }

    const gallery = document.createElement('div');
    gallery.className = 'img-gallery';

    const track = document.createElement('div');
    track.className = 'img-gallery-track';

    run.forEach(p => {
      const img = p.querySelector('img').cloneNode(true);
      img.style.margin = '0';
      track.appendChild(img);
    });

    const prev = document.createElement('button');
    prev.className = 'img-gallery-btn prev';
    prev.setAttribute('aria-label', 'Previous');
    prev.textContent = '‹';

    const next = document.createElement('button');
    next.className = 'img-gallery-btn next';
    next.setAttribute('aria-label', 'Next');
    next.textContent = '›';

    const dots = document.createElement('div');
    dots.className = 'img-gallery-dots';
    run.forEach((_, i) => {
      const d = document.createElement('div');
      d.className = 'img-gallery-dot' + (i === 0 ? ' active' : '');
      dots.appendChild(d);
    });

    gallery.appendChild(track);
    gallery.appendChild(prev);
    gallery.appendChild(next);
    gallery.appendChild(dots);

    container.insertBefore(gallery, run[0]);
    run.forEach(p => p.remove());

    const dotEls = dots.querySelectorAll('.img-gallery-dot');
    const total = track.querySelectorAll('img').length;

    function currentIndex() {
      return Math.round(track.scrollLeft / track.clientWidth);
    }

    function scrollTo(idx) {
      track.scrollTo({ left: track.clientWidth * Math.max(0, Math.min(total - 1, idx)), behavior: 'smooth' });
    }

    prev.addEventListener('click', () => scrollTo(currentIndex() - 1));
    next.addEventListener('click', () => scrollTo(currentIndex() + 1));
    dotEls.forEach((d, i) => d.addEventListener('click', () => scrollTo(i)));

    track.addEventListener('scroll', () => {
      const idx = currentIndex();
      dotEls.forEach((d, i) => d.classList.toggle('active', i === idx));
    }, { passive: true });

    run = [];
  }

  children.forEach(el => {
    const isImgPara = el.tagName === 'P' && el.children.length === 1 && el.children[0].tagName === 'IMG';
    if (isImgPara) { run.push(el); } else { flush(); }
  });
  flush();
}

function initGalleries() {
  const article = document.querySelector('article.is-project');
  if (!article) return;
  const content = article.querySelector('.article-content');
  if (!content) return;
  const bilingualDivs = content.querySelectorAll(':scope > .post-en, :scope > .post-zh');
  if (bilingualDivs.length > 0) {
    bilingualDivs.forEach(div => buildGalleries(div));
  } else {
    buildGalleries(content);
  }
}

initGalleries();

// Search
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

if (searchInput) {
  let index = null;

  fetch('/index.json')
    .then(r => r.json())
    .then(data => { index = data; });

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Build an excerpt centered on the first match. Picks the language-matching
  // source (zh body if the match is there, otherwise en) so a zh query yields
  // a zh snippet. Falls back to the first 120 chars when nothing matches.
  function buildExcerpt(p, q) {
    const lc = q.toLowerCase();
    const zh = p.content_zh || '';
    const en = p.content || '';
    let source = '';
    if (zh.toLowerCase().includes(lc)) source = zh;
    else if (en.toLowerCase().includes(lc)) source = en;
    else source = zh || en;

    if (!source) return '';
    const idx = source.toLowerCase().indexOf(lc);
    let snippet, prefix = '', suffix = '';
    if (idx === -1) {
      snippet = source.substring(0, 120).trim();
      if (source.length > 120) suffix = '…';
    } else {
      const start = Math.max(0, idx - 30);
      const end = Math.min(source.length, idx + q.length + 80);
      snippet = source.substring(start, end).trim();
      if (start > 0) prefix = '…';
      if (end < source.length) suffix = '…';
    }
    const escaped = escapeHtml(snippet);
    const highlighted = escaped.replace(new RegExp(escapeRegex(q), 'gi'), '<mark>$&</mark>');
    return prefix + highlighted + suffix;
  }

  function buildTitle(p, q) {
    const en = escapeHtml(p.title || '');
    const zh = escapeHtml(p.title_zh || '');
    const re = new RegExp(escapeRegex(q), 'gi');
    const hlEn = en.replace(re, '<mark>$&</mark>');
    const hlZh = zh.replace(re, '<mark>$&</mark>');
    if (zh && en && zh !== en) {
      return `<span class="lang-zh-inline">${hlZh}</span><span class="lang-en-inline">${hlEn}</span>`;
    }
    return hlEn || hlZh;
  }

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    const lc = q.toLowerCase();
    searchResults.innerHTML = '';
    if (!q || !index) return;

    const hits = index.filter(p =>
      (p.title || '').toLowerCase().includes(lc) ||
      (p.title_zh || '').toLowerCase().includes(lc) ||
      (p.content || '').toLowerCase().includes(lc) ||
      (p.content_zh || '').toLowerCase().includes(lc) ||
      (p.tags || []).some(t => t.toLowerCase().includes(lc))
    ).slice(0, 20);

    if (!hits.length) {
      searchResults.innerHTML = '<li style="padding:16px 0;color:var(--fg-muted);font-size:0.9rem;">没有找到相关文章 / No results</li>';
      return;
    }

    hits.forEach(p => {
      const li = document.createElement('li');
      li.className = 'search-result-item';
      const excerpt = buildExcerpt(p, q);
      li.innerHTML = `
        <div class="search-result-title">
          <a href="${escapeHtml(p.permalink)}">${buildTitle(p, q)}</a>
        </div>
        ${excerpt ? `<div class="search-result-excerpt">${excerpt}</div>` : ''}
      `;
      searchResults.appendChild(li);
    });
  });
}
