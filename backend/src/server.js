import process from "node:process";
import http from 'node:http';
import { createPool } from './config/db.js';
import { createMysqlSupabaseAdapter } from './services/mysqlSupabaseAdapter.js';

const port = Number(process.env.BACKEND_PORT || 4000);
const pool = createPool();
const db = createMysqlSupabaseAdapter(pool);

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/health' && req.method === 'GET') {
    const { error } = await db
      .from('information_schema.tables')
      .select('1')
      .eq('table_schema', process.env.MYSQL_DATABASE)
      .single();

    const payload = JSON.stringify({ ok: !error, error: error?.message ?? null });
    res.writeHead(error ? 500 : 200, { 'Content-Type': 'application/json' });
    res.end(payload);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, () => {
  console.log(`MySQL backend running on port ${port}`);
});
