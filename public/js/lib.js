// 共享工具函数
const api = (path, opts = {}) =>
  fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body })
    .then(async r => {
      const txt = await r.text();
      let data; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
      if (!r.ok) throw new Error((data && data.error) || ('请求失败 ' + r.status));
      return data;
    });

function toast(msg, ms = 2000) {
  const t = document.getElementById('toast') || (() => {
    const el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); return el;
  })();
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms);
}

function fmtTime(s) {
  s = Math.floor(s || 0);
  const m = Math.round(s / 60);
  if (m < 60) return m + ' 分钟';
  return (m / 60).toFixed(1) + ' 小时';
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts), now = Date.now();
  const diff = (now - ts) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 为无封面书籍生成渐变
function coverColors(title) {
  const palettes = [
    ['#9c5a3f', '#6b3a28'], ['#3f5a6b', '#2a3b4a'], ['#5a6b3f', '#3b4a28'],
    ['#6b3f5a', '#4a283b'], ['#3f6b5a', '#284a3b'], ['#6b5a3f', '#4a3b28'],
    ['#4a3f6b', '#2e284a'], ['#7a5a3f', '#523824'],
  ];
  let h = 0; for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

// 本地设置存取
const LS = {
  get(k, def) { try { const v = localStorage.getItem('reader:' + k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem('reader:' + k, JSON.stringify(v)); } catch {} },
};

// SVG 图标
const ICONS = {
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  toc: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  note: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3h14v18l-7-4-7 4z"/></svg>',
  bm: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  gear: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  expand: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  left: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
};
