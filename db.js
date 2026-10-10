import pg from 'pg';

const { Pool } = pg;

const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
console.log('DEBUG 可用变量:', Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('PG') || k.includes('RAILWAY_TCP')));
console.log('DEBUG 连接串前缀:', dbUrl ? dbUrl.slice(0, 30) + '...' : '(空)');
if (!dbUrl) {
  console.error('❌ 没有找到数据库连接变量！请设置 DATABASE_PUBLIC_URL 或 DATABASE_URL');
  process.exit(1);
}

let pool;
try {
  pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
} catch (e) {
  console.error('❌ Pool 创建失败:', e.message);
  console.error('   连接串格式可能有误，请确认格式为 postgresql://user:pass@host:port/db');
  process.exit(1);
}

// 建表
const initSQL = `
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  filename TEXT NOT NULL,
  format TEXT NOT NULL,
  size BIGINT DEFAULT 0,
  cover TEXT,
  total_pages INTEGER DEFAULT 0,
  file_data BYTEA,
  cover_data BYTEA,
  created_at BIGINT,
  updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS progress (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  position TEXT,
  percent REAL DEFAULT 0,
  read_time INTEGER DEFAULT 0,
  last_read_at BIGINT
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  position TEXT,
  label TEXT,
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  position TEXT,
  position_end TEXT,
  selected_text TEXT,
  note TEXT,
  color TEXT DEFAULT 'yellow',
  created_at BIGINT,
  updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#9c5a3f',
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS book_tags (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_book_tags_tag ON book_tags(tag_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

try {
  await pool.query(initSQL);
  console.log('✅ 数据库表初始化完成');
} catch (e) {
  console.error('❌ 数据库初始化失败:', e.message);
  console.error('   DATABASE_URL:', process.env.DATABASE_URL ? '已设置(隐藏)' : '未设置');
  throw e;
}

// 封装查询工具
const q = {
  // books
  insertBook: (b) => pool.query(
    `INSERT INTO books (id,title,author,filename,format,size,cover,total_pages,file_data,cover_data,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [b.id, b.title, b.author, b.filename, b.format, b.size, b.cover, b.total_pages, b.file_data, b.cover_data, b.created_at, b.updated_at]
  ),
  getBook: (id) => pool.query(`SELECT * FROM books WHERE id=$1`, [id]).then(r => r.rows[0] || null),
  listBooks: () => pool.query(
    `SELECT b.*, p.percent, p.position, p.last_read_at, p.read_time
     FROM books b LEFT JOIN progress p ON p.book_id=b.id
     ORDER BY COALESCE(p.last_read_at, b.created_at) DESC`
  ).then(r => r.rows),
  deleteBook: (id) => pool.query(`DELETE FROM books WHERE id=$1`, [id]),
  updateBookMeta: (b) => pool.query(
    `UPDATE books SET total_pages=$1, cover=$2, cover_data=$3, updated_at=$4 WHERE id=$5`,
    [b.total_pages, b.cover, b.cover_data, b.updated_at, b.id]
  ),
  updateBookTitle: (b) => pool.query(
    `UPDATE books SET title=$1, author=$2, updated_at=$3 WHERE id=$4`,
    [b.title, b.author, b.updated_at, b.id]
  ),
  getBookFile: (id) => pool.query(`SELECT file_data FROM books WHERE id=$1`, [id]).then(r => r.rows[0]?.file_data || null),
  getBookCover: (id) => pool.query(`SELECT cover_data FROM books WHERE id=$1`, [id]).then(r => r.rows[0]?.cover_data || null),

  // progress
  upsertProgress: (p) => pool.query(
    `INSERT INTO progress (book_id,position,percent,read_time,last_read_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT(book_id) DO UPDATE SET position=$2, percent=$3, read_time=$4, last_read_at=$5`,
    [p.book_id, p.position, p.percent, p.read_time, p.last_read_at]
  ),
  getProgress: (id) => pool.query(`SELECT * FROM progress WHERE book_id=$1`, [id]).then(r => r.rows[0] || null),

  // bookmarks
  addBookmark: (b) => pool.query(
    `INSERT INTO bookmarks (id,book_id,position,label,created_at) VALUES ($1,$2,$3,$4,$5)`,
    [b.id, b.book_id, b.position, b.label, b.created_at]
  ),
  listBookmarks: (id) => pool.query(`SELECT * FROM bookmarks WHERE book_id=$1 ORDER BY created_at DESC`, [id]).then(r => r.rows),
  deleteBookmark: (id) => pool.query(`DELETE FROM bookmarks WHERE id=$1`, [id]),

  // notes
  addNote: (n) => pool.query(
    `INSERT INTO notes (id,book_id,position,position_end,selected_text,note,color,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [n.id, n.book_id, n.position, n.position_end, n.selected_text, n.note, n.color, n.created_at, n.updated_at]
  ),
  updateNote: (n) => pool.query(`UPDATE notes SET note=$1, color=$2, updated_at=$3 WHERE id=$4`, [n.note, n.color, n.updated_at, n.id]),
  listNotes: (id) => pool.query(`SELECT * FROM notes WHERE book_id=$1 ORDER BY created_at DESC`, [id]).then(r => r.rows),
  deleteNote: (id) => pool.query(`DELETE FROM notes WHERE id=$1`, [id]),

  // tags
  insertTag: (t) => pool.query(`INSERT INTO tags (id,name,color,created_at) VALUES ($1,$2,$3,$4)`, [t.id, t.name, t.color, t.created_at]),
  getTagByName: (name) => pool.query(`SELECT * FROM tags WHERE name=$1`, [name]).then(r => r.rows[0] || null),
  getTag: (id) => pool.query(`SELECT * FROM tags WHERE id=$1`, [id]).then(r => r.rows[0] || null),
  listTags: () => pool.query(`SELECT t.*, COUNT(bt.book_id) AS count FROM tags t LEFT JOIN book_tags bt ON bt.tag_id=t.id GROUP BY t.id ORDER BY t.created_at`).then(r => r.rows),
  updateTag: (t) => pool.query(`UPDATE tags SET name=$1, color=$2 WHERE id=$3`, [t.name, t.color, t.id]),
  deleteTag: (id) => pool.query(`DELETE FROM tags WHERE id=$1`, [id]),
  clearBookTags: (id) => pool.query(`DELETE FROM book_tags WHERE book_id=$1`, [id]),
  addBookTag: (bookId, tagId) => pool.query(`INSERT INTO book_tags (book_id,tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [bookId, tagId]),
  getBookTags: (id) => pool.query(`SELECT t.* FROM tags t JOIN book_tags bt ON bt.tag_id=t.id WHERE bt.book_id=$1 ORDER BY t.created_at`, [id]).then(r => r.rows),
  listAllBookTags: () => pool.query(`SELECT bt.book_id AS bid, t.id, t.name, t.color FROM book_tags bt JOIN tags t ON t.id=bt.tag_id`).then(r => r.rows),
  countNotesByBook: () => pool.query(`SELECT book_id, COUNT(*) AS c FROM notes GROUP BY book_id`).then(r => r.rows),
  countBookmarksByBook: () => pool.query(`SELECT book_id, COUNT(*) AS c FROM bookmarks GROUP BY book_id`).then(r => r.rows),

  // settings
  getSetting: (key) => pool.query(`SELECT value FROM settings WHERE key=$1`, [key]).then(r => r.rows[0]?.value || null),
  setSetting: (key, val) => pool.query(`INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2`, [key, val]),
  getAllSettings: () => pool.query(`SELECT key,value FROM settings`).then(r => r.rows),
};

export { q as stmts };
export { pool };
export default pool;
