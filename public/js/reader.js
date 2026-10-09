// ===================== 阅读器主逻辑 =====================
const params = new URLSearchParams(location.search);
const BOOK_ID = params.get('id');
if (!BOOK_ID) location.href = '/';

let book = null, fmt = null;
const SETTINGS_KEYS = ['theme', 'fontSize', 'lineHeight', 'font', 'pageWidth'];
const SETTINGS_DEFAULTS = { theme: 'light', fontSize: 20, lineHeight: 1.9, font: 'serif', pageWidth: 760 };
let settings = Object.fromEntries(SETTINGS_KEYS.map(k => [k, LS.get(k, SETTINGS_DEFAULTS[k])]));

// ----- 图标 -----
document.getElementById('btnBack').innerHTML = ICONS.back;
document.getElementById('btnToc').innerHTML = ICONS.toc;
document.getElementById('btnBm').innerHTML = ICONS.bm;
document.getElementById('btnNotes').innerHTML = ICONS.note;
document.getElementById('btnSet').innerHTML = ICONS.gear;
document.getElementById('btnFull').innerHTML = ICONS.expand;
document.querySelectorAll('[data-close]').forEach(b => b.innerHTML = ICONS.close);
document.getElementById('prevPage').innerHTML = ICONS.left;
document.getElementById('nextPage').innerHTML = ICONS.right;

// ----- 主题/样式应用 -----
const body = document.body;
function applySettings() {
  body.className = 'theme-' + settings.theme;
  const root = document.documentElement;
  root.style.setProperty('--r-fs', settings.fontSize + 'px');
  root.style.setProperty('--r-lh', settings.lineHeight);
  root.style.setProperty('--r-read-font', settings.font === 'serif' ? 'var(--serif)' : 'var(--sans)');
  document.getElementById('pageWrap').style.maxWidth = settings.pageWidth + 'px';
  // 设置面板回显
  document.getElementById('fontSize').value = settings.fontSize;
  document.getElementById('lineHeight').value = settings.lineHeight;
  document.getElementById('pageWidth').value = settings.pageWidth;
  document.getElementById('fsVal').textContent = settings.fontSize + 'px';
  document.getElementById('lhVal').textContent = settings.lineHeight;
  document.getElementById('pwVal').textContent = settings.pageWidth;
  document.querySelectorAll('.theme-grid button').forEach(b => b.classList.toggle('on', b.dataset.theme === settings.theme));
  document.querySelectorAll('.font-grid button').forEach(b => b.classList.toggle('on', b.dataset.font === settings.font));
  if (fmt === 'txt' && txtReady) relayoutTxt();
}
function saveSettings() {
  SETTINGS_KEYS.forEach(k => LS.set(k, settings[k]));
  syncSettingsToServer();
}
let _syncTimer = null;
function syncSettingsToServer() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    const payload = Object.fromEntries(SETTINGS_KEYS.map(k => [k, settings[k]]));
    fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .catch(() => {});
  }, 600);
}
// 启动时从服务器拉取设置，覆盖本地（服务器为准，实现跨设备同步）
fetch('/api/settings').then(r => r.json()).then(srv => {
  let changed = false;
  for (const k of SETTINGS_KEYS) {
    if (srv[k] !== undefined && srv[k] !== settings[k]) { settings[k] = srv[k]; changed = true; }
  }
  if (changed) { SETTINGS_KEYS.forEach(k => LS.set(k, settings[k])); applySettings(); }
}).catch(() => {});

// ====== UI 事件 ======
document.getElementById('btnBack').onclick = () => { saveProgressNow(); setTimeout(() => location.href = '/', 200); };
document.getElementById('btnToc').onclick = () => toggleSide('tocSide');
document.getElementById('btnNotes').onclick = () => toggleSide('noteSide');
document.getElementById('btnBm').onclick = () => addBookmarkAtCursor();
document.getElementById('btnSet').onclick = () => document.getElementById('setSheet').style.display = 'block';
document.getElementById('btnFull').onclick = toggleFullscreen;
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => {
  const t = b.dataset.close;
  if (t === 'toc') document.getElementById('tocSide').classList.remove('open');
  if (t === 'note') document.getElementById('noteSide').classList.remove('open');
  if (t === 'set') document.getElementById('setSheet').style.display = 'none';
  if (t === 'modal') closeNoteModal();
});

