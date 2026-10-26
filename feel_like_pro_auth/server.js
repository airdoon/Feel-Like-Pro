require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const { buildBracket } = require('./bracket');

for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'BASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME']) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
const baseUrl = new URL(process.env.BASE_URL);
if (process.env.NODE_ENV === 'production' && (baseUrl.hostname === 'example.com' || !baseUrl.protocol.startsWith('https') || process.env.TELEGRAM_BOT_TOKEN.startsWith('replace-') || process.env.SESSION_SECRET.startsWith('replace-'))) throw new Error('Configure real HTTPS domain and secrets before production startup');
const admins = new Set((process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(v => v.trim()).filter(Boolean));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const app = express();
app.locals.pool = pool;
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 500, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  name: 'flp.sid', secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: baseUrl.protocol === 'https:', maxAge: 7 * 24 * 3600 * 1000 }
}));
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const str = (v, max = 500) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const validUrl = v => { const value = str(v, 500); if (!value) return null; try { const u = new URL(value); if (u.protocol === 'https:') return u.href; } catch {} fail(400, 'Нужна ссылка HTTPS.'); };
const number = (v, min, max) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) fail(400, `Число должно быть от ${min} до ${max}.`); return n; };
const oneOf = (v, values) => values.includes(v) ? v : fail(400, 'Недопустимое значение.');
const date = v => { const d = new Date(v); if (!v || Number.isNaN(d.getTime())) fail(400, 'Некорректная дата.'); return d; };
const slug = title => `${str(title, 80).toLowerCase().normalize('NFKD').replace(/[^a-z0-9а-яё]+/g, '-').replace(/^-|-$/g, '') || 'event'}-${crypto.randomBytes(3).toString('hex')}`;
const query = (sql, params = []) => pool.query(sql, params);
async function transaction(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function audit(db, actor, action, type, id, details = {}) {
  await db.query('INSERT INTO audit_log(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)', [actor, action, type, id, details]);
}
const userFields = 'id,telegram_id::text AS telegram_id,telegram_username,display_name,avatar_url,nickname,role';
async function currentUser(req) {
  if (!req.session.userId) return null;
  const { rows } = await query(`SELECT ${userFields} FROM users WHERE id=$1`, [req.session.userId]);
  return rows[0] || null;
}
const needUser = wrap(async (req, _res, next) => { req.user = await currentUser(req); if (!req.user) fail(401, 'Войдите через Telegram.'); next(); });
const needAdmin = (req, _res, next) => req.user.role === 'admin' ? next() : next(new HttpError(403, 'Доступно только администратору.'));
app.use((req, _res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && origin !== baseUrl.origin) return next(new HttpError(403, 'Недопустимый источник запроса.'));
    if (req.path !== '/auth/telegram' && (!req.session.csrf || req.get('x-csrf-token') !== req.session.csrf)) return next(new HttpError(403, 'Обновите страницу и повторите действие.'));
  }
  next();
});

