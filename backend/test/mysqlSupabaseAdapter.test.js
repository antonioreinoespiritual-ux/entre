import test from 'node:test';
import assert from 'node:assert/strict';
import { createMysqlSupabaseAdapter } from '../src/services/mysqlSupabaseAdapter.js';

test('select + eq builds expected SQL', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{ id: 1 }]];
    },
  };

  const db = createMysqlSupabaseAdapter(pool);
  const result = await db.from('users').select('*').eq('id', 1).single();

  assert.equal(result.error, null);
  assert.deepEqual(calls[0], {
    sql: 'SELECT * FROM `users` WHERE `id` = ?',
    params: [1],
  });
});

test('from(schema.table) quotes both identifier parts', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{ ok: 1 }]];
    },
  };

  const db = createMysqlSupabaseAdapter(pool);
  const result = await db
    .from('information_schema.tables')
    .select('*')
    .eq('table_schema', 'mysql')
    .single();

  assert.equal(result.error, null);
  assert.deepEqual(calls[0], {
    sql: 'SELECT * FROM `information_schema`.`tables` WHERE `table_schema` = ?',
    params: ['mysql'],
  });
});
