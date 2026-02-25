import process from 'node:process';
import http from 'node:http';
import { createPool } from './config/db.js';

const port = Number(process.env.BACKEND_PORT || 4000);
const pool = createPool();

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/health' && req.method === 'GET') {
    try {
      await pool.query('SELECT 1');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, error: null }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message ?? String(err) }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, () => {
  console.log(`MySQL backend running on port ${port}`);
});