function toggleSide(id) {
  const el = document.getElementById(id);
  const other = id === 'tocSide' ? 'noteSide' : 'tocSide';
  const open = el.classList.contains('open');
  document.getElementById(other).classList.remove('open');
  el.classList.toggle('open', !open);
}

// 设置面板
document.getElementById('fontSize').oninput = e => { settings.fontSize = +e.target.value; document.getElementById('fsVal').textContent = e.target.value + 'px'; applySettings(); saveSettings(); };
document.getElementById('lineHeight').oninput = e => { settings.lineHeight = +e.target.value; document.getElementById('lhVal').textContent = e.target.value; applySettings(); saveSettings(); };
document.getElementById('pageWidth').oninput = e => { settings.pageWidth = +e.target.value; document.getElementById('pwVal').textContent = e.target.value; applySettings(); saveSettings(); };
document.querySelectorAll('.theme-grid button').forEach(b => b.onclick = () => { settings.theme = b.dataset.theme; applySettings(); saveSettings(); });
document.querySelectorAll('.font-grid button').forEach(b => b.onclick = () => { settings.font = b.dataset.font; applySettings(); saveSettings(); });

// 右栏 tab
document.querySelectorAll('.side-tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.side-tabs button').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  const tab = b.dataset.tab;
  document.getElementById('notesList').style.display = tab === 'notes' ? 'block' : 'none';
  document.getElementById('bmList').style.display = tab === 'bookmarks' ? 'block' : 'none';
  document.getElementById('noteHead').textContent = tab === 'notes' ? '笔记' : '书签';
});

// ====== 进度保存 ======
let progressTimer = null;
function saveProgressNow() { if (currentPosition) api(`/api/books/${BOOK_ID}/progress`, { method: 'PUT', body: { position: currentPosition, percent: currentPercent, read_time: readSeconds } }); }
function scheduleSave() { clearTimeout(progressTimer); progressTimer = setTimeout(saveProgressNow, 800); }
let currentPosition = null, currentPercent = 0, readSeconds = 0;
let readTick = setInterval(() => { readSeconds++; if (readSeconds % 30 === 0) scheduleSave(); }, 1000);

// ====== 全屏 ======
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

// ====== 键盘 ======
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  switch (e.key) {
    case 'ArrowLeft': fmt === 'txt' ? goTxtPage(-1) : fmt === 'pdf' ? navPdf(-1) : navEpub(-1); break;
    case 'ArrowRight': fmt === 'txt' ? goTxtPage(1) : fmt === 'pdf' ? navPdf(1) : navEpub(1); break;
    case 'b': case 'B': addBookmarkAtCursor(); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 's': case 'S': document.getElementById('setSheet').style.display = 'block'; break;
    case 't': case 'T': toggleSide('tocSide'); break;
    case 'n': case 'N': toggleSide('noteSide'); break;
    case 'Escape': if (document.getElementById('setSheet').style.display === 'block') document.getElementById('setSheet').style.display = 'none'; else if (document.fullscreenElement) document.exitFullscreen(); break;
  }
});

// ====== 划线/笔记浮窗 ======
const selPop = document.getElementById('selPop');
let pendingSelection = null;
function showSelPop(rect, hasText) {
  if (!hasText) { selPop.style.display = 'none'; return; }
  selPop.style.display = 'flex';
  const pop = selPop.getBoundingClientRect();
  let x = rect.left + rect.width / 2 - pop.width / 2;
  let y = rect.top - pop.height - 12;
  x = Math.max(8, Math.min(x, window.innerWidth - pop.width - 8));
  y = y < 8 ? rect.bottom + 12 : y;
  selPop.style.left = x + 'px'; selPop.style.top = y + 'px';
}
selPop.querySelectorAll('button').forEach(b => b.onclick = () => {
  const act = b.dataset.act;
  if (act === 'copy') { navigator.clipboard.writeText(pendingSelection.text); toast('已复制'); }
  else if (act === 'hl') openNoteModal(pendingSelection, true);
  else if (act === 'note') openNoteModal(pendingSelection, false);
  selPop.style.display = 'none';
});

