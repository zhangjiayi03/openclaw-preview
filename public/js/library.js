let books = [];
let tags = [];
let sortKey = 'recent';
let activeTags = new Set(); // 选中的标签 id（多选，或关系）

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const tagBar = document.getElementById('tagBar');
const tagList = document.getElementById('tagList');
const tagHint = document.getElementById('tagHint');

// 应用服务器同步的主题（与阅读器一致）
fetch('/api/settings').then(r => r.json()).then(s => {
  if (s.theme) { document.body.className = 'theme-' + s.theme; }
}).catch(() => {});

const TAG_COLORS = ['#c0584a','#d98a3f','#b5a642','#5a8a4a','#3f7a8a','#6a5a8a','#a04a7a','#7a6a5a'];
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function load() {
  const [b, t] = await Promise.all([api('/api/books'), api('/api/tags')]);
  books = b; tags = t;
  renderTagBar();
  render();
  document.getElementById('stat').textContent = `共 ${books.length} 本书 · 阅读 ${fmtTime(books.reduce((s, b) => s + (b.read_time || 0), 0))}`;
}

function sorted() {
  let arr = [...books];
  const q = document.getElementById('search').value.trim().toLowerCase();
  if (q) arr = arr.filter(b => (b.title || '').toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q));
  // 标签筛选
  if (activeTags.size) {
    if (activeTags.has('__none__')) {
      arr = arr.filter(b => !(b.tags && b.tags.length));
    } else {
      arr = arr.filter(b => b.tags && b.tags.some(t => activeTags.has(t.id)));
    }
  }
  switch (sortKey) {
    case 'name': arr.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh')); break;
    case 'added': arr.sort((a, b) => b.created_at - a.created_at); break;
    case 'progress': arr.sort((a, b) => (b.percent || 0) - (a.percent || 0)); break;
    default: arr.sort((a, b) => (b.last_read_at || b.created_at) - (a.last_read_at || a.created_at));
  }
  return arr;
}

function coverHTML(b) {
  if (b.cover) return `<img src="/api/books/${b.id}/cover" alt="" loading="lazy">`;
  const [c1, c2] = coverColors(b.title || '?');
  return `<div class="gen" style="--c1:${c1};--c2:${c2}">${escapeHtml((b.title || '无题').slice(0, 8))}</div>`;
}

function tagDotsHTML(b) {
  if (!b.tags || !b.tags.length) return '';
  return `<div class="tagdots">${b.tags.slice(0, 5).map(t => `<i style="background:${t.color}"></i>`).join('')}</div>`;
}

function renderTagBar() {
  if (!tags.length && !books.length) { tagBar.style.display = 'none'; return; }
  tagBar.style.display = 'flex';
  let html = '';
  // 未分类
  const untagged = books.filter(b => !(b.tags && b.tags.length)).length;
  html += `<button class="tag-chip untagged ${activeTags.has('__none__') ? 'active' : ''}" data-tag="__none__">未分类<span class="cnt">${untagged}</span></button>`;
  for (const t of tags) {
    const cnt = books.filter(b => b.tags && b.tags.some(x => x.id === t.id)).length;
    html += `<button class="tag-chip ${activeTags.has(t.id) ? 'active' : ''}" data-tag="${t.id}" style="${activeTags.has(t.id) ? `background:${t.color};border-color:${t.color}` : ''}">
      <span class="dot" style="background:${t.color}"></span>${escapeHtml(t.name)}<span class="cnt">${cnt}</span></button>`;
  }
  tagList.innerHTML = html;
}

