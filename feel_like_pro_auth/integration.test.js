const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

test('Telegram → заявки → сетка → зал славы', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await pool.query('TRUNCATE audit_log,tournament_results,matches,entry_roster,tournament_entries,news,free_players,team_members,teams,tournaments,users CASCADE');
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.SESSION_SECRET = 'test-secret-' + 'a'.repeat(50);
  process.env.BASE_URL = 'http://localhost:3000';
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  process.env.TELEGRAM_BOT_USERNAME = 'test_bot';
  process.env.TELEGRAM_ADMIN_IDS = '101';
  process.env.NODE_ENV = 'test';
  const app = require('./server');
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = {};
  async function call(who, endpoint, method = 'GET', body) {
    const res = await fetch(url + endpoint, { method, headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(clients[who]?.cookie ? { cookie: clients[who].cookie } : {}),
      ...(clients[who]?.csrf ? { 'x-csrf-token': clients[who].csrf } : {})
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    const cookie = res.headers.get('set-cookie');
    if (cookie) clients[who] = { ...(clients[who] || {}), cookie: cookie.split(';')[0] };
    const data = await res.json();
    assert.ok(res.ok, `${method} ${endpoint}: ${JSON.stringify(data)}`);
    if (data.csrf) clients[who] = { ...(clients[who] || {}), csrf: data.csrf };
    return data;
  }
  async function login(who, id) {
    const payload = { id: String(id), first_name: who, username: `player_${id}`, auth_date: String(Math.floor(Date.now() / 1000)) };
    const fields = Object.keys(payload).sort().map(key => `${key}=${payload[key]}`).join('\n');
    const secret = crypto.createHash('sha256').update('test-bot-token').digest();
    payload.hash = crypto.createHmac('sha256', secret).update(fields).digest('hex');
    return call(who, '/auth/telegram', 'POST', payload);
  }
  try {
    const admin = await login('admin', 101), player = await login('player', 202);
    assert.equal(admin.user.role, 'admin'); assert.equal(player.user.role, 'player');
    const news = await call('admin', '/api/news', 'POST', { title: 'Первый сезон', summary: 'Старт', body: 'Регистрация открыта', status: 'published' });
    assert.equal((await call('player', '/api/news')).find(n => n.id === news.id).title, 'Первый сезон');
    const t = await call('admin', '/api/tournaments', 'POST', { title: 'Тестовый кубок', game: 'Dota 2', description: 'Тест', rules: 'BO1', prizes: 'Кубок', format: 'single', participant_type: 'solo', team_size: 1, max_entries: 2, status: 'open', starts_at: new Date(Date.now() + 86400000).toISOString() });
    const e1 = await call('admin', `/api/tournaments/${t.id}/entries`, 'POST', {});
    const e2 = await call('player', `/api/tournaments/${t.id}/entries`, 'POST', {});
    await call('admin', `/api/entries/${e1.id}/review`, 'POST', { status: 'approved' });
    await call('admin', `/api/entries/${e2.id}/review`, 'POST', { status: 'approved' });
    await call('admin', `/api/tournaments/${t.id}/bracket`, 'POST', {});
    const detail = await call('player', `/api/tournaments/${t.id}`);
    assert.equal(detail.matches.length, 1);
    await call('admin', `/api/matches/${detail.matches[0].id}/result`, 'POST', { score_a: 2, score_b: 1 });
    await call('admin', `/api/tournaments/${t.id}/finish`, 'POST', {});
    const hall = await call('player', '/api/hall');
    assert.equal(hall.length, 2);
    assert.equal(hall[0].name_snapshot, 'admin');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await app.locals.pool.end();
    await pool.end();
  }
});