// ====== 笔记弹窗 ======
const noteModal = document.getElementById('noteModal');
let modalContext = null; // {loc, text, asHighlight}
let editColor = 'yellow';
function openNoteModal(sel, asHighlight) {
  modalContext = { ...sel, asHighlight };
  document.getElementById('noteQuote').textContent = sel.text;
  document.getElementById('noteText').value = sel.existingNote || '';
  editColor = sel.existingColor || 'yellow';
  document.querySelectorAll('#colorRow button').forEach(b => b.classList.toggle('on', b.dataset.color === editColor));
  document.getElementById('colorRow').style.display = asHighlight ? 'flex' : 'none';
  noteModal.style.display = 'flex';
  setTimeout(() => document.getElementById('noteText').focus(), 50);
}
function closeNoteModal() { noteModal.style.display = 'none'; modalContext = null; }
document.querySelectorAll('#colorRow button').forEach(b => b.onclick = () => { editColor = b.dataset.color; document.querySelectorAll('#colorRow button').forEach(x => x.classList.toggle('on', x === b)); });

// ====== 笔记/书签数据 ======
let notesCache = [], bmCache = [];
async function loadNotes() {
  notesCache = await api(`/api/books/${BOOK_ID}/notes`);
  bmCache = await api(`/api/books/${BOOK_ID}/bookmarks`);
  renderNotesList(); renderBmList();
  document.getElementById('noteCount').textContent = notesCache.length ? `(${notesCache.length})` : '';
  document.getElementById('bmCount').textContent = bmCache.length ? `(${bmCache.length})` : '';
}
function renderNotesList() {
  const el = document.getElementById('notesList');
  if (!notesCache.length) { el.innerHTML = '<div class="list-empty">还没有笔记<br><span style="font-size:12px">选中文字即可划线或添加笔记</span></div>'; return; }
  el.innerHTML = notesCache.map(n => `
    <div class="note-item" data-nid="${n.id}">
      <p class="q">${escapeHtml(n.selected_text || '')}</p>
      ${n.note ? `<div class="my">${escapeHtml(n.note)}</div>` : ''}
      <div class="time">${fmtDate(n.created_at)}</div>
      <div class="acts"><button data-edit="${n.id}">编辑</button><button data-del="${n.id}">删除</button></div>
    </div>`).join('');
}
function renderBmList() {
  const el = document.getElementById('bmList');
  if (!bmCache.length) { el.innerHTML = '<div class="list-empty">还没有书签<br><span style="font-size:12px">按 B 在当前位置添加书签</span></div>'; return; }
  el.innerHTML = bmCache.map(b => `
    <div class="note-item" data-bid="${b.id}">
      <div class="my">${escapeHtml(b.label || '书签')}</div>
      <div class="time">${fmtDate(b.created_at)}</div>
      <div class="acts"><button data-bdel="${b.id}">删除</button></div>
    </div>`).join('');
}
document.getElementById('notesList').addEventListener('click', e => {
  const edit = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
  const item = e.target.closest('[data-nid]');
  if (del) { api(`/api/books/${BOOK_ID}/notes/${del.dataset.del}`, { method: 'DELETE' }).then(() => { loadNotes(); if (fmt === 'txt') rebuildTxtHighlights(); }); return; }
  if (edit) { const n = notesCache.find(x => x.id === edit.dataset.edit); openNoteModal({ loc: parsePos(n.position), locEnd: parsePos(n.position_end), text: n.selected_text, existingNote: n.note, existingColor: n.color, id: n.id }, true); return; }
  if (item) { const n = notesCache.find(x => x.id === item.dataset.nid); if (n) jumpToNote(n); }
});
document.getElementById('bmList').addEventListener('click', e => {
  const del = e.target.closest('[data-bdel]'); const item = e.target.closest('[data-bid]');
  if (del) { api(`/api/books/${BOOK_ID}/bookmarks/${del.dataset.bdel}`, { method: 'DELETE' }).then(loadNotes); return; }
  if (item) { const b = bmCache.find(x => x.id === item.dataset.bid); if (b) jumpToBookmark(b); }
});
function parsePos(s) { try { return JSON.parse(s); } catch { return null; } }
function jumpToNote(n) { if (fmt === 'txt') jumpTxtOffset(parsePos(n.position)); else if (fmt === 'epub') renditionEpub.display(parsePos(n.position).cfi); else if (fmt === 'pdf') goPdfPage(parsePos(n.position).page); }
function jumpToBookmark(b) { const p = parsePos(b.position); if (fmt === 'txt') goTxtPageIdx(p.page); else if (fmt === 'epub') renditionEpub.display(p.cfi); else if (fmt === 'pdf') goPdfPage(p.page); }

