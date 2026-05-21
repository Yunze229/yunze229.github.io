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
  const giscusFrame = document.querySelector('iframe.giscus-frame');
  if (giscusFrame) {
    giscusFrame.contentWindow.postMessage(
      { giscus: { setConfig: { lang: l === 'zh' ? 'zh-CN' : 'en' } } },
      'https://giscus.app'
    );
  }
}

if (langRoot) setLang(getLang());

langBtns.forEach(btn => {
  btn.addEventListener('click', () => setLang(btn.dataset.lang));
});

// Share buttons
const copyBtn = document.getElementById('share-copy');
const twitterBtn = document.getElementById('share-twitter');

if (twitterBtn) {
  const url = encodeURIComponent(window.location.href);
  const text = encodeURIComponent(document.title);
  twitterBtn.href = `https://twitter.com/intent/tweet?url=${url}&text=${text}`;
}

if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      copyBtn.classList.add('copied');
      const label = copyBtn.querySelector('.lang-zh-inline, .lang-en-inline:not([style*="none"])');
      const origText = copyBtn.innerHTML;
      copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ✓ Copied`;
      setTimeout(() => {
        copyBtn.innerHTML = origText;
        copyBtn.classList.remove('copied');
      }, 2000);
    });
  });
}

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

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    searchResults.innerHTML = '';
    if (!q || !index) return;

    const hits = index.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.content || '').toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q))
    ).slice(0, 20);

    if (!hits.length) {
      searchResults.innerHTML = '<li style="padding:16px 0;color:var(--fg-muted);font-size:0.9rem;">没有找到相关文章</li>';
      return;
    }

    hits.forEach(p => {
      const li = document.createElement('li');
      li.className = 'search-result-item';
      const excerpt = (p.content || '').substring(0, 120).trim();
      li.innerHTML = `
        <div class="search-result-title">
          <a href="${p.permalink}">${p.title}</a>
        </div>
        ${excerpt ? `<div class="search-result-excerpt">${excerpt}…</div>` : ''}
      `;
      searchResults.appendChild(li);
    });
  });
}
