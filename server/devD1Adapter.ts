import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import {
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1ExecResult,
  D1CatalogStorage,
} from './d1Storage';
import {
  loadCatalog as loadJsonFileCatalog,
  saveCatalog as saveJsonFileCatalog,
  loadStrategyConfig as loadJsonFileStrategyConfig,
  saveStrategyConfig as saveJsonFileStrategyConfig,
} from './storage';

const requireModule = createRequire(import.meta.url);

class LocalSqlitePreparedStatement implements D1PreparedStatement {
  private readonly sqliteDb: any;
  private readonly query: string;
  private readonly boundValues: unknown[];

  constructor(sqliteDb: any, query: string, boundValues: unknown[] = []) {
    this.sqliteDb = sqliteDb;
    this.query = query;
    this.boundValues = boundValues;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    const normalized = values.map((v) => (v === undefined ? null : v));
    return new LocalSqlitePreparedStatement(this.sqliteDb, this.query, normalized);
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const stmt = this.sqliteDb.prepare(this.query);
    const row = stmt.get(...this.boundValues) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (colName) {
      return (row[colName] as T) ?? null;
    }
    return row as unknown as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const start = Date.now();
    const stmt = this.sqliteDb.prepare(this.query);
    const info = stmt.run(...this.boundValues);
    return {
      results: [],
      success: true,
      meta: {
        duration: Date.now() - start,
        changes: Number(info?.changes ?? 0),
        last_row_id: Number(info?.lastInsertRowid ?? 0),
      },
    };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const start = Date.now();
    const trimmed = this.query.trim().toUpperCase();
    const stmt = this.sqliteDb.prepare(this.query);

    if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH')) {
      const rows = (stmt.all(...this.boundValues) || []) as T[];
      return {
        results: rows,
        success: true,
        meta: {
          duration: Date.now() - start,
          rows_read: rows.length,
        },
      };
    }

    const info = stmt.run(...this.boundValues);
    return {
      results: [],
      success: true,
      meta: {
        duration: Date.now() - start,
        changes: Number(info?.changes ?? 0),
        last_row_id: Number(info?.lastInsertRowid ?? 0),
      },
    };
  }
}

class LocalSqliteD1Database implements D1Database {
  private readonly sqliteDb: any;

  constructor(sqlitePath: string = ':memory:') {
    if (sqlitePath !== ':memory:') {
      const dir = path.dirname(sqlitePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    const { DatabaseSync } = requireModule('node:sqlite');
    this.sqliteDb = new DatabaseSync(sqlitePath);
    this.sqliteDb.exec('PRAGMA foreign_keys = ON;');
    this.sqliteDb.exec('PRAGMA journal_mode = WAL;');
  }

  prepare(query: string): D1PreparedStatement {
    return new LocalSqlitePreparedStatement(this.sqliteDb, query);
  }

  async batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[]
  ): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    this.sqliteDb.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      for (const stmt of statements) {
        const res = await stmt.all<T>();
        results.push(res);
      }
      this.sqliteDb.exec('COMMIT;');
      return results;
    } catch (err) {
      try {
        this.sqliteDb.exec('ROLLBACK;');
      } catch {
        // ignore rollback error
      }
      throw err;
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    const start = Date.now();
    this.sqliteDb.exec(query);
    return {
      count: 1,
      duration: Date.now() - start,
    };
  }

  close(): void {
    if (this.sqliteDb && typeof this.sqliteDb.close === 'function') {
      this.sqliteDb.close();
    }
  }
}

/**
 * Creates a Cloudflare D1-compatible SQLite database binding for local development or automated tests.
 */
export function createSqliteD1Database(
  sqlitePath: string = ':memory:'
): D1Database & { close: () => void } {
  return new LocalSqliteD1Database(sqlitePath);
}

let cachedDevDb: (D1Database & { close: () => void }) | null = null;
let devDbInitPromise: Promise<void> | null = null;

/**
 * Initializes and returns the isolated Google AI Studio development D1 database binding (`data/dev-d1.sqlite`).
 * Automatically applies the D1 schema and seeds initial catalog data from `data/catalog.json` if empty.
 */
export async function getInitializedDevD1Database(): Promise<D1Database> {
  if (!cachedDevDb) {
    const devSqlitePath = path.resolve(process.cwd(), 'data', 'dev-d1.sqlite');
    cachedDevDb = createSqliteD1Database(devSqlitePath);
  }

  if (!devDbInitPromise) {
    devDbInitPromise = (async () => {
      const storage = new D1CatalogStorage(cachedDevDb!);
      await storage.ensureSchema();

      const existing = await storage.loadCatalog();
      if (existing.length === 0) {
        // Seed development D1 SQLite database from existing local catalog.json & strategy.json
        const initialProducts = loadJsonFileCatalog();
        if (initialProducts.length > 0) {
          await storage.saveCatalog(initialProducts);
        }
        const initialStrategy = loadJsonFileStrategyConfig();
        await storage.saveStrategyConfig(initialStrategy);
      }
    })();
  }

  await devDbInitPromise;
  return cachedDevDb;
}

/**
 * Synchronizes development D1 mutations back to `data/catalog.json` / `data/strategy.json`
 * ONLY in local AI Studio development mode so local file backups stay consistent.
 */
export const devStorageCallbacks = {
  onDevSyncCallback: (items: any[]) => {
    try {
      saveJsonFileCatalog(items);
    } catch {
      // ignore local file sync error
    }
  },
  onDevStrategySyncCallback: (config: any) => {
    try {
      saveJsonFileStrategyConfig(config);
    } catch {
      // ignore local file sync error
    }
  },
};