function render() {
  const arr = sorted();
  const all = books.length;
  const showEmpty = arr.length === 0;
  empty.style.display = showEmpty && all === 0 ? 'block' : 'none';
  tagHint.style.display = showEmpty && all > 0 ? 'block' : 'none';
  grid.style.display = showEmpty ? 'none' : 'grid';
  grid.innerHTML = arr.map((b, i) => `
    <div class="book" data-id="${b.id}" style="animation-delay:${Math.min(i * 30, 400)}ms">
      <div class="cover">
        <div class="spine"></div>
        ${coverHTML(b)}
        ${tagDotsHTML(b)}
        ${(b.percent || 0) > 0 ? `<div class="prog"><i style="width:${Math.round(b.percent * 100)}%"></i></div>` : ''}
        <button class="info-btn" data-info="${b.id}" title="书籍详情">ⓘ</button>
        <button class="tag-edit" data-tag-edit="${b.id}" title="编辑标签">#</button>
        <button class="del" data-del="${b.id}" title="删除">✕</button>
      </div>
      <div class="meta">
        <p class="title">${escapeHtml(b.title)}</p>
        <div class="sub">
          <span class="fmt">${b.format}</span>
          ${b.tags && b.tags.length ? `<span>· ${escapeHtml(b.tags.map(t => t.name).join(' / '))}</span>` : (b.last_read_at ? `<span>· ${fmtDate(b.last_read_at)}</span>` : '')}
        </div>
      </div>
    </div>`).join('');
  grid.querySelectorAll('.book img').forEach(img => {
    img.addEventListener('error', () => {
      const book = books.find(x => x.id === img.closest('.book').dataset.id);
      if (book) { const wrap = img.parentElement; img.remove(); const [c1, c2] = coverColors(book.title || '?'); const d = document.createElement('div'); d.className = 'gen'; d.style.cssText = `--c1:${c1};--c2:${c2}`; d.textContent = (book.title || '无题').slice(0, 8); wrap.prepend(d); }
    });
  });
  renderContinue();
}

// ===== 继续阅读 =====
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString();
}

function renderContinue() {
  const el = document.getElementById('continue');
  const row = document.getElementById('continueRow');
  const more = document.getElementById('continueMore');
  const reading = books
    .filter(b => (b.percent || 0) > 0 && (b.percent || 0) < 1)
    .sort((a, b) => (b.last_read_at || 0) - (a.last_read_at || 0))
    .slice(0, 4);
  if (!reading.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  more.textContent = `${reading.length} 本在读`;
  row.innerHTML = reading.map(b => {
    const pct = Math.round(b.percent * 100);
    return `
      <div class="cont-card" data-read="${b.id}">
        <div class="c-cov">${coverHTML(b)}</div>
        <div class="c-info">
          <p class="c-t">${escapeHtml(b.title)}</p>
          <p class="c-p">${pct}%${b.last_read_at ? ' · 上次 ' + timeAgo(b.last_read_at) : ''}</p>
          <div class="c-bar"><i style="width:${pct}%"></i></div>
        </div>
      </div>`;
  }).join('');
}

document.addEventListener('click', e => {
  const cont = e.target.closest('.cont-card');
  if (cont) { location.href = `/reader.html?id=${cont.dataset.read}`; return; }
});

grid.addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  const tagEdit = e.target.closest('[data-tag-edit]');
  const info = e.target.closest('[data-info]');
  if (del) {
    e.stopPropagation();
    if (confirm('确定删除这本书？相关进度与笔记也会清除。')) {
      api(`/api/books/${del.dataset.del}`, { method: 'DELETE' }).then(() => { toast('已删除'); load(); });
    }
    return;
  }
  if (tagEdit) {
    e.stopPropagation();
    openTagModal(tagEdit.dataset.tagEdit);
    return;
  }
  if (info) {
    e.stopPropagation();
    openBookDetail(info.dataset.info);
    return;
  }
  const card = e.target.closest('.book');
  if (card) location.href = `/reader.html?id=${card.dataset.id}`;
});

// ===== 标签筛选条交互 =====
tagList.addEventListener('click', e => {
  const chip = e.target.closest('.tag-chip');
  if (!chip) return;
  const id = chip.dataset.tag;
  if (activeTags.has(id)) activeTags.delete(id); else activeTags.add(id);
  renderTagBar(); render();
});
document.querySelector('.tag-chip[data-tag=""]').addEventListener('click', () => {
  activeTags.clear(); renderTagBar(); render();
});

