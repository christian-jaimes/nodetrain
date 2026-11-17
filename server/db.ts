import { DatabaseSync } from 'node:sqlite';

/**
 * Schema migrations, applied in order. Never edit a shipped step: add a new
 * one. The current step count is stored in PRAGMA user_version.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  -- Append-only: every saved change is a new row, so any run can be traced to the exact graph it used.
  CREATE TABLE board_revisions (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    name TEXT NOT NULL,
    document TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (board_id, revision)
  );
  -- Immutable image files. Deduplicated by content hash.
  CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    mime TEXT NOT NULL,
    name TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    path TEXT NOT NULL,
    thumb_path TEXT,
    provider TEXT,
    run_id TEXT,
    provenance TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    target_node_id TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE INDEX runs_board ON runs(board_id, created_at);
  CREATE TABLE node_executions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    board_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    node_title TEXT NOT NULL,
    seq INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    error_category TEXT,
    request TEXT,
    output_ids TEXT NOT NULL DEFAULT '[]',
    run_key TEXT,
    started_at INTEGER,
    ended_at INTEGER
  );
  CREATE INDEX exec_run ON node_executions(run_id, seq);
  CREATE INDEX exec_board_node ON node_executions(board_id, node_id, ended_at);
  `,
  // 2: token usage reported by the provider, per node execution.
  `ALTER TABLE node_executions ADD COLUMN usage TEXT;`,
  // 3: favorites for the workflow gallery, and a marker on run history copied into a duplicated workflow (so copies never count as new spend).
  `
  ALTER TABLE boards ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE node_executions ADD COLUMN copied INTEGER NOT NULL DEFAULT 0;
  `,
  // 4: workflows the user saved as templates.
  `
  CREATE TABLE user_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    document TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
];

export type DB = DatabaseSync;

export function openDatabase(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
