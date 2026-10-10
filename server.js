import express from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import iconv from 'iconv-lite';
import JSZip from 'jszip';
import { stmts, pool } from './db.js';
import { inferTagNames, ruleByName } from './tagger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));

// 上传使用内存存储（文件存数据库，不写磁盘）
const upload = multer({
  storage: multer.memoryStorage(),
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

// 从 EPUB 提取元数据文本
async function extractEpubMetaText(buf) {
  try {
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
      const re = new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\/dc:${tag}>`, 'gi');
      let mm;
      while ((mm = re.exec(opf)) !== null) parts.push(mm[1].replace(/<[^>]+>/g, ''));
    }
    return parts.join(' ');
  } catch { return ''; }
}

// 为一本书应用推断出的标签
async function applyAutoTags(bookId, tagNames) {
  for (const name of tagNames) {
    let tag = await stmts.getTagByName(name);
    if (!tag) {
      const rule = ruleByName(name);
      tag = { id: randomUUID(), name, color: rule?.color || '#9c5a3f', created_at: Date.now() };
      try { await stmts.insertTag(tag); } catch { tag = await stmts.getTagByName(name); }
    }
    if (tag) await stmts.addBookTag(bookId, tag.id);
  }
}

// --- 上传 ---
app.post('/api/books/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const id = randomUUID();
  let originalName = req.file.originalname;
  try { if (/[\u00c0-\u00ff]/.test(originalName)) originalName = Buffer.from(originalName, 'latin1').toString('utf8'); } catch {}
  const format = detectFormat(originalName);
  const now = Date.now();
  const fileBuf = req.file.buffer;

  // 推断标签
  let metaText = '';
  try {
    if (format === 'epub') metaText = await extractEpubMetaText(fileBuf);
  } catch {}
  const tagNames = inferTagNames(`${originalName} ${metaText}`);

  await stmts.insertBook({
    id, title: titleFromName(originalName), author: '',
    filename: originalName, format, size: req.file.size,
    cover: '', total_pages: 0, file_data: fileBuf,
    created_at: now, updated_at: now,
  });
  await applyAutoTags(id, tagNames);

  const result = await stmts.getBook(id);
  result.tags = await stmts.getBookTags(id);
  result.auto_tags = tagNames;
  // 不返回 file_data
  delete result.file_data;
  delete result.cover_data;
  res.json(result);
});

// --- 列表 ---
function attachTags(rows) {
  return stmts.listAllBookTags().then(all => {
    const map = {};
    for (const t of all) (map[t.bid] ||= []).push({ id: t.id, name: t.name, color: t.color });
    return rows.map(r => ({ ...r, tags: map[r.id] || [] }));
  });
}
async function attachCounts(rows) {
  const [notesRows, bmRows] = await Promise.all([stmts.countNotesByBook(), stmts.countBookmarksByBook()]);
  const notesMap = {}, bmMap = {};
  for (const x of notesRows) notesMap[x.book_id] = x.c;
  for (const x of bmRows) bmMap[x.book_id] = x.c;
  return rows.map(r => ({ ...r, notes_count: notesMap[r.id] || 0, bookmarks_count: bmMap[r.id] || 0 }));
}
async function enrich(rows) { return attachCounts(await attachTags(rows)); }

app.get('/api/books', async (req, res) => {
  const rows = await stmts.listBooks();
  const enriched = await enrich(rows);
  // 不返回大二进制字段
  res.json(enriched.map(r => { const { file_data, cover_data, ...rest } = r; return rest; }));
});

app.get('/api/books/:id', async (req, res) => {
  const book = await stmts.getBook(req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const enriched = (await enrich([book]))[0];
  delete enriched.file_data;
  delete enriched.cover_data;
  res.json(enriched);
});

// 更新元数据
app.put('/api/books/:id', async (req, res) => {
  const book = await stmts.getBook(req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const { total_pages, cover, title, author } = req.body;
  const now = Date.now();
  if (title !== undefined || author !== undefined) {
    await stmts.updateBookTitle({ id: req.params.id, title: title ?? book.title, author: author ?? book.author, updated_at: now });
  }
  if (total_pages !== undefined || cover !== undefined) {
    await stmts.updateBookMeta({ id: req.params.id, total_pages: total_pages ?? book.total_pages, cover: cover ?? book.cover, cover_data: null, updated_at: now });
  }
  const updated = await stmts.getBook(req.params.id);
  delete updated.file_data;
  delete updated.cover_data;
  res.json(updated);
});

// 原始文件下载（从数据库读）
app.get('/api/books/:id/file', async (req, res) => {
  const book = await stmts.getBook(req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const data = await stmts.getBookFile(req.params.id);
  if (!data) return res.status(404).json({ error: '文件丢失' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(book.filename)}"`);
  res.send(Buffer.from(data));
});

// 封面
app.get('/api/books/:id/cover', async (req, res) => {
  const book = await stmts.getBook(req.params.id);
  if (!book || !book.cover) {
    // 返回占位 SVG
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280"><rect width="200" height="280" fill="#e8e2d4"/><text x="100" y="145" font-size="22" fill="#9a8f7a" text-anchor="middle" font-family="serif">无封面</text></svg>`);
  }
  const data = await stmts.getBookCover(req.params.id);
  if (!data) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280"><rect width="200" height="280" fill="#e8e2d4"/><text x="100" y="145" font-size="22" fill="#9a8f7a" text-anchor="middle" font-family="serif">无封面</text></svg>`);
  }
  res.setHeader('Content-Type', 'image/png');
  res.send(Buffer.from(data));
});