async function addBookmarkAtCursor() {
  if (!currentPosition) return;
  let label = '';
  if (fmt === 'txt') label = `第 ${currentPosition.page + 1} 页`;
  else if (fmt === 'pdf') label = `第 ${currentPosition.page} 页`;
  else if (fmt === 'epub') label = (pendingEpubLocText || '当前位置');
  await api(`/api/books/${BOOK_ID}/bookmarks`, { method: 'POST', body: { position: currentPosition, label } });
  toast('已加书签'); loadNotes();
}

// ============================================================
//                       TXT 阅读器
// ============================================================
let rawText = '', txtChapters = [], txtReady = false;
let txtPage = 0, txtTotal = 1, txtPitch = 0;
const txtView = document.getElementById('txtView');

async function initTxt() {
  document.getElementById('txtView').style.display = 'block';
  document.getElementById('txtPager').style.display = 'flex';
  document.getElementById('fontRow').style.display = 'flex';
  const res = await fetch(`/api/books/${BOOK_ID}/text`);
  rawText = await res.text();
  // 章节检测
  txtChapters = detectChapters(rawText);
  renderTxtToc();
  await loadNotes();
  buildTxtDom();
  // 恢复进度
  const pr = await api(`/api/books/${BOOK_ID}/progress`);
  const pos = parsePos(pr.position);
  relayoutTxt();
  // 跳到上次位置（若有对应章节则跳章节，否则按页）
  if (pos && typeof pos.page === 'number') goTxtPageIdx(pos.page, true);
  txtReady = true;
  // 选区
  document.addEventListener('mouseup', onTxtSel);
}

function detectChapters(text) {
  const re = /^\s*(第[\s零一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟0-9]+[章节回卷集部篇]|序章|楔子|引子|前言|序言|尾声|后记|结语|番外篇?|Chapter\s+\d+|CHAPTER\s+\d+|卷[零一二三四五六七八九十0-9]+)[\s:：、].*$/m;
  const chapters = []; let m; re.lastIndex = 0;
  // 按行扫描更稳
  const lines = text.split('\n');
  let off = 0;
  for (const line of lines) {
    const lm = line.match(/^\s*(第[\s零一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟0-9]+[章节回卷集部篇]|序章|楔子|引子|前言|序言|尾声|后记|结语|番外篇?|Chapter\s+\d+|CHAPTER\s+\d+|卷[零一二三四五六七八九十0-9]+)\s*[：:、.\s]*(.*)$/);
    if (lm) chapters.push({ title: line.trim(), offset: off });
    off += line.length + 1;
  }
  return chapters;
}

function renderTxtToc() {
  const el = document.getElementById('tocList');
  if (!txtChapters.length) { el.innerHTML = '<div class="list-empty">未检测到章节</div>'; return; }
  el.innerHTML = txtChapters.map((c, i) => `<div class="toc-item" data-co="${c.offset}"><span class="n">${i + 1}</span>${escapeHtml(c.title.slice(0, 40))}</div>`).join('');
  el.querySelectorAll('.toc-item').forEach(it => it.onclick = () => jumpTxtOffset(+it.dataset.co));
}

function buildTxtDom() {
  txtView.innerHTML = '';
  txtView.style.cssText = `column-width:${settings.pageWidth}px;column-gap:48px;height:calc(100vh - 150px);width:${settings.pageWidth}px;overflow:hidden;white-space:pre-wrap;word-break:break-word;`;
  txtView.appendChild(buildRuns(rawText, txtChapters, notesCache));
}
function buildRuns(raw, chapters, notes) {
  const chapRanges = chapters.map(c => ({ s: c.offset, e: c.offset + c.title.length }));
  const pts = new Set([0, raw.length]);
  chapRanges.forEach(r => { pts.add(r.s); pts.add(r.e); });
  notes.forEach(n => { const p = parsePos(n.position); if (p && typeof p.start === 'number') { pts.add(p.start); pts.add(p.end); } });
  const arr = [...pts].filter(x => x >= 0 && x <= raw.length).sort((a, b) => a - b);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1]; if (b <= a) continue;
    const text = raw.slice(a, b);
    const hl = notes.find(n => { const p = parsePos(n.position); return p && a >= p.start && a < p.end; });
    const inChap = chapRanges.find(r => a >= r.s && a < r.e);
    let el;
    if (hl) { el = document.createElement('mark'); el.className = 'hl txt-hl'; el.dataset.id = hl.id; el.style.background = hlColor(parsePos(hl.position) && hl.color); el.title = hl.note ? '点击查看笔记' : '划线'; }
    else if (inChap) { el = document.createElement('span'); el.className = 'txt-chap-title'; }
    else { el = document.createElement('span'); }
    el.dataset.o = a; el.textContent = text; frag.appendChild(el);
  }
  return frag;
}
function hlColor(c) { return ({ yellow: 'rgba(245,215,110,.45)', green: 'rgba(150,200,90,.4)', blue: 'rgba(120,180,235,.4)', pink: 'rgba(235,140,180,.4)' })[c] || 'rgba(245,215,110,.45)'; }