app.get('/health', wrap(async (_req, res) => { await query('SELECT 1'); res.json({ ok: true }); }));
app.get('/api/config', (_req, res) => res.json({ telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME }));
app.get('/api/me', wrap(async (req, res) => {
  req.session.csrf ||= crypto.randomBytes(24).toString('hex');
  res.json({ user: await currentUser(req), csrf: req.session.csrf });
}));
app.post('/auth/telegram', authLimit, wrap(async (req, res) => {
  const data = req.body;
  if (!data || Array.isArray(data) || !/^\d{1,20}$/.test(String(data.id || '')) || !/^\d{1,12}$/.test(String(data.auth_date || '')) || !/^[a-f0-9]{64}$/i.test(String(data.hash || ''))) fail(400, 'Неверные данные Telegram.');
  const now = Math.floor(Date.now() / 1000), authDate = Number(data.auth_date);
  if (authDate > now + 30 || now - authDate > 300) fail(401, 'Время входа истекло. Повторите попытку.');
  const fields = Object.keys(data).filter(k => k !== 'hash').sort().map(k => {
    if (typeof data[k] !== 'string' && typeof data[k] !== 'number') fail(400, 'Неверные данные Telegram.');
    return `${k}=${data[k]}`;
  }).join('\n');
  const secret = crypto.createHash('sha256').update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256', secret).update(fields).digest();
  const supplied = Buffer.from(data.hash, 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) fail(401, 'Подпись Telegram не подтверждена.');
  const id = String(data.id);
  const name = str([data.first_name, data.last_name].filter(Boolean).join(' '), 100) || str(data.username, 50) || `Игрок ${id}`;
  const username = /^[a-zA-Z0-9_]{5,32}$/.test(data.username || '') ? data.username : null;
  const avatar = data.photo_url ? validUrl(data.photo_url) : null;
  const role = admins.has(id) ? 'admin' : 'player';
  const { rows } = await query(`INSERT INTO users(telegram_id,telegram_username,display_name,avatar_url,role)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(telegram_id) DO UPDATE SET telegram_username=excluded.telegram_username,
    display_name=excluded.display_name,avatar_url=excluded.avatar_url,last_login_at=now(),updated_at=now(),role=excluded.role
    RETURNING ${userFields}`, [id, username, name, avatar, role]);
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = rows[0].id;
  req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.json({ user: rows[0], csrf: req.session.csrf });
}));
app.post('/auth/logout', wrap(async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
  res.clearCookie('flp.sid'); res.json({ ok: true });
}));
app.patch('/api/me', needUser, wrap(async (req, res) => {
  const nickname = str(req.body.nickname, 40);
  if (!nickname) fail(400, 'Введите игровой ник.');
  const { rows } = await query(`UPDATE users SET nickname=$1,updated_at=now() WHERE id=$2 RETURNING ${userFields}`, [nickname, req.user.id]);
  res.json(rows[0]);
}));

app.get('/api/news', wrap(async (req, res) => {
  const all = req.query.all === '1' && (await currentUser(req))?.role === 'admin';
  const { rows } = await query(`SELECT n.*,u.display_name AS author FROM news n JOIN users u ON u.id=n.author_id ${all ? '' : "WHERE n.status='published'"} ORDER BY n.published_at DESC NULLS LAST,n.created_at DESC LIMIT 100`);
  res.json(rows);
}));
app.get('/api/news/:slug', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM news WHERE slug=$1', [req.params.slug]);
  if (!rows[0] || (rows[0].status !== 'published' && (await currentUser(req))?.role !== 'admin')) fail(404, 'Публикация не найдена.');
  res.json(rows[0]);
}));
app.post('/api/news', needUser, needAdmin, wrap(async (req, res) => {
  const title = str(req.body.title, 160), body = str(req.body.body, 20000);
  if (!title || !body) fail(400, 'Укажите название и текст.');
  const status = oneOf(req.body.status, ['draft', 'published']);
  const { rows } = await query(`INSERT INTO news(slug,title,summary,body,cover_url,status,author_id,published_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $6='published' THEN now() ELSE NULL END) RETURNING *`,
  [slug(title), title, str(req.body.summary, 500), body, validUrl(req.body.cover_url), status, req.user.id]);
  res.status(201).json(rows[0]);
}));
app.patch('/api/news/:id', needUser, needAdmin, wrap(async (req, res) => {
  const title = str(req.body.title, 160), body = str(req.body.body, 20000);
  if (!title || !body) fail(400, 'Укажите название и текст.');
  const status = oneOf(req.body.status, ['draft', 'published']);
  const { rows } = await query(`UPDATE news SET title=$1,summary=$2,body=$3,cover_url=$4,status=$5,
    published_at=CASE WHEN $5='published' THEN coalesce(published_at,now()) ELSE NULL END,updated_at=now()
    WHERE id=$6 RETURNING *`, [title, str(req.body.summary, 500), body, validUrl(req.body.cover_url), status, req.params.id]);
  if (!rows[0]) fail(404, 'Публикация не найдена.'); res.json(rows[0]);
}));
app.delete('/api/news/:id', needUser, needAdmin, wrap(async (req, res) => {
  const { rowCount } = await query('DELETE FROM news WHERE id=$1', [req.params.id]);
  if (!rowCount) fail(404, 'Публикация не найдена.'); res.json({ ok: true });
}));

