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
