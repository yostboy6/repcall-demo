import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

/** Local D1-compatible adapter backed by real SQLite, including atomic batches. */
export function createSqliteDatabase(path = ':memory:') {
  const connection = new DatabaseSync(path);
  connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') connection.exec('PRAGMA journal_mode = WAL;');
  connection.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

  const execute = (query, values = []) => {
    const statement = connection.prepare(query);
    const results = statement.all(...values);
    const metadata = connection.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get();
    return { success: true, results: results.map(row => ({ ...row })), meta: { ...metadata } };
  };
  const prepare = (query, values = []) => ({
    _query: query,
    _values: values,
    bind(...parameters) { return prepare(query, parameters.map(value => value === undefined ? null : value)); },
    async first(column) {
      const row = execute(query, values).results[0];
      if (!row) return null;
      return column === undefined ? row : row[column] ?? null;
    },
    async all() { return execute(query, values); },
    async run() { return execute(query, values); },
  });
  return {
    prepare,
    async batch(statements) {
      connection.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => execute(statement._query, statement._values));
        connection.exec('COMMIT');
        return results;
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(query) { connection.exec(query); return { count: 1, duration: 0 }; },
    close() { connection.close(); },
  };
}