app.get('/api/teams', needUser, wrap(async (req, res) => {
  const { rows } = await query(`SELECT t.*, (SELECT count(*)::int FROM team_members m WHERE m.team_id=t.id) AS member_count
    FROM teams t JOIN team_members m ON m.team_id=t.id WHERE m.user_id=$1 ORDER BY t.created_at DESC`, [req.user.id]);
  res.json(rows);
}));
app.get('/api/teams/:id', wrap(async (req, res) => {
  const { rows } = await query(`SELECT t.id,t.name,t.logo_url,t.captain_id,t.created_at,
    coalesce(json_agg(json_build_object('id',u.id,'name',coalesce(u.nickname,u.display_name))) FILTER (WHERE u.id IS NOT NULL),'[]') AS members
    FROM teams t LEFT JOIN team_members m ON m.team_id=t.id LEFT JOIN users u ON u.id=m.user_id WHERE t.id=$1 GROUP BY t.id`, [req.params.id]);
  if (!rows[0]) fail(404, 'Команда не найдена.'); res.json(rows[0]);
}));
app.post('/api/teams', needUser, wrap(async (req, res) => {
  const name = str(req.body.name, 80);
  if (name.length < 2) fail(400, 'Название команды слишком короткое.');
  const team = await transaction(async db => {
    const { rows } = await db.query('INSERT INTO teams(name,logo_url,captain_id,invite_code) VALUES($1,$2,$3,$4) RETURNING *',
      [name, validUrl(req.body.logo_url), req.user.id, crypto.randomBytes(12).toString('hex')]);
    await db.query('INSERT INTO team_members(team_id,user_id) VALUES($1,$2)', [rows[0].id, req.user.id]);
    return rows[0];
  });
  res.status(201).json(team);
}));
app.patch('/api/teams/:id', needUser, wrap(async (req, res) => {
  const name = str(req.body.name, 80);
  if (name.length < 2) fail(400, 'Название команды слишком короткое.');
  const { rows } = await query('UPDATE teams SET name=$1,logo_url=$2,updated_at=now() WHERE id=$3 AND captain_id=$4 RETURNING *',
    [name, validUrl(req.body.logo_url), req.params.id, req.user.id]);
  if (!rows[0]) fail(403, 'Только капитан может изменить команду.'); res.json(rows[0]);
}));
app.post('/api/teams/join', needUser, wrap(async (req, res) => {
  const { rows } = await query('SELECT id FROM teams WHERE invite_code=$1', [str(req.body.code, 40)]);
  if (!rows[0]) fail(404, 'Код приглашения не найден.');
  await query('INSERT INTO team_members(team_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, req.user.id]);
  res.json({ teamId: rows[0].id });
}));
app.post('/api/teams/:id/rotate-code', needUser, wrap(async (req, res) => {
  const { rows } = await query('UPDATE teams SET invite_code=$1 WHERE id=$2 AND captain_id=$3 RETURNING invite_code',
    [crypto.randomBytes(12).toString('hex'), req.params.id, req.user.id]);
  if (!rows[0]) fail(403, 'Только капитан может изменить код.'); res.json(rows[0]);
}));
app.delete('/api/teams/:id/members/:userId', needUser, wrap(async (req, res) => {
  const { rows } = await query('SELECT captain_id FROM teams WHERE id=$1', [req.params.id]);
  if (!rows[0]) fail(404, 'Команда не найдена.');
  if (rows[0].captain_id === req.params.userId) fail(400, 'Капитан не может покинуть команду.');
  if (req.user.id !== rows[0].captain_id && req.user.id !== req.params.userId) fail(403, 'Нет доступа.');
  await query('DELETE FROM team_members WHERE team_id=$1 AND user_id=$2', [req.params.id, req.params.userId]);
  res.json({ ok: true });
}));

app.get('/api/free-players', wrap(async (_req, res) => {
  const { rows } = await query(`SELECT f.game,f.mmr,f.position,f.heroes,f.description,f.updated_at,
    coalesce(u.nickname,u.display_name) AS name,u.avatar_url,u.telegram_username
    FROM free_players f JOIN users u ON u.id=f.user_id
    WHERE f.is_visible=true AND f.contact_consent=true AND u.telegram_username IS NOT NULL ORDER BY f.updated_at DESC LIMIT 200`);
  res.json(rows);
}));
app.get('/api/free-players/me', needUser, wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM free_players WHERE user_id=$1', [req.user.id]); res.json(rows[0] || null);
}));
app.put('/api/free-players/me', needUser, wrap(async (req, res) => {
  const mmr = number(req.body.mmr, 0, 20000), position = str(req.body.position, 50);
  if (!position) fail(400, 'Укажите позицию.');
  const heroes = Array.isArray(req.body.heroes) ? req.body.heroes.slice(0, 12).map(v => str(v, 40)).filter(Boolean) : [];
  const visible = req.body.is_visible === true, consent = req.body.contact_consent === true;
  if (visible && (!consent || !req.user.telegram_username)) fail(400, 'Для публикации нужен Telegram username и согласие на показ контакта.');
  const { rows } = await query(`INSERT INTO free_players(user_id,game,mmr,position,heroes,description,is_visible,contact_consent)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id) DO UPDATE SET game=excluded.game,mmr=excluded.mmr,
    position=excluded.position,heroes=excluded.heroes,description=excluded.description,is_visible=excluded.is_visible,
    contact_consent=excluded.contact_consent,updated_at=now() RETURNING *`,
  [req.user.id, str(req.body.game, 60) || 'Dota 2', mmr, position, heroes, str(req.body.description, 500), visible, consent]);
  res.json(rows[0]);
}));

