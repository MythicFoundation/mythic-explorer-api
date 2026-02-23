import Database from "better-sqlite3";
import { config } from "./config";
import path from "path";
import fs from "fs";

const dir = path.dirname(config.dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(config.dbPath);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);

const getStmt = db.prepare("SELECT value, expires_at FROM cache WHERE key = ?");
const setStmt = db.prepare(
  "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)"
);
const delStmt = db.prepare("DELETE FROM cache WHERE key = ?");
const cleanStmt = db.prepare("DELETE FROM cache WHERE expires_at < ?");

export function cacheGet<T>(key: string): T | null {
  const row = getStmt.get(key) as { value: string; expires_at: number } | undefined;
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    delStmt.run(key);
    return null;
  }
  return JSON.parse(row.value) as T;
}

export function cacheSet(key: string, value: unknown, ttlMs?: number): void {
  const ttl = ttlMs ?? config.cacheTtlMs;
  setStmt.run(key, JSON.stringify(value), Date.now() + ttl);
}

export function cacheClean(): void {
  cleanStmt.run(Date.now());
}

// Clean expired entries every 60 seconds
setInterval(() => cacheClean(), 60_000);