function relayoutTxt() {
  if (!txtView.firstChild) return;
  txtPitch = settings.pageWidth + 48;
  txtTotal = Math.max(1, Math.round((txtView.scrollWidth + 48) / txtPitch));
  const slider = document.getElementById('pageRange'); slider.max = txtTotal; slider.value = txtPage + 1;
  applyTxtTransform();
}
function applyTxtTransform() { txtView.style.transform = `translateX(${-txtPage * txtPitch}px)`; updateTxtPager(); }
function updateTxtPager() {
  document.getElementById('pagePos').textContent = `${txtPage + 1} / ${txtTotal}`;
  document.getElementById('pageRange').value = txtPage + 1;
  document.getElementById('prevPage').disabled = txtPage <= 0;
  document.getElementById('nextPage').disabled = txtPage >= txtTotal - 1;
  currentPosition = { page: txtPage };
  currentPercent = (txtPage + 1) / txtTotal;
  scheduleSave();
}
function goTxtPage(d) { goTxtPageIdx(txtPage + d); }
function goTxtPageIdx(p, silent) {
  if (!txtReady && !silent) return;
  p = Math.max(0, Math.min(txtTotal - 1, p)); txtPage = p; applyTxtTransform();
  document.getElementById('viewport').scrollTop = 0;
}
function jumpTxtOffset(offset) {
  // 找到包含 offset 的列
  const saved = txtView.style.transform; txtView.style.transform = 'translateX(0)';
  let best = null;
  for (const el of txtView.querySelectorAll('[data-o]')) {
    const o = +el.dataset.o, l = el.textContent.length;
    if (offset >= o && offset < o + l) { const r = el.getBoundingClientRect(); best = Math.round((r.left - txtView.getBoundingClientRect().left) / txtPitch); break; }
    if (o > offset) { const r = el.getBoundingClientRect(); best = Math.round((r.left - txtView.getBoundingClientRect().left) / txtPitch); break; }
  }
  txtView.style.transform = saved;
  if (best == null) best = 0;
  goTxtPageIdx(Math.max(0, Math.min(txtTotal - 1, best)));
}
document.getElementById('prevPage').onclick = () => navByFmt(-1);
document.getElementById('nextPage').onclick = () => navByFmt(1);
document.getElementById('pageRange').oninput = e => goTxtPageIdx(+e.target.value - 1);
function navByFmt(d) { if (fmt === 'txt') goTxtPage(d); else if (fmt === 'pdf') navPdf(d); else if (fmt === 'epub') navEpub(d); }

function onTxtSel() {
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { selPop.style.display = 'none'; return; }
    if (!sel.anchorNode || !sel.anchorNode.parentElement?.closest('#txtView')) { selPop.style.display = 'none'; return; }
    const o = txtSelToOffset(sel);
    if (!o) { selPop.style.display = 'none'; return; }
    pendingSelection = { loc: { start: o.start, end: o.end }, locEnd: { start: o.start, end: o.end }, text: o.text };
    showSelPop(sel.getRangeAt(0).getBoundingClientRect(), !!o.text);
  }, 10);
}
function txtSelToOffset(sel) {
  const range = sel.getRangeAt(0);
  const start = nodeOffset(range.startContainer, range.startOffset);
  const end = nodeOffset(range.endContainer, range.endOffset);
  if (start == null || end == null || end <= start) return null;
  return { start, end, text: range.toString() };
}
function nodeOffset(node, offset) {
  let el = node.nodeType === 3 ? node.parentElement : node;
  while (el && !el.dataset?.o) el = el.parentElement;
  if (!el || !el.closest('#txtView')) return null;
  const base = +el.dataset.o;
  if (node.nodeType === 3 && node.parentElement === el) return base + offset;
  let o = base;
  for (let i = 0; i < offset && el.childNodes[i]; i++) o += el.childNodes[i].textContent.length;
  return o;
}
txtView.addEventListener('click', e => {
  const hl = e.target.closest('.txt-hl');
  if (!hl) return;
  const n = notesCache.find(x => x.id === hl.dataset.id);
  if (n) openNoteModal({ loc: parsePos(n.position), locEnd: parsePos(n.position_end), text: n.selected_text, existingNote: n.note, existingColor: n.color, id: n.id }, true);
});
function rebuildTxtHighlights() { const p = txtPage; buildTxtDom(); relayoutTxt(); goTxtPageIdx(Math.min(p, txtTotal - 1)); }