// ===== 标签编辑弹窗 =====
const tagModal = document.getElementById('tagModal');
let editingBookId = null;
let newTagColor = TAG_COLORS[0];

function openTagModal(bookId) {
  editingBookId = bookId;
  const b = books.find(x => x.id === bookId);
  document.getElementById('tagBookTitle').textContent = b.title;
  renderTagPick();
  newTagColor = TAG_COLORS[0];
  document.getElementById('newTagColor').style.background = newTagColor;
  document.getElementById('newTagName').value = '';
  document.getElementById('tagPalette').style.display = 'none';
  tagModal.style.display = 'flex';
}
function renderTagPick() {
  const b = books.find(x => x.id === editingBookId);
  const have = new Set((b.tags || []).map(t => t.id));
  const el = document.getElementById('tagPick');
  if (!tags.length) { el.innerHTML = '<span style="color:var(--ink-soft);font-size:13px">还没有标签，在下方新建一个吧</span>'; return; }
  el.innerHTML = tags.map(t => {
    const on = have.has(t.id);
    return `<label class="${on ? 'on' : ''}" data-tid="${t.id}" style="${on ? `background:${t.color}` : ''}">
      <span class="dot" style="background:${t.color}"></span>${escapeHtml(t.name)}${on ? '<span class="x">✕</span>' : ''}</label>`;
  }).join('');
}
document.getElementById('tagPick').addEventListener('click', async e => {
  const lab = e.target.closest('label'); if (!lab) return;
  const tid = lab.dataset.tid;
  const b = books.find(x => x.id === editingBookId);
  const have = new Set((b.tags || []).map(t => t.id));
  const next = have.has(tid) ? (b.tags || []).filter(t => t.id !== tid) : [...(b.tags || []), tags.find(t => t.id === tid)];
  await api(`/api/books/${editingBookId}/tags`, { method: 'PUT', body: { tagIds: next.map(t => t.id) } });
  b.tags = next;
  renderTagPick();
});

// 新建标签
document.getElementById('newTagColor').addEventListener('click', () => {
  const p = document.getElementById('tagPalette');
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
  if (p.style.display === 'flex') {
    p.innerHTML = TAG_COLORS.map(c => `<span class="sw ${c === newTagColor ? 'on' : ''}" style="background:${c}" data-c="${c}"></span>`).join('');
  }
});
document.getElementById('tagPalette').addEventListener('click', e => {
  const sw = e.target.closest('.sw'); if (!sw) return;
  newTagColor = sw.dataset.c;
  document.getElementById('newTagColor').style.background = newTagColor;
  document.querySelectorAll('#tagPalette .sw').forEach(x => x.classList.toggle('on', x.dataset.c === newTagColor));
});
document.getElementById('newTagAdd').addEventListener('click', async () => {
  const name = document.getElementById('newTagName').value.trim();
  if (!name) return toast('请输入标签名');
  try {
    const t = await api('/api/tags', { method: 'POST', body: { name, color: newTagColor } });
    tags.push(t);
    // 自动给当前书打上
    const b = books.find(x => x.id === editingBookId);
    const next = [...(b.tags || []), t];
    await api(`/api/books/${editingBookId}/tags`, { method: 'PUT', body: { tagIds: next.map(x => x.id) } });
    b.tags = next;
    document.getElementById('newTagName').value = '';
    renderTagPick(); renderTagBar(); render();
    toast('标签已创建并添加');
  } catch (e) { toast(e.message, 3000); }
});
document.getElementById('newTagName').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('newTagAdd').click(); });

