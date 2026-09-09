import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class LocalDbService implements OnModuleInit {
  private readonly logger = new Logger(LocalDbService.name);
  private db: Database.Database;
  private dbFilePath: string;

  onModuleInit() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.dbFilePath = path.join(dataDir, 'dawaee_local.db');
    this.logger.log(`Initializing Local File Database Engine at: ${this.dbFilePath}`);

    this.db = new Database(this.dbFilePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.initTables();
  }

  private initTables() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS medicines (
        id TEXT PRIMARY KEY,
        trade_name TEXT NOT NULL,
        scientific_name TEXT,
        dosage_form TEXT,
        strength TEXT,
        manufacturer TEXT,
        barcode TEXT,
        default_units_per_pack INTEGER DEFAULT 1,
        is_verified INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        table_name TEXT NOT NULL,
        payload TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
    ];

    for (const sql of statements) {
      try {
        this.db.exec(sql);
      } catch (err) {
        this.logger.error(`Error executing SQLite setup statement: ${err.message}`);
      }
    }
  }

  public query<T = any>(sql: string, params: any[] = []): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  public queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  public execute(sql: string, params: any[] = []): Database.RunResult {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  public getDbFilePath(): string {
    return this.dbFilePath;
  }
}