// ============================================================
//                       PDF 阅读器
// ============================================================
let pdfDoc = null, pdfPage = 1, pdfTotal = 1, pdfRenderTask = null;
const pdfView = document.getElementById('pdfView');
pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.min.js';

async function initPdf() {
  document.getElementById('pdfView').style.display = 'block';
  document.getElementById('txtPager').style.display = 'none';
  document.getElementById('fontRow').style.display = 'none';
  pdfView.innerHTML = '<canvas id="pdfCanvas"></canvas><div id="pdfTextLayer" class="textLayer"></div>';
  pdfDoc = await pdfjsLib.getDocument({ url: `/api/books/${BOOK_ID}/file` }).promise;
  pdfTotal = pdfDoc.numPages;
  await api(`/api/books/${BOOK_ID}`, { method: 'PUT', body: { total_pages: pdfTotal } });
  // 目录
  let outline = [];
  try { outline = await pdfDoc.getOutline() || []; } catch {}
  renderPdfToc(outline);
  await loadNotes();
  const pr = await api(`/api/books/${BOOK_ID}/progress`);
  const pos = parsePos(pr.position);
  pdfPage = (pos && pos.page) || 1;
  await renderPdfPage(pdfPage);
}
function renderPdfToc(outline) {
  const el = document.getElementById('tocList');
  if (!outline.length) { el.innerHTML = '<div class="list-empty">本书无目录</div>'; return; }
  el.innerHTML = outline.map((o, i) => `<div class="toc-item" data-dest="${escapeHtml(JSON.stringify(o))}"><span class="n">${i + 1}</span>${escapeHtml(o.title)}</div>`).join('');
  el.querySelectorAll('.toc-item').forEach(it => it.onclick = async () => {
    const o = JSON.parse(it.dataset.dest);
    try {
      let dest = o.dest;
      if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
      if (Array.isArray(dest) && dest[0]) { const idx = await pdfDoc.getPageIndex(dest[0]); goPdfPage(idx + 1); }
    } catch (e) { toast('无法跳转该目录', 2000); }
  });
}
async function renderPdfPage(n) {
  if (n < 1 || n > pdfTotal) return;
  pdfPage = n;
  const page = await pdfDoc.getPage(n);
  const containerW = pdfView.clientWidth - 8;
  const baseVp = page.getViewport({ scale: 1 });
  let scale = (containerW * 0.96) / baseVp.width;
  const maxH = window.innerHeight - 130;
  if (baseVp.height * scale > maxH) scale = maxH / baseVp.height;
  scale = Math.max(0.2, scale);
  const viewport = page.getViewport({ scale });
  pdfView.innerHTML = '';
  const wrap = document.createElement('div'); wrap.id = 'pdfWrap'; wrap.style.width = viewport.width + 'px';
  const canvas = document.createElement('canvas'); canvas.id = 'pdfCanvas';
  const layer = document.createElement('div'); layer.id = 'pdfTextLayer';
  wrap.appendChild(canvas); wrap.appendChild(layer); pdfView.appendChild(wrap);
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width; canvas.height = viewport.height;
  if (pdfRenderTask) try { pdfRenderTask.cancel(); } catch {}
  pdfRenderTask = page.render({ canvasContext: ctx, viewport });
  try { await pdfRenderTask.promise; } catch (e) { if (e && e.name !== 'RenderingCancelledException') throw e; return; }
  // 文本层（用于选中文字）
  try {
    const tc = await page.getTextContent();
    layer.style.width = viewport.width + 'px'; layer.style.height = viewport.height + 'px';
    const frag = document.createDocumentFragment();
    for (const it of tc.items) {
      if (!it.str) continue;
      const tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
      const fs = Math.hypot(tx[2], tx[3]);
      if (fs <= 0) continue;
      const span = document.createElement('span');
      span.textContent = it.str;
      span.style.left = tx[4] + 'px'; span.style.top = (tx[5] - fs) + 'px'; span.style.fontSize = fs + 'px';
      frag.appendChild(span);
    }
    layer.appendChild(frag);
  } catch {}
  currentPosition = { page: n }; currentPercent = n / pdfTotal;
  document.getElementById('txtPager').style.display = 'flex';
  const slider = document.getElementById('pageRange'); slider.max = pdfTotal; slider.value = n;
  document.getElementById('pagePos').textContent = `${n} / ${pdfTotal}`;
  document.getElementById('prevPage').disabled = n <= 1;
  document.getElementById('nextPage').disabled = n >= pdfTotal;
  document.getElementById('pageRange').oninput = e => goPdfPage(+e.target.value);
  scheduleSave();
  document.getElementById('viewport').scrollTop = 0;
}
function goPdfPage(n) { renderPdfPage(n); }
function navPdf(d) { goPdfPage(pdfPage + d); }
document.addEventListener('mouseup', () => {
  if (fmt !== 'pdf') return;
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { selPop.style.display = 'none'; return; }
    if (!sel.anchorNode || !sel.anchorNode.parentElement?.closest('#pdfTextLayer')) { selPop.style.display = 'none'; return; }
    const text = sel.toString();
    pendingSelection = { loc: { page: pdfPage }, locEnd: { page: pdfPage }, text };
    showSelPop(sel.getRangeAt(0).getBoundingClientRect(), !!text);
    document.querySelector('.sel-pop [data-act="hl"]').style.display = 'none';
  }, 10);
});

