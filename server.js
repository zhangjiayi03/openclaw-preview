import express from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { createReadStream, statSync, existsSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import iconv from 'iconv-lite';
import JSZip from 'jszip';
import db, { stmts } from './db.js';
import { inferTagNames, ruleByName } from './tagger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const BOOKS_DIR = join(__dirname, 'data', 'books');

app.use(express.json({ limit: '5mb' }));
app.use('/static', express.static(BOOKS_DIR, { maxAge: '1d' }));

// --- 上传 ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BOOKS_DIR),
  filename: (req, file, cb) => {
    const id = randomUUID();
    const ext = extname(file.originalname).toLowerCase() || '.txt';
    cb(null, id + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (['.txt', '.pdf', '.epub'].includes(ext)) cb(null, true);
    else cb(new Error('仅支持 TXT / PDF / EPUB 格式'));
  },
});

function detectFormat(filename) {
  const ext = extname(filename).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.epub') return 'epub';
  return 'txt';
}
function titleFromName(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  return base.replace(/[_]+/g, ' ').trim() || '未命名';
}

// 从 EPUB 提取元数据文本（title/author/subject）用于标签推断
async function extractEpubMetaText(filePath) {
  try {
    const buf = readFileSync(filePath);
    const zip = await JSZip.loadAsync(buf);
    const container = await zip.file('META-INF/container.xml')?.async('string');
    if (!container) return '';
    const m = container.match(/full-path="([^"]+)"/);
    if (!m) return '';
    const opfPath = m[1];
    const opf = await zip.file(opfPath)?.async('string');
    if (!opf) return '';
    const parts = [];
    const tags = ['title', 'creator', 'subject', 'description', 'language'];
    for (const tag of tags) {
      const re = new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\\/dc:${tag}>`, 'gi');
      let mm;
      while ((mm = re.exec(opf)) !== null) parts.push(mm[1].replace(/<[^>]+>/g, ''));
    }
    return parts.join(' ');
  } catch { return ''; }
}

// 为一本书应用推断出的标签（自动建标签 + 关联）
function applyAutoTags(bookId, tagNames) {
  for (const name of tagNames) {
    let tag = stmts.getTagByName.get(name);
    if (!tag) {
      const rule = ruleByName(name);
      tag = { id: randomUUID(), name, color: rule?.color || '#9c5a3f', created_at: Date.now() };
      try { stmts.insertTag.run(tag); } catch { tag = stmts.getTagByName.get(name); }
    }
    if (tag) stmts.addBookTag.run(bookId, tag.id);
  }
}

app.post('/api/books/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const id = req.file.filename.replace(/\.[^.]+$/, '');
  // multer 对文件名按 latin1 解码，这里还原为 UTF-8 中文
  let originalName = req.file.originalname;
  try { if (/[\u00c0-\u00ff]/.test(originalName)) originalName = Buffer.from(originalName, 'latin1').toString('utf8'); } catch {}
  const format = detectFormat(originalName);
  const now = Date.now();
  const storedPath = join(BOOKS_DIR, req.file.filename);

  // 推断标签：TXT/PDF 用文件名；EPUB 额外读元数据
  let metaText = '';
  try {
    if (format === 'epub') metaText = await extractEpubMetaText(storedPath);
  } catch {}
  const tagNames = inferTagNames(`${originalName} ${metaText}`);

  const book = {
    id, title: titleFromName(originalName), author: '',
    filename: originalName, stored: req.file.filename,
    format, size: req.file.size, cover: '', total_pages: 0,
    created_at: now, updated_at: now,
  };
  stmts.insertBook.run(book);
  applyAutoTags(id, tagNames);

  const result = stmts.getBook.get(id);
  result.tags = stmts.getBookTags.all(id);
  result.auto_tags = tagNames;
  res.json(result);
});

// --- 列表 ---
function attachTags(rows) {
  const all = stmts.listAllBookTags.all();
  const map = {};
  for (const t of all) (map[t.bid] ||= []).push({ id: t.id, name: t.name, color: t.color });
  return rows.map(r => ({ ...r, tags: map[r.id] || [] }));
}
function attachCounts(rows) {
  const notesMap = {}, bmMap = {};
  for (const x of stmts.countNotesByBook.all()) notesMap[x.book_id] = x.c;
  for (const x of stmts.countBookmarksByBook.all()) bmMap[x.book_id] = x.c;
  return rows.map(r => ({ ...r, notes_count: notesMap[r.id] || 0, bookmarks_count: bmMap[r.id] || 0 }));
}
function enrich(rows) { return attachCounts(attachTags(rows)); }

app.get('/api/books', (req, res) => {
  res.json(enrich(stmts.listBooks.all().map(r => ({ ...r }))));
});

app.get('/api/books/:id', (req, res) => {
  const book = stmts.getBook.get(req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  res.json(enrich([book])[0]);
});

// 更新元数据（封面/页数/标题）
app.put('/api/books/:id', (req, res) => {
  const book = stmts.getBook.get(req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const { total_pages, cover, title, author } = req.body;
  const now = Date.now();
  if (title !== undefined || author !== undefined) {
    stmts.updateBookTitle.run({ id: req.params.id, title: title ?? book.title, author: author ?? book.author, updated_at: now });
  }
  if (total_pages !== undefined || cover !== undefined) {
    stmts.updateBookMeta.run({ id: req.params.id, total_pages: total_pages ?? book.total_pages, cover: cover ?? book.cover, updated_at: now });
  }
  res.json(stmts.getBook.get(req.params.id));
});

// 原始文件下载
app.get('/api/books/:id/file', (req, res) => {
  const book = stmts.getBook.get(req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const p = join(BOOKS_DIR, book.stored);
  if (!existsSync(p)) return res.status(404).json({ error: '文件丢失' });
  res.setHeader('Content-Type', 'application/octet-stream');
  createReadStream(p).pipe(res);
});

// 封面
app.get('/api/books/:id/cover', (req, res) => {
  const book = stmts.getBook.get(req.params.id);
  if (!book || !book.cover) return res.redirect('/static/placeholder.svg');
  const p = join(BOOKS_DIR, book.cover);
  if (!existsSync(p)) return res.redirect('/static/placeholder.svg');
  res.setHeader('Content-Type', 'image/png');
  createReadStream(p).pipe(res);
});

// 封面上传
app.post('/api/books/:id/cover', multer({ storage }).single('cover'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到封面' });
  const now = Date.now();
  stmts.updateBookMeta.run({ id: req.params.id, total_pages: 0, cover: req.file.filename, updated_at: now });
  res.json({ cover: req.file.filename });
});

app.delete('/api/books/:id', (req, res) => {
  const book = stmts.getBook.get(req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  stmts.deleteBook.run(req.params.id);
  res.json({ ok: true });
});

// --- TXT 文本（自动编码识别）---
app.get('/api/books/:id/text', (req, res) => {
  const book = stmts.getBook.get(req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const p = join(BOOKS_DIR, book.stored);
  if (!existsSync(p)) return res.status(404).json({ error: '文件丢失' });
  try {
    const buf = readFileSync(p);
    // 先按 UTF-8 解码，检测是否含替换字符来判断 GBK
    let text = buf.toString('utf8');
    const sample = text.slice(0, 4000);
    if (/\uFFFD/.test(sample) && /[\x80-\xff]/.test(buf.subarray(0, 4000))) {
      text = iconv.decode(buf, 'gbk');
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (e) {
    res.status(500).json({ error: '读取失败: ' + e.message });
  }
});

// --- 进度 ---
app.get('/api/books/:id/progress', (req, res) => {
  res.json(stmts.getProgress.get(req.params.id) || { book_id: req.params.id, position: null, percent: 0, read_time: 0, last_read_at: null });
});
app.put('/api/books/:id/progress', (req, res) => {
  const { position, percent, read_time } = req.body;
  const now = Date.now();
  const prev = stmts.getProgress.get(req.params.id);
  stmts.upsertProgress.run({
    book_id: req.params.id,
    position: position !== undefined ? JSON.stringify(position) : prev?.position,
    percent: percent !== undefined ? percent : prev?.percent || 0,
    read_time: read_time !== undefined ? read_time : (prev?.read_time || 0),
    last_read_at: now,
  });
  res.json({ ok: true });
});

// --- 书签 ---
app.get('/api/books/:id/bookmarks', (req, res) => res.json(stmts.listBookmarks.all(req.params.id)));
app.post('/api/books/:id/bookmarks', (req, res) => {
  const { position, label } = req.body;
  const id = randomUUID();
  stmts.addBookmark.run({ id, book_id: req.params.id, position: JSON.stringify(position), label: label || '', created_at: Date.now() });
  res.json({ id, position, label });
});
app.delete('/api/books/:id/bookmarks/:bid', (req, res) => {
  stmts.deleteBookmark.run(req.params.bid);
  res.json({ ok: true });
});

// --- 笔记 ---
app.get('/api/books/:id/notes', (req, res) => res.json(stmts.listNotes.all(req.params.id)));
app.post('/api/books/:id/notes', (req, res) => {
  const { position, position_end, selected_text, note, color } = req.body;
  const id = randomUUID();
  const now = Date.now();
  stmts.addNote.run({ id, book_id: req.params.id, position: JSON.stringify(position), position_end: JSON.stringify(position_end), selected_text: selected_text || '', note: note || '', color: color || 'yellow', created_at: now, updated_at: now });
  res.json({ id, position, position_end, selected_text, note, color });
});
app.put('/api/books/:id/notes/:nid', (req, res) => {
  const { note, color } = req.body;
  stmts.updateNote.run({ note: note ?? '', color: color || 'yellow', updated_at: Date.now(), id: req.params.nid });
  res.json({ ok: true });
});
app.delete('/api/books/:id/notes/:nid', (req, res) => {
  stmts.deleteNote.run(req.params.nid);
  res.json({ ok: true });
});

// --- 标签 ---
app.get('/api/tags', (req, res) => {
  res.json(stmts.listTags.all());
});

app.post('/api/tags', (req, res) => {
  const { name, color } = req.body;
  const n = (name || '').trim();
  if (!n) return res.status(400).json({ error: '标签名不能为空' });
  const exist = stmts.getTagByName.get(n);
  if (exist) return res.status(409).json({ error: '标签已存在', tag: exist });
  const id = randomUUID();
  const tag = { id, name: n, color: color || '#9c5a3f', created_at: Date.now() };
  stmts.insertTag.run(tag);
  res.json(tag);
});

app.put('/api/tags/:tid', (req, res) => {
  const { name, color } = req.body;
  const t = stmts.getTag.get(req.params.tid);
  if (!t) return res.status(404).json({ error: '标签不存在' });
  const n = (name || t.name).trim();
  if (!n) return res.status(400).json({ error: '标签名不能为空' });
  try { stmts.updateTag.run({ id: req.params.tid, name: n, color: color || t.color }); }
  catch (e) { return res.status(409).json({ error: '标签名重复' }); }
  res.json(stmts.getTag.get(req.params.tid));
});

app.delete('/api/tags/:tid', (req, res) => {
  stmts.deleteTag.run(req.params.tid);
  res.json({ ok: true });
});

// ===== 全局设置（跨设备同步） =====
app.get('/api/settings', (req, res) => {
  const rows = stmts.getAllSettings.all();
  const obj = {};
  for (const r of rows) {
    try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; }
  }
  res.json(obj);
});
app.put('/api/settings', (req, res) => {
  const data = req.body || {};
  const save = db.transaction(() => {
    for (const [k, v] of Object.entries(data)) {
      stmts.setSetting.run(k, JSON.stringify(v));
    }
  });
  save();
  res.json({ ok: true });
});

// 设置某本书的标签集合
app.put('/api/books/:id/tags', (req, res) => {
  const book = stmts.getBook.get(req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const tagIds = Array.isArray(req.body.tagIds) ? req.body.tagIds : [];
  const setTags = db.transaction(() => {
    stmts.clearBookTags.run(req.params.id);
    for (const tid of tagIds) stmts.addBookTag.run(req.params.id, tid);
  });
  setTags();
  res.json({ tags: stmts.getBookTags.all(req.params.id) });
});

app.get('/api/books/:id/tags', (req, res) => {
  res.json(stmts.getBookTags.all(req.params.id));
});

// 占位封面
import { writeFileSync } from 'fs';
const placeholderPath = join(BOOKS_DIR, 'placeholder.svg');
if (!existsSync(placeholderPath)) {
  writeFileSync(placeholderPath, `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280"><rect width="200" height="280" fill="#e8e2d4"/><text x="100" y="145" font-size="22" fill="#9a8f7a" text-anchor="middle" font-family="serif">无封面</text></svg>`);
}

// 静态前端
app.use(express.static(join(__dirname, 'public'), { maxAge: 0 }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📚 个人书库已启动: http://localhost:${PORT}`);
});
