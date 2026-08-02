import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "../config.js";

export function sqlitePathFromUrl(url: string) {
  if (!url.startsWith("sqlite:"))
    throw new Error("DATABASE_URL must use the sqlite: scheme");
  let value = url.slice("sqlite:".length);
  if (value.startsWith("///")) value = value.slice(3);
  else if (value.startsWith("//")) value = value.slice(2);
  if (!value) throw new Error("DATABASE_URL must include a file path");
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

export interface WriterMetrics {
  queueDepth: number;
  maxQueueDepth: number;
  active: boolean;
  busyRetries: number;
  completedWrites: number;
  failedWrites: number;
  rowsAffected: number;
  averageDurationMs: number;
  lastWriteAt: string | null;
}
type QueueItem<T> = {
  priority: number;
  sequence: number;
  label: string;
  operation: (db: Database.Database) => T;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export class SQLiteWriter {
  private queue: QueueItem<unknown>[] = [];
  private running = false;
  private sequence = 0;
  private durationTotal = 0;
  readonly metrics: WriterMetrics = {
    queueDepth: 0,
    maxQueueDepth: 0,
    active: false,
    busyRetries: 0,
    completedWrites: 0,
    failedWrites: 0,
    rowsAffected: 0,
    averageDurationMs: 0,
    lastWriteAt: null,
  };
  constructor(private connection: Database.Database) {}
  enqueue<T>(
    priority: number,
    label: string,
    operation: (db: Database.Database) => T,
  ): Promise<T> {
    return new Promise<T>((resolvePromise, reject) => {
      this.queue.push({
        priority,
        sequence: this.sequence++,
        label,
        operation,
        resolve: resolvePromise as (value: unknown) => void,
        reject,
      });
      this.queue.sort(
        (a, b) => a.priority - b.priority || a.sequence - b.sequence,
      );
      this.metrics.queueDepth = this.queue.length;
      this.metrics.maxQueueDepth = Math.max(
        this.metrics.maxQueueDepth,
        this.queue.length,
      );
      void this.drain();
    });
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    this.metrics.active = true;
    while (this.queue.length) {
      const item = this.queue.shift()!;
      this.metrics.queueDepth = this.queue.length;
      const started = performance.now();
      let retries = 0;
      for (;;) {
        try {
          const result = item.operation(this.connection);
          this.metrics.completedWrites++;
          this.metrics.lastWriteAt = new Date().toISOString();
          this.durationTotal += performance.now() - started;
          this.metrics.averageDurationMs =
            this.durationTotal / this.metrics.completedWrites;
          item.resolve(result);
          break;
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === "SQLITE_BUSY" && retries < 3) {
            retries++;
            this.metrics.busyRetries++;
            await delay(50 * 2 ** retries);
            continue;
          }
          this.metrics.failedWrites++;
          item.reject(error);
          break;
        }
      }
      await new Promise<void>((resolveNow) => setImmediate(resolveNow));
    }
    this.running = false;
    this.metrics.active = false;
  }
}

class SQLiteDatabase {
  readonly path = sqlitePathFromUrl(config.DATABASE_URL);
  readonly writerConnection: Database.Database;
  readonly reader: Database.Database;
  readonly writer: SQLiteWriter;
  private integrity = "unknown";
  private integrityCheckedAt = 0;
  constructor() {
    mkdirSync(dirname(this.path), { recursive: true });
    this.writerConnection = new Database(this.path);
    this.applyPragmas(this.writerConnection);
    this.migrate();
    this.reader = new Database(this.path, {
      readonly: true,
      fileMustExist: true,
    });
    this.reader.pragma("busy_timeout = 5000");
    this.reader.pragma("foreign_keys = ON");
    this.writer = new SQLiteWriter(this.writerConnection);
    this.refreshIntegrity();
  }
  private refreshIntegrity() {
    this.integrity = String(this.reader.pragma("quick_check", { simple: true }));
    this.integrityCheckedAt = Date.now();
  }
  private applyPragmas(db: Database.Database) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.pragma("temp_store = MEMORY");
    db.pragma("cache_size = -65536");
    db.pragma("mmap_size = 268435456");
  }
  private migrate() {
    const directory = resolve(process.cwd(), "server/db/migrations");
    this.writerConnection.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)",
    );
    const applied = new Set(
      (
        this.writerConnection
          .prepare("SELECT version FROM schema_migrations")
          .all() as Array<{ version: number }>
      ).map((r) => r.version),
    );
    for (const file of readdirSync(directory)
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort()) {
      const version = Number(file.split("_")[0]);
      if (applied.has(version)) continue;
      const sql = readFileSync(resolve(directory, file), "utf8");
      this.writerConnection.transaction(() => {
        this.writerConnection.exec(sql);
        this.writerConnection
          .prepare(
            "INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)",
          )
          .run(version, file, Date.now());
      })();
    }
  }
  stats() {
    // quick_check scans the database and can take seconds on a large local
    // history. Dashboard polling must not block live ingestion for it.
    if (Date.now() - this.integrityCheckedAt >= 300_000) this.refreshIntegrity();
    const db = statSync(this.path);
    const walPath = `${this.path}-wal`;
    let walBytes = 0;
    try {
      walBytes = statSync(walPath).size;
    } catch {}
    return {
      path: this.path,
      databaseBytes: db.size,
      walBytes,
      journalMode: this.writerConnection.pragma("journal_mode", {
        simple: true,
      }),
      synchronous: this.writerConnection.pragma("synchronous", {
        simple: true,
      }),
      busyTimeout: this.writerConnection.pragma("busy_timeout", {
        simple: true,
      }),
      integrity: this.integrity,
      writer: { ...this.writer.metrics },
    };
  }
  close() {
    this.reader.close();
    this.writerConnection.close();
  }
}
export const sqlite = new SQLiteDatabase();