const tournamentSelect = `SELECT t.*, (SELECT count(*)::int FROM tournament_entries e WHERE e.tournament_id=t.id AND e.status='approved') AS approved_count
  FROM tournaments t`;
app.get('/api/tournaments', wrap(async (req, res) => {
  const all = req.query.all === '1' && (await currentUser(req))?.role === 'admin';
  const { rows } = await query(`${tournamentSelect} ${all ? '' : "WHERE t.status<>'draft'"} ORDER BY t.starts_at DESC LIMIT 100`);
  res.json(rows);
}));
app.get('/api/tournaments/:id', wrap(async (req, res) => {
  const all = (await currentUser(req))?.role === 'admin';
  const { rows } = await query(`${tournamentSelect} WHERE t.id=$1`, [req.params.id]);
  if (!rows[0] || (rows[0].status === 'draft' && !all)) fail(404, 'Турнир не найден.');
  const entries = await query(`SELECT e.id,e.status,e.team_id,e.user_id,e.created_at,
    coalesce(t.name,u.nickname,u.display_name) AS name,t.logo_url,
    coalesce((SELECT json_agg(r.name_snapshot ORDER BY r.name_snapshot) FROM entry_roster r WHERE r.entry_id=e.id),'[]') AS roster
    FROM tournament_entries e LEFT JOIN teams t ON t.id=e.team_id LEFT JOIN users u ON u.id=e.user_id
    WHERE e.tournament_id=$1 ${all ? '' : "AND e.status='approved'"} ORDER BY e.created_at`, [req.params.id]);
  const matches = await query(`SELECT m.*,coalesce(ta.name,ua.nickname,ua.display_name) AS name_a,
    coalesce(tb.name,ub.nickname,ub.display_name) AS name_b
    FROM matches m LEFT JOIN tournament_entries ea ON ea.id=m.entry_a_id
    LEFT JOIN teams ta ON ta.id=ea.team_id LEFT JOIN users ua ON ua.id=ea.user_id
    LEFT JOIN tournament_entries eb ON eb.id=m.entry_b_id
    LEFT JOIN teams tb ON tb.id=eb.team_id LEFT JOIN users ub ON ub.id=eb.user_id
    WHERE m.tournament_id=$1 ORDER BY CASE m.bracket WHEN 'upper' THEN 1 WHEN 'lower' THEN 2 ELSE 3 END,m.round_no,m.position`, [req.params.id]);
  res.json({ ...rows[0], entries: entries.rows, matches: matches.rows });
}));
function tournamentInput(body) {
  const title = str(body.title, 160);
  if (!title) fail(400, 'Укажите название турнира.');
  const openAt = body.registration_open_at ? date(body.registration_open_at) : null;
  const closeAt = body.registration_close_at ? date(body.registration_close_at) : null;
  if (openAt && closeAt && openAt >= closeAt) fail(400, 'Конец регистрации должен быть позже начала.');
  return [title, str(body.game, 60) || 'Dota 2', str(body.description, 5000), str(body.rules, 10000),
    str(body.prizes, 2000), oneOf(body.format, ['single', 'double']), oneOf(body.participant_type, ['team', 'solo']),
    number(body.team_size, 1, 20), number(body.max_entries, 2, 32), oneOf(body.status, ['draft', 'open', 'closed', 'live', 'completed']),
    openAt, closeAt, date(body.starts_at)];
}
app.post('/api/tournaments', needUser, needAdmin, wrap(async (req, res) => {
  const values = tournamentInput(req.body);
  if (values[9] === 'live' || values[9] === 'completed') fail(400, 'Новый турнир начните с черновика или регистрации.');
  const { rows } = await query(`INSERT INTO tournaments(title,game,description,rules,prizes,format,participant_type,team_size,max_entries,status,
    registration_open_at,registration_close_at,starts_at,slug,created_by)
    VALUES(${Array.from({ length: 15 }, (_, i) => `$${i + 1}`).join(',')}) RETURNING *`, [...values, slug(values[0]), req.user.id]);
  res.status(201).json(rows[0]);
}));
app.patch('/api/tournaments/:id', needUser, needAdmin, wrap(async (req, res) => {
  const values = tournamentInput(req.body);
  const { rows: old } = await query('SELECT * FROM tournaments WHERE id=$1', [req.params.id]);
  if (!old[0]) fail(404, 'Турнир не найден.');
  const { rows: entries } = await query('SELECT id FROM tournament_entries WHERE tournament_id=$1 LIMIT 1', [req.params.id]);
  if (entries.length && (values[5] !== old[0].format || values[6] !== old[0].participant_type || values[7] !== old[0].team_size)) fail(409, 'После первой заявки формат, тип участников и размер команды менять нельзя.');
  const { rows: matches } = await query('SELECT id FROM matches WHERE tournament_id=$1 LIMIT 1', [req.params.id]);
  if (matches.length && (values[5] !== old[0].format || values[6] !== old[0].participant_type || values[8] !== old[0].max_entries)) fail(409, 'После создания сетки формат, тип участников и лимит менять нельзя.');
  if (matches.length && values[9] !== old[0].status) fail(409, 'Статус запущенного турнира нельзя изменить через редактор.');
  if (old[0].status === 'completed') fail(409, 'Завершённый турнир закрыт для редактирования.');
  if (values[9] === 'completed' || (values[9] === 'live' && !matches.length)) fail(400, 'Запустите сетку и завершайте турнир через специальные действия.');
  const fields = ['title','game','description','rules','prizes','format','participant_type','team_size','max_entries','status','registration_open_at','registration_close_at','starts_at'];
  const { rows } = await query(`UPDATE tournaments SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(',')},updated_at=now() WHERE id=$14 RETURNING *`, [...values, req.params.id]);
  res.json(rows[0]);
}));
app.delete('/api/tournaments/:id', needUser, needAdmin, wrap(async (req, res) => {
  const { rows } = await query('SELECT status FROM tournaments WHERE id=$1', [req.params.id]);
  if (!rows[0]) fail(404, 'Турнир не найден.');
  if (['live', 'completed'].includes(rows[0].status)) fail(409, 'Запущенный или завершённый турнир удалять нельзя.');
  await query('DELETE FROM tournaments WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));
app.get('/api/my-entries', needUser, wrap(async (req, res) => {
  const { rows } = await query(`SELECT e.*,t.title,t.starts_at,tm.name AS team_name FROM tournament_entries e
    JOIN tournaments t ON t.id=e.tournament_id LEFT JOIN teams tm ON tm.id=e.team_id
    WHERE e.submitted_by=$1 ORDER BY e.created_at DESC`, [req.user.id]); res.json(rows);
}));
app.post('/api/tournaments/:id/entries', needUser, wrap(async (req, res) => {
  const entry = await transaction(async db => {
    const { rows } = await db.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [req.params.id]);
    const t = rows[0]; if (!t) fail(404, 'Турнир не найден.');
    const now = new Date();
    if (t.status !== 'open' || (t.registration_open_at && now < t.registration_open_at) || (t.registration_close_at && now > t.registration_close_at)) fail(409, 'Регистрация закрыта.');
    const { rows: count } = await db.query(`SELECT count(*)::int AS total FROM tournament_entries WHERE tournament_id=$1 AND status IN ('pending','approved')`, [t.id]);
    if (count[0].total >= t.max_entries) fail(409, 'Мест больше нет.');
    let teamId = null, userId = null;
    if (t.participant_type === 'team') {
      teamId = req.body.team_id;
      const { rows: team } = await db.query('SELECT * FROM teams WHERE id=$1 AND captain_id=$2', [teamId, req.user.id]);
      if (!team[0]) fail(403, 'Заявку может подать только капитан своей команды.');
      const { rows: members } = await db.query('SELECT count(*)::int AS total FROM team_members WHERE team_id=$1', [teamId]);
      if (members[0].total !== t.team_size) fail(409, `Для турнира требуется ровно ${t.team_size} игроков в команде.`);
    } else userId = req.user.id;
    const { rows: created } = await db.query('INSERT INTO tournament_entries(tournament_id,team_id,user_id,submitted_by) VALUES($1,$2,$3,$4) RETURNING *', [t.id, teamId, userId, req.user.id]);
    return created[0];
  }); res.status(201).json(entry);
}));
app.post('/api/entries/:id/withdraw', needUser, wrap(async (req, res) => {
  const { rows } = await query(`UPDATE tournament_entries e SET status='withdrawn' FROM tournaments t
    WHERE e.id=$1 AND e.tournament_id=t.id AND e.submitted_by=$2 AND e.status IN ('pending','approved') AND t.status IN ('open','closed') RETURNING e.*`, [req.params.id, req.user.id]);
  if (!rows[0]) fail(409, 'Эту заявку уже нельзя отозвать.'); res.json(rows[0]);
}));
app.post('/api/entries/:id/review', needUser, needAdmin, wrap(async (req, res) => {
  const status = oneOf(req.body.status, ['approved', 'rejected']);
  const entry = await transaction(async db => {
    const { rows } = await db.query('SELECT * FROM tournament_entries WHERE id=$1 FOR UPDATE', [req.params.id]);
    const e = rows[0]; if (!e) fail(404, 'Заявка не найдена.');
    if (e.status !== 'pending') fail(409, 'Заявка уже рассмотрена.');
    const { rows: tours } = await db.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [e.tournament_id]);
    const t = tours[0]; if (!['open', 'closed'].includes(t.status)) fail(409, 'Турнир уже начался.');
    if (status === 'approved') {
      const { rows: count } = await db.query("SELECT count(*)::int AS total FROM tournament_entries WHERE tournament_id=$1 AND status='approved'", [e.tournament_id]);
      if (count[0].total >= t.max_entries) fail(409, 'Лимит одобренных участников достигнут.');
      const roster = e.team_id
        ? await db.query('SELECT u.id,coalesce(u.nickname,u.display_name) AS name FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1', [e.team_id])
        : await db.query('SELECT id,coalesce(nickname,display_name) AS name FROM users WHERE id=$1', [e.user_id]);
      if (roster.rows.length !== (e.team_id ? t.team_size : 1)) fail(409, 'Состав изменился и больше не соответствует требованиям турнира.');
      for (const member of roster.rows) await db.query('INSERT INTO entry_roster(entry_id,user_id,name_snapshot) VALUES($1,$2,$3)', [e.id, member.id, member.name]);
    }
    const { rows: updated } = await db.query('UPDATE tournament_entries SET status=$1,review_note=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4 RETURNING *',
      [status, str(req.body.note, 500), req.user.id, e.id]);
    await audit(db, req.user.id, `entry.${status}`, 'entry', e.id);
    return updated[0];
  }); res.json(entry);
}));

app.post('/api/tournaments/:id/bracket', needUser, needAdmin, wrap(async (req, res) => {
  const result = await transaction(async db => {
    const { rows: tours } = await db.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [req.params.id]);
    const t = tours[0]; if (!t) fail(404, 'Турнир не найден.');
    if (!['open', 'closed'].includes(t.status)) fail(409, 'Нельзя запустить сетку в этом статусе.');
    const { rows: existing } = await db.query('SELECT id FROM matches WHERE tournament_id=$1 LIMIT 1', [t.id]);
    if (existing.length) fail(409, 'Сетка уже создана.');
    const { rows: pending } = await db.query("SELECT id FROM tournament_entries WHERE tournament_id=$1 AND status='pending' LIMIT 1", [t.id]);
    if (pending.length) fail(409, 'Сначала рассмотрите все заявки.');
    const { rows: entries } = await db.query("SELECT id FROM tournament_entries WHERE tournament_id=$1 AND status='approved' ORDER BY created_at,id", [t.id]);
    const plan = buildBracket(entries.map(e => e.id), t.format);
    const ids = [];
    for (const node of plan) {
      const { rows } = await db.query(`INSERT INTO matches(tournament_id,bracket,round_no,position,entry_a_id,entry_b_id,source_a_id,source_b_id,
        source_a_result,source_b_result,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [t.id, node.bracket, node.round, node.position, node.a.entry || null, node.b.entry || null,
        node.a.source === undefined ? null : ids[node.a.source], node.b.source === undefined ? null : ids[node.b.source],
        node.a.result || null, node.b.result || null, node.a.entry && node.b.entry ? 'ready' : 'pending']);
      ids.push(rows[0].id);
    }
    await db.query("UPDATE tournaments SET status='live',updated_at=now() WHERE id=$1", [t.id]);
    await audit(db, req.user.id, 'bracket.created', 'tournament', t.id, { entries: entries.length, format: t.format });
    return { matches: ids.length };
  }); res.status(201).json(result);
}));
app.post('/api/matches/:id/result', needUser, needAdmin, wrap(async (req, res) => {
  const scoreA = number(req.body.score_a, 0, 100), scoreB = number(req.body.score_b, 0, 100);
  if (scoreA === scoreB) fail(400, 'Ничья в сетке выбывания невозможна.');
  const result = await transaction(async db => {
    const { rows } = await db.query('SELECT m.*,t.status AS tournament_status,t.format FROM matches m JOIN tournaments t ON t.id=m.tournament_id WHERE m.id=$1 FOR UPDATE OF m,t', [req.params.id]);
    const m = rows[0]; if (!m) fail(404, 'Матч не найден.');
    if (m.tournament_status !== 'live' || m.status !== 'ready' || !m.entry_a_id || !m.entry_b_id) fail(409, 'Матч сейчас нельзя завершить.');
    const winner = scoreA > scoreB ? m.entry_a_id : m.entry_b_id;
    const loser = scoreA > scoreB ? m.entry_b_id : m.entry_a_id;
    await db.query("UPDATE matches SET score_a=$1,score_b=$2,winner_id=$3,status='completed',updated_at=now() WHERE id=$4", [scoreA, scoreB, winner, m.id]);
    const { rows: dependent } = await db.query("SELECT * FROM matches WHERE source_a_id=$1 OR source_b_id=$1 FOR UPDATE", [m.id]);
    for (const next of dependent) {
      const changes = {};
      if (next.source_a_id === m.id) changes.entry_a_id = next.source_a_result === 'winner' ? winner : loser;
      if (next.source_b_id === m.id) changes.entry_b_id = next.source_b_result === 'winner' ? winner : loser;
      const a = changes.entry_a_id || next.entry_a_id, b = changes.entry_b_id || next.entry_b_id;
      await db.query(`UPDATE matches SET entry_a_id=$1,entry_b_id=$2,status=$3,updated_at=now() WHERE id=$4`,
        [a, b, a && b ? 'ready' : 'pending', next.id]);
    }
    // In double elimination the lower-bracket winner must beat the upper-bracket winner twice.
    if (m.bracket === 'final' && m.round_no === 1 && m.format === 'double' && winner === m.entry_b_id) {
      await db.query(`INSERT INTO matches(tournament_id,bracket,round_no,position,entry_a_id,entry_b_id,status)
        VALUES($1,'final',2,1,$2,$3,'ready')`, [m.tournament_id, m.entry_a_id, m.entry_b_id]);
    }
    await audit(db, req.user.id, 'match.result', 'match', m.id, { scoreA, scoreB, winner });
    return { winner, resetFinal: m.bracket === 'final' && m.round_no === 1 && m.format === 'double' && winner === m.entry_b_id };
  }); res.json(result);
}));
app.post('/api/tournaments/:id/finish', needUser, needAdmin, wrap(async (req, res) => {
  const result = await transaction(async db => {
    const { rows: tours } = await db.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [req.params.id]);
    const t = tours[0]; if (!t || t.status !== 'live') fail(409, 'Турнир не запущен.');
    const { rows: unfinished } = await db.query("SELECT id FROM matches WHERE tournament_id=$1 AND status<>'completed' LIMIT 1", [t.id]);
    if (unfinished.length) fail(409, 'Сначала завершите все матчи.');
    const { rows: finals } = await db.query(`SELECT * FROM matches WHERE tournament_id=$1 ORDER BY CASE WHEN bracket='final' THEN 0 ELSE 1 END,round_no DESC LIMIT 1`, [t.id]);
    const final = finals[0], first = final.winner_id;
    const second = first === final.entry_a_id ? final.entry_b_id : final.entry_a_id;
    const places = [first, second];
    if (t.format === 'double') {
      const { rows: lower } = await db.query("SELECT * FROM matches WHERE tournament_id=$1 AND bracket='lower' ORDER BY round_no DESC LIMIT 1", [t.id]);
      if (lower[0]) places.push(lower[0].winner_id === lower[0].entry_a_id ? lower[0].entry_b_id : lower[0].entry_a_id);
    }
    for (let i = 0; i < places.length; i++) {
      const { rows: e } = await db.query(`SELECT coalesce(tm.name,u.nickname,u.display_name) AS name,tm.logo_url,
        coalesce((SELECT json_agg(r.name_snapshot ORDER BY r.name_snapshot) FROM entry_roster r WHERE r.entry_id=te.id),'[]') AS roster
        FROM tournament_entries te LEFT JOIN teams tm ON tm.id=te.team_id LEFT JOIN users u ON u.id=te.user_id WHERE te.id=$1`, [places[i]]);
      await db.query('INSERT INTO tournament_results(tournament_id,entry_id,place,name_snapshot,logo_url_snapshot,roster_snapshot) VALUES($1,$2,$3,$4,$5,$6)',
        [t.id, places[i], i + 1, e[0].name, e[0].logo_url, JSON.stringify(e[0].roster)]);
    }
    await db.query("UPDATE tournaments SET status='completed',ends_at=now(),updated_at=now() WHERE id=$1", [t.id]);
    await audit(db, req.user.id, 'tournament.finished', 'tournament', t.id);
    return { winner: first };
  }); res.json(result);
}));
app.get('/api/hall', wrap(async (_req, res) => {
  const { rows } = await query(`SELECT r.place,r.name_snapshot,r.logo_url_snapshot,r.roster_snapshot,r.published_at,
    t.id AS tournament_id,t.title,t.game,t.ends_at FROM tournament_results r JOIN tournaments t ON t.id=r.tournament_id
    WHERE t.status='completed' ORDER BY t.ends_at DESC,r.place LIMIT 100`); res.json(rows);
}));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Адрес API не найден.')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((error, _req, res, _next) => {
  if (!error.status && !['23505', '23503', '22P02', '23514'].includes(error.code)) console.error(error);
  const status = error.status || (error.code === '23505' ? 409 : ['23503', '22P02', '23514'].includes(error.code) ? 400 : 500);
  res.status(status).json({ error: error.status ? error.message : status === 409 ? 'Запись уже существует.' : status === 400 ? 'Некорректные данные.' : 'Внутренняя ошибка сервера.' });
});
const port = Number(process.env.PORT || 3000);
if (require.main === module) app.listen(port, () => console.log(`Feel Like Pro listening on ${port}`));
module.exports = app;
