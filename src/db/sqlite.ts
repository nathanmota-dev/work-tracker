import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type Binding = SQLInputValue | Record<string, SQLInputValue>;
/** Small compatibility boundary for the imported synchronous SQL callers. */
export class Database {
  private connection: DatabaseSync;
  private depth = 0;
  constructor(path: string, options?: { create?: boolean; readOnly?: boolean }) {
    this.connection = options?.readOnly ? new DatabaseSync(path, { readOnly: true }) : new DatabaseSync(path);
  }
  exec(sql: string): void { this.connection.exec(sql); }
  query(sql: string) {
    const statement = this.connection.prepare(sql);
    return {
      all: (...args: Binding[]) => (statement.all as (...args: Binding[]) => unknown[])(...args),
      get: (...args: Binding[]) => (statement.get as (...args: Binding[]) => unknown)(...args),
      run: (...args: Binding[]) => (statement.run as (...args: Binding[]) => { changes: number | bigint; lastInsertRowid: number | bigint })(...args),
    };
  }
  transaction<A extends unknown[], T>(fn: (...args: A) => T): (...args: A) => T {
    return (...args: A) => {
      const level = this.depth++;
      const savepoint = `wt_${level}`;
      try {
        this.exec(level ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
        try {
          const value = fn(...args);
          if (value instanceof Promise) throw new Error("SQLite transactions must be synchronous");
          this.exec(level ? `RELEASE ${savepoint}` : "COMMIT");
          return value;
        } catch (error) {
          this.exec(level ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
          throw error;
        }
      } finally { this.depth--; }
    };
  }
  close(): void { this.connection.close(); }
}