// ===== 标签管理弹窗 =====
const tagManageModal = document.getElementById('tagManageModal');
document.getElementById('tagManageBtn').addEventListener('click', () => { renderTagMng(); tagManageModal.style.display = 'flex'; });
function renderTagMng() {
  const el = document.getElementById('tagMngList');
  if (!tags.length) { el.innerHTML = '<div class="tag-mng-empty">还没有标签</div>'; return; }
  el.innerHTML = tags.map(t => {
    const cnt = books.filter(b => b.tags && b.tags.some(x => x.id === t.id)).length;
    return `<div class="tag-mng-item" data-tid="${t.id}">
      <span class="dot" style="background:${t.color}"></span>
      <input class="mng-name" value="${escapeHtml(t.name)}" maxlength="12">
      <input class="mng-color" type="color" value="${t.color}" style="width:32px;height:30px;padding:0;border:1px solid var(--line);border-radius:6px;background:transparent;">
      <span class="cnt">${cnt}本</span>
      <button class="save">保存</button>
      <button class="del">删除</button>
    </div>`;
  }).join('');
}
document.getElementById('tagMngList').addEventListener('click', async e => {
  const item = e.target.closest('.tag-mng-item'); if (!item) return;
  const tid = item.dataset.tid;
  if (e.target.classList.contains('save')) {
    const name = item.querySelector('.mng-name').value.trim();
    const color = item.querySelector('.mng-color').value;
    if (!name) return toast('标签名不能为空');
    try {
      const t = await api(`/api/tags/${tid}`, { method: 'PUT', body: { name, color } });
      const idx = tags.findIndex(x => x.id === tid); tags[idx] = t;
      books.forEach(b => { if (b.tags) b.tags = b.tags.map(x => x.id === tid ? t : x); });
      renderTagBar(); render();
      toast('已保存');
    } catch (err) { toast(err.message, 3000); }
  }
  if (e.target.classList.contains('del')) {
    if (!confirm('删除该标签？所有书的该标签会被移除。')) return;
    await api(`/api/tags/${tid}`, { method: 'DELETE' });
    tags = tags.filter(x => x.id !== tid);
    books.forEach(b => { if (b.tags) b.tags = b.tags.filter(x => x.id !== tid); });
    activeTags.delete(tid);
    renderTagMng(); renderTagBar(); render();
    toast('已删除');
  }
});

// 关闭弹窗
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => {
  const id = el.dataset.close;
  document.getElementById(id).style.display = 'none';
  document.dispatchEvent(new CustomEvent('modal-closed', { detail: { id } }));
}));

// ===== 上传 =====
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const uploadBtn = document.getElementById('uploadBtn');

function uploadFiles(files) {
  const list = [...files].filter(f => /\.(txt|pdf|epub)$/i.test(f.name));
  if (!list.length) return toast('请选择 TXT / PDF / EPUB 文件');
  toast(`正在上传 ${list.length} 本…`, 4000);
  Promise.all(list.map(f => {
    const fd = new FormData(); fd.append('file', f);
    return fetch('/api/books/upload', { method: 'POST', body: fd })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('上传失败')));
  })).then(() => { toast('上传完成'); load(); })
    .catch(e => toast(e.message, 3000));
}
fileInput.addEventListener('change', e => uploadFiles(e.target.files));
uploadBtn.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('click', () => fileInput.click());
['dragover', 'dragenter'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', e => uploadFiles(e.dataTransfer.files));
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { e.preventDefault(); if (e.target.closest('.book') === null) uploadFiles(e.dataTransfer.files); });

document.getElementById('search').addEventListener('input', render);
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active'); sortKey = c.dataset.sort; render();
}));

// ===== 书籍详情 =====
let detailBook = null;
async function openBookDetail(id) {
  detailBook = books.find(b => b.id === id) || await api(`/api/books/${id}`);
  if (!detailBook) return toast('书籍不存在');
  document.getElementById('detailTitle').value = detailBook.title || '';
  document.getElementById('detailAuthor').value = detailBook.author || '';
  document.getElementById('detailCover').innerHTML = coverHTML(detailBook);
  renderDetailTags();
  renderDetailStats();
  document.getElementById('bookDetailModal').style.display = 'flex';
}

