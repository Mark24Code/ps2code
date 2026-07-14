import type Database from 'better-sqlite3'

// 建表(幂等)。与 electron 无关,便于测试用内存库注入。
export function createSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      psd_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '新对话',
      tmp_dir TEXT NOT NULL DEFAULT '',
      export_dir TEXT NOT NULL DEFAULT '',
      opt_trim INTEGER NOT NULL DEFAULT 1,
      opt_1x INTEGER NOT NULL DEFAULT 0,
      opt_2x INTEGER NOT NULL DEFAULT 1,
      opt_compress INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS version_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      label TEXT NOT NULL,
      mtime TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      layer_hash TEXT NOT NULL,
      layer_tree TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, version)
    );
  `)

  // 迁移:为既有库补齐新列(CREATE TABLE IF NOT EXISTS 不会给旧表加列)。
  ensureColumn(db, 'conversations', 'opt_compress', 'INTEGER NOT NULL DEFAULT 1')
}

// 幂等地为表补齐某列:仅当列不存在时执行 ALTER TABLE。
function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}
