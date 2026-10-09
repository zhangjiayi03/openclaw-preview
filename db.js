import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });
mkdirSync(join(dataDir, 'books'), { recursive: true });

const db = new Database(join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 建表
db.exec(`
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  filename TEXT NOT NULL,
  stored TEXT NOT NULL,
  format TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  cover TEXT,
  total_pages INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS progress (
  book_id TEXT PRIMARY KEY,
  position TEXT,
  percent REAL DEFAULT 0,
  read_time INTEGER DEFAULT 0,
  last_read_at INTEGER,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  position TEXT,
  label TEXT,
  created_at INTEGER,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  position TEXT,
  position_end TEXT,
  selected_text TEXT,
  note TEXT,
  color TEXT DEFAULT 'yellow',
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#9c5a3f',
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS book_tags (
  book_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (book_id, tag_id),
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_book_tags_tag ON book_tags(tag_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// 预编译语句
export const stmts = {
  insertBook: db.prepare(`INSERT INTO books (id,title,author,filename,stored,format,size,cover,total_pages,created_at,updated_at)
    VALUES (@id,@title,@author,@filename,@stored,@format,@size,@cover,@total_pages,@created_at,@updated_at)`),
  getBook: db.prepare(`SELECT * FROM books WHERE id=?`),
  listBooks: db.prepare(`SELECT b.*, p.percent, p.position, p.last_read_at, p.read_time
    FROM books b LEFT JOIN progress p ON p.book_id=b.id ORDER BY COALESCE(p.last_read_at, b.created_at) DESC`),
  deleteBook: db.prepare(`DELETE FROM books WHERE id=?`),
  updateBookMeta: db.prepare(`UPDATE books SET total_pages=@total_pages, cover=@cover, updated_at=@updated_at WHERE id=@id`),
  updateBookTitle: db.prepare(`UPDATE books SET title=@title, author=@author, updated_at=@updated_at WHERE id=@id`),

  upsertProgress: db.prepare(`INSERT INTO progress (book_id,position,percent,read_time,last_read_at) VALUES (@book_id,@position,@percent,@read_time,@last_read_at)
    ON CONFLICT(book_id) DO UPDATE SET position=@position, percent=@percent, read_time=@read_time, last_read_at=@last_read_at`),
  getProgress: db.prepare(`SELECT * FROM progress WHERE book_id=?`),

  addBookmark: db.prepare(`INSERT INTO bookmarks (id,book_id,position,label,created_at) VALUES (@id,@book_id,@position,@label,@created_at)`),
  listBookmarks: db.prepare(`SELECT * FROM bookmarks WHERE book_id=? ORDER BY created_at DESC`),
  deleteBookmark: db.prepare(`DELETE FROM bookmarks WHERE id=?`),

  addNote: db.prepare(`INSERT INTO notes (id,book_id,position,position_end,selected_text,note,color,created_at,updated_at)
    VALUES (@id,@book_id,@position,@position_end,@selected_text,@note,@color,@created_at,@updated_at)`),
  updateNote: db.prepare(`UPDATE notes SET note=@note, color=@color, updated_at=@updated_at WHERE id=@id`),
  listNotes: db.prepare(`SELECT * FROM notes WHERE book_id=? ORDER BY created_at DESC`),
  deleteNote: db.prepare(`DELETE FROM notes WHERE id=?`),
  getNote: db.prepare(`SELECT * FROM notes WHERE id=?`),

  // 标签
  insertTag: db.prepare(`INSERT INTO tags (id,name,color,created_at) VALUES (@id,@name,@color,@created_at)`),
  getTagByName: db.prepare(`SELECT * FROM tags WHERE name=?`),
  getTag: db.prepare(`SELECT * FROM tags WHERE id=?`),
  listTags: db.prepare(`SELECT t.*, COUNT(bt.book_id) AS count FROM tags t LEFT JOIN book_tags bt ON bt.tag_id=t.id GROUP BY t.id ORDER BY t.created_at`),
  updateTag: db.prepare(`UPDATE tags SET name=@name, color=@color WHERE id=@id`),
  deleteTag: db.prepare(`DELETE FROM tags WHERE id=?`),
  clearBookTags: db.prepare(`DELETE FROM book_tags WHERE book_id=?`),
  addBookTag: db.prepare(`INSERT OR IGNORE INTO book_tags (book_id,tag_id) VALUES (?,?)`),
  getBookTags: db.prepare(`SELECT t.* FROM tags t JOIN book_tags bt ON bt.tag_id=t.id WHERE bt.book_id=? ORDER BY t.created_at`),
  listAllBookTags: db.prepare(`SELECT bt.book_id AS bid, t.id, t.name, t.color FROM book_tags bt JOIN tags t ON t.id=bt.tag_id`),
  booksByTag: db.prepare(`SELECT b.* FROM books b JOIN book_tags bt ON bt.book_id=b.id WHERE bt.tag_id=?`),
  countNotesByBook: db.prepare(`SELECT book_id, COUNT(*) AS c FROM notes GROUP BY book_id`),
  countBookmarksByBook: db.prepare(`SELECT book_id, COUNT(*) AS c FROM bookmarks GROUP BY book_id`),

  // 设置（key-value）
  getSetting: db.prepare(`SELECT value FROM settings WHERE key=?`),
  setSetting: db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`),
  getAllSettings: db.prepare(`SELECT key,value FROM settings`),
};

export default db;