function renderDetailTags() {
  const el = document.getElementById('detailTags');
  const tagsHTML = (detailBook.tags || []).map(t =>
    `<span class="dt" style="border-color:${t.color};background:${t.color}22;color:${t.color}" data-rm-tag="${t.id}">${escapeHtml(t.name)}<span class="x">×</span></span>`
  ).join('');
  el.innerHTML = `${tagsHTML}<span class="dt dt-add" id="dtAdd">+ 添加标签</span>`;
}

function renderDetailStats() {
  const b = detailBook;
  const fmt = b.format ? b.format.toUpperCase() : '-';
  const sizeKB = b.size ? (b.size / 1024).toFixed(1) + ' KB' : '-';
  const pct = b.percent ? Math.round(b.percent * 100) + '%' : '未开始';
  const added = b.created_at ? new Date(b.created_at).toLocaleDateString('zh-CN') : '-';
  const lastRead = b.last_read_at ? timeAgo(b.last_read_at) : '从未';
  const readMin = b.read_time ? fmtTime(b.read_time) : '0 分钟';
  const pages = b.total_pages || '-';
  const el = document.getElementById('detailStats');
  el.innerHTML = `
    <div class="row"><span class="k">格式</span><span class="v">${fmt}</span></div>
    <div class="row"><span class="k">大小</span><span class="v">${sizeKB}</span></div>
    <div class="row"><span class="k">阅读进度</span><span class="v">${pct}</span></div>
    <div class="row"><span class="k">总页数/章</span><span class="v">${pages}</span></div>
    <div class="row"><span class="k">累计阅读</span><span class="v">${readMin}</span></div>
    <div class="row"><span class="k">上次阅读</span><span class="v">${lastRead}</span></div>
    <div class="row"><span class="k">笔记数</span><span class="v">${b.notes_count || 0}</span></div>
    <div class="row"><span class="k">书签数</span><span class="v">${b.bookmarks_count || 0}</span></div>
    <div class="row full"><span class="k">添加时间</span><span class="v">${added}</span></div>
  `;
}

// 详情里点"添加标签"→复用标签编辑弹窗
document.getElementById('detailTags').addEventListener('click', e => {
  const rm = e.target.closest('[data-rm-tag]');
  const add = e.target.closest('#dtAdd');
  if (rm) {
    api(`/api/books/${detailBook.id}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tag_ids: (detailBook.tags || []).filter(t => t.id !== rm.dataset.rmTag).map(t => t.id) })
    }).then(() => {
      detailBook.tags = detailBook.tags.filter(t => t.id !== rm.dataset.rmTag);
      renderDetailTags();
    });
  } else if (add) {
    openTagModal(detailBook.id);
  }
});

// 标签弹窗关闭后，若详情仍开着则刷新
document.addEventListener('modal-closed', e => {
  if (e.detail.id === 'tagModal' && detailBook && document.getElementById('bookDetailModal').style.display === 'flex') {
    api(`/api/books/${detailBook.id}`).then(b => {
      detailBook = b;
      renderDetailTags();
      renderDetailStats();
    });
  }
});

document.getElementById('detailSave').addEventListener('click', async () => {
  const title = document.getElementById('detailTitle').value.trim();
  const author = document.getElementById('detailAuthor').value.trim();
  if (!title) return toast('书名不能为空');
  await api(`/api/books/${detailBook.id}`, {
    method: 'PUT',
    body: JSON.stringify({ title, author })
  });
  const b = books.find(x => x.id === detailBook.id);
  if (b) { b.title = title; b.author = author; }
  toast('已保存');
  document.getElementById('bookDetailModal').style.display = 'none';
  render();
});

document.getElementById('detailRead').addEventListener('click', () => {
  location.href = `/reader.html?id=${detailBook.id}`;
});

load();