// 封面上传
app.post('/api/books/:id/cover', upload.single('cover'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到封面' });
  const now = Date.now();
  await stmts.updateBookMeta({ id: req.params.id, total_pages: 0, cover: 'custom', cover_data: req.file.buffer, updated_at: now });
  res.json({ cover: 'custom' });
});

app.delete('/api/books/:id', async (req, res) => {
  await stmts.deleteBook(req.params.id);
  res.json({ ok: true });
});

// --- TXT 文本（自动编码识别）---
app.get('/api/books/:id/text', async (req, res) => {
  const book = await stmts.getBook(req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const data = await stmts.getBookFile(req.params.id);
  if (!data) return res.status(404).json({ error: '文件丢失' });
  try {
    const buf = Buffer.from(data);
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
app.get('/api/books/:id/progress', async (req, res) => {
  const p = await stmts.getProgress(req.params.id);
  res.json(p || { book_id: req.params.id, position: null, percent: 0, read_time: 0, last_read_at: null });
});
app.put('/api/books/:id/progress', async (req, res) => {
  const { position, percent, read_time } = req.body;
  const now = Date.now();
  const prev = await stmts.getProgress(req.params.id);
  await stmts.upsertProgress({
    book_id: req.params.id,
    position: position !== undefined ? JSON.stringify(position) : prev?.position,
    percent: percent !== undefined ? percent : prev?.percent || 0,
    read_time: read_time !== undefined ? read_time : (prev?.read_time || 0),
    last_read_at: now,
  });
  res.json({ ok: true });
});

// --- 书签 ---
app.get('/api/books/:id/bookmarks', async (req, res) => res.json(await stmts.listBookmarks(req.params.id)));
app.post('/api/books/:id/bookmarks', async (req, res) => {
  const { position, label } = req.body;
  const id = randomUUID();
  await stmts.addBookmark({ id, book_id: req.params.id, position: JSON.stringify(position), label: label || '', created_at: Date.now() });
  res.json({ id, position, label });
});
app.delete('/api/books/:id/bookmarks/:bid', async (req, res) => {
  await stmts.deleteBookmark(req.params.bid);
  res.json({ ok: true });
});

// --- 笔记 ---
app.get('/api/books/:id/notes', async (req, res) => res.json(await stmts.listNotes(req.params.id)));
app.post('/api/books/:id/notes', async (req, res) => {
  const { position, position_end, selected_text, note, color } = req.body;
  const id = randomUUID();
  const now = Date.now();
  await stmts.addNote({ id, book_id: req.params.id, position: JSON.stringify(position), position_end: JSON.stringify(position_end), selected_text: selected_text || '', note: note || '', color: color || 'yellow', created_at: now, updated_at: now });
  res.json({ id, position, position_end, selected_text, note, color });
});
app.put('/api/books/:id/notes/:nid', async (req, res) => {
  const { note, color } = req.body;
  await stmts.updateNote({ note: note ?? '', color: color || 'yellow', updated_at: Date.now(), id: req.params.nid });
  res.json({ ok: true });
});
app.delete('/api/books/:id/notes/:nid', async (req, res) => {
  await stmts.deleteNote(req.params.nid);
  res.json({ ok: true });
});

// --- 标签 ---
app.get('/api/tags', async (req, res) => res.json(await stmts.listTags()));

app.post('/api/tags', async (req, res) => {
  const { name, color } = req.body;
  const n = (name || '').trim();
  if (!n) return res.status(400).json({ error: '标签名不能为空' });
  const exist = await stmts.getTagByName(n);
  if (exist) return res.status(409).json({ error: '标签已存在', tag: exist });
  const id = randomUUID();
  const tag = { id, name: n, color: color || '#9c5a3f', created_at: Date.now() };
  await stmts.insertTag(tag);
  res.json(tag);
});

app.put('/api/tags/:tid', async (req, res) => {
  const { name, color } = req.body;
  const t = await stmts.getTag(req.params.tid);
  if (!t) return res.status(404).json({ error: '标签不存在' });
  const n = (name || t.name).trim();
  if (!n) return res.status(400).json({ error: '标签名不能为空' });
  try { await stmts.updateTag({ id: req.params.tid, name: n, color: color || t.color }); }
  catch (e) { return res.status(409).json({ error: '标签名重复' }); }
  res.json(await stmts.getTag(req.params.tid));
});

app.delete('/api/tags/:tid', async (req, res) => {
  await stmts.deleteTag(req.params.tid);
  res.json({ ok: true });
});

// ===== 全局设置（跨设备同步） =====
app.get('/api/settings', async (req, res) => {
  const rows = await stmts.getAllSettings();
  const obj = {};
  for (const r of rows) {
    try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; }
  }
  res.json(obj);
});
app.put('/api/settings', async (req, res) => {
  const data = req.body || {};
  for (const [k, v] of Object.entries(data)) {
    await stmts.setSetting(k, JSON.stringify(v));
  }
  res.json({ ok: true });
});

// 设置某本书的标签集合
app.put('/api/books/:id/tags', async (req, res) => {
  const book = await stmts.getBook(req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const tagIds = Array.isArray(req.body.tagIds) ? req.body.tagIds : (Array.isArray(req.body.tag_ids) ? req.body.tag_ids : []);
  await stmts.clearBookTags(req.params.id);
  for (const tid of tagIds) await stmts.addBookTag(req.params.id, tid);
  res.json({ tags: await stmts.getBookTags(req.params.id) });
});

app.get('/api/books/:id/tags', async (req, res) => res.json(await stmts.getBookTags(req.params.id)));

// 静态前端
app.use(express.static(join(__dirname, 'public'), { maxAge: 0 }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📚 个人书库已启动: http://localhost:${PORT}`);
});