// ============================================================
//                       EPUB 阅读器
// ============================================================
let renditionEpub = null, epubBook = null, pendingEpubLocText = '';
const epubView = document.getElementById('epubView');

async function initEpub() {
  document.getElementById('epubView').style.display = 'block';
  document.getElementById('txtPager').style.display = 'none';
  document.getElementById('fontRow').style.display = 'flex';
  epubView.innerHTML = '';
  // 用 ArrayBuffer 传入，避免 epub.js 把 URL 当目录单独请求 container.xml
  const ab = await (await fetch(`/api/books/${BOOK_ID}/file`)).arrayBuffer();
  epubBook = ePub(ab, { encoding: 'binary' });
  renditionEpub = epubBook.renderTo(epubView, { width: '100%', height: '100%', spread: 'none', flow: 'paginated' });
  await renditionEpub.display();
  // 元数据
  try { const md = await epubBook.loaded.metadata; if ((md.title || book.title) && md.title) await api(`/api/books/${BOOK_ID}`, { method: 'PUT', body: { title: md.title, author: md.author || '' } }); } catch {}
  // 封面上传
  if (!book.cover) try { const cu = await epubBook.coverUrl(); if (cu) { const blob = await (await fetch(cu)).blob(); const fd = new FormData(); fd.append('cover', blob, 'cover.png'); await fetch(`/api/books/${BOOK_ID}/cover`, { method: 'POST', body: fd }); } } catch {}
  // 目录
  try { const nav = await epubBook.loaded.navigation; renderEpubToc(nav.toc); } catch {}
  await loadNotes();
  // 恢复进度
  const pr = await api(`/api/books/${BOOK_ID}/progress`);
  const pos = parsePos(pr.position);
  if (pos && pos.cfi) renditionEpub.display(pos.cfi);
  // 已有笔记高亮
  notesCache.forEach(n => { const p = parsePos(n.position); if (p && p.cfi) addEpubHighlight(p.cfi, n.color, n.id); });
  // 事件
  renditionEpub.on('relocated', onEpubRelocated);
  renditionEpub.on('selected', onEpubSelected);
  renditionEpub.on('rendered', () => applyEpubTheme());
  applyEpubTheme();
  // 翻页按钮
  document.getElementById('txtPager').style.display = 'flex';
  document.getElementById('pageRange').style.display = 'none';
  document.getElementById('pagePos').textContent = '';
}
function renderEpubToc(toc) {
  const el = document.getElementById('tocList');
  if (!toc.length) { el.innerHTML = '<div class="list-empty">无目录</div>'; return; }
  const walk = (items, depth) => items.map(it => `<div class="toc-item" style="padding-left:${18 + depth * 14}px" data-href="${escapeHtml(it.href)}"><span class="n">·</span>${escapeHtml(it.label)}</div>` + (it.subitems?.length ? walk(it.subitems, depth + 1) : '')).join('');
  el.innerHTML = walk(toc, 0);
  el.querySelectorAll('.toc-item').forEach(it => it.onclick = () => {
    const href = it.dataset.href;
    if (href && renditionEpub) renditionEpub.display(href);
  });
}
function onEpubRelocated(loc) {
  if (!loc || !loc.start) return;
  const cfi = loc.start.cfi;
  currentPosition = { cfi };
  currentPercent = loc.start.percentage || 0;
  pendingEpubLocText = loc.start?.location?.excerpt || '';
  document.getElementById('pagePos').textContent = Math.round(currentPercent * 100) + '%';
  scheduleSave();
}
function onEpubSelected(cfiRange, contents) {
  let text = '';
  try { text = contents.window.getSelection().toString(); } catch {}
  if (!text) { selPop.style.display = 'none'; return; }
  pendingSelection = { loc: { cfi: cfiRange }, locEnd: { cfi: cfiRange }, text };
  selPop.querySelector('[data-act="hl"]').style.display = 'flex';
  const range = contents.range || (contents.window.getSelection().getRangeAt(0));
  let rect;
  try { rect = range.getBoundingClientRect(); } catch { rect = { left: innerWidth / 2, top: innerHeight / 2, width: 0, bottom: innerHeight / 2 }; }
  showSelPop(rect, true);
}
function navEpub(d) { renditionEpub && renditionEpub.next ? (d > 0 ? renditionEpub.next() : renditionEpub.prev()) : null; }
function addEpubHighlight(cfi, color, id) {
  try { renditionEpub.annotations.add('highlight', cfi, { id }, undefined, 'epub-hl', { 'background-color': hlColor(color), 'fill': hlColor(color) }); } catch {}
}
function applyEpubTheme() {
  const th = settings.theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--r-bg');
  const fg = getComputedStyle(document.documentElement).getPropertyValue('--r-ink');
  try { renditionEpub.themes.override('color', fg); renditionEpub.themes.override('background', bg); renditionEpub.themes.fontSize(settings.fontSize + 'px'); renditionEpub.themes.font(settings.font === 'serif' ? 'serif' : 'sans-serif'); } catch {}
}
// epub 高亮点击
epubView.addEventListener('click', async (e) => {
  // 让 epub annotations 点击事件自己处理；这里兜底
});

// 笔记保存后对 epub 应用
document.getElementById('saveNote').onclick = async () => {
  if (!modalContext) return;
  const note = document.getElementById('noteText').value;
  const body = { position: modalContext.loc, position_end: modalContext.locEnd, selected_text: modalContext.text, note, color: editColor };
  let saved;
  if (modalContext.id) saved = await api(`/api/books/${BOOK_ID}/notes/${modalContext.id}`, { method: 'PUT', body: { note, color: editColor } });
  else saved = await api(`/api/books/${BOOK_ID}/notes`, { method: 'POST', body });
  closeNoteModal();
  await loadNotes();
  if (fmt === 'txt') rebuildTxtHighlights();
  if (fmt === 'epub' && saved && modalContext.loc?.cfi && !modalContext.id) addEpubHighlight(modalContext.loc.cfi, editColor, saved.id);
  toast('已保存');
};

// ============================================================
//                       启动
// ============================================================
async function init() {
  book = await api(`/api/books/${BOOK_ID}`);
  fmt = book.format;
  document.getElementById('rTitle').textContent = book.title;
  document.getElementById('rFmt').textContent = fmt.toUpperCase();
  applySettings();
  window.addEventListener('resize', debounce(() => { if (fmt === 'txt') { const p = txtPage; relayoutTxt(); goTxtPageIdx(Math.min(p, txtTotal - 1)); } if (fmt === 'pdf') renderPdfPage(pdfPage); }, 300));
  window.addEventListener('beforeunload', saveProgressNow);
  try {
    if (fmt === 'txt') await initTxt();
    else if (fmt === 'pdf') await initPdf();
    else if (fmt === 'epub') await initEpub();
  } catch (e) { toast('打开失败: ' + e.message, 4000); console.error(e); }
}
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

init();
