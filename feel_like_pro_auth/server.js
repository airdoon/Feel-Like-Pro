require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const SteamStrategy = require('passport-steam').Strategy;
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const required = ['SESSION_SECRET'];
for (const k of required) if (!process.env[k]) { console.error(`Missing required environment variable: ${k}`); process.exit(1); }
if (process.env.SESSION_SECRET.length < 32) { console.error('SESSION_SECRET must be at least 32 characters.'); process.exit(1); }

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(session({
  name: 'flp.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/google/callback`
  }, (_accessToken, _refreshToken, profile, done) => {
    done(null, { provider: 'google', id: profile.id, name: profile.displayName || 'Google player', email: profile.emails?.[0]?.value || null, photo: profile.photos?.[0]?.value || null });
  }));
}
if (process.env.STEAM_API_KEY) {
  passport.use(new SteamStrategy({
    returnURL: `${BASE_URL}/auth/steam/return`,
    realm: `${BASE_URL}/`,
    apiKey: process.env.STEAM_API_KEY
  }, (_identifier, profile, done) => {
    done(null, { provider: 'steam', id: profile.id, name: profile.displayName || `Steam ${profile.id}`, photo: profile.photos?.[2]?.value || profile.photos?.[0]?.value || null, profileUrl: profile._json?.profileurl || null });
  }));
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
app.get('/auth/google', authLimiter, (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).send(setupPage('Google OAuth not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.'));
  passport.authenticate('google', { scope: ['profile', 'email'], state: true })(req, res, next);
});
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/?auth=failed' }), (_req, res) => res.redirect('/?auth=success'));

app.get('/auth/steam', authLimiter, (req, res, next) => {
  if (!process.env.STEAM_API_KEY) return res.status(503).send(setupPage('Steam sign-in not configured yet. Add STEAM_API_KEY to .env. Steam OpenID verifies the Steam identity; the key is used here to fetch profile information.'));
  passport.authenticate('steam', { state: true })(req, res, next);
});
app.get('/auth/steam/return', passport.authenticate('steam', { failureRedirect: '/?auth=failed' }), (_req, res) => res.redirect('/?auth=success'));

// Telegram Login Widget callback: the server validates the HMAC using the bot token.
app.post('/auth/telegram', authLimiter, (req, res) => {
  const data = req.body;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(503).json({ error: 'Telegram login is not configured. Add TELEGRAM_BOT_TOKEN to .env.' });
  if (!data || typeof data !== 'object' || typeof data.hash !== 'string' || !/^\d+$/.test(String(data.id || '')) || !/^\d+$/.test(String(data.auth_date || ''))) return res.status(400).json({ error: 'Invalid Telegram auth payload.' });
  const authDate = Number(data.auth_date);
  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 30 || now - authDate > 300) return res.status(401).json({ error: 'Telegram login expired. Please try again.' });
  const fields = Object.keys(data).filter(k => k !== 'hash' && data[k] !== undefined && data[k] !== null).sort().map(k => `${k}=${data[k]}`).join('\n');
  const secret = crypto.createHash('sha256').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(fields).digest();
  let supplied;
  try { supplied = Buffer.from(data.hash, 'hex'); } catch { return res.status(401).json({ error: 'Invalid Telegram signature.' }); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(401).json({ error: 'Telegram signature could not be verified.' });
  req.login({ provider: 'telegram', id: String(data.id), name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || `Telegram ${data.id}`, username: data.username || null, photo: data.photo_url || null }, err => {
    if (err) return res.status(500).json({ error: 'Could not create login session.' });
    res.json({ ok: true, user: req.user });
  });
});

app.get('/api/config', (_req, res) => res.json({ telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || '' }));
app.get('/api/me', (req, res) => res.json({ authenticated: Boolean(req.user), user: req.user || null }));
app.post('/auth/logout', (req, res) => {
  req.logout(err => {
    if (err) return res.status(500).json({ error: 'Could not log out.' });
    req.session.destroy(() => { res.clearCookie('flp.sid'); res.json({ ok: true }); });
  });
});
app.get('/health', (_req, res) => res.json({ ok: true, service: 'feel-like-pro-auth' }));

function setupPage(message) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Feel Like Pro — setup</title><body style="background:#08090d;color:#f5f5f7;font:16px system-ui;padding:40px;max-width:700px;margin:auto"><h1 style="color:#ff4655">FEEL LIKE PRO</h1><p>${message.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</p><p><a style="color:#ff777d" href="/">Return to site</a></p></body></html>`;
}
app.listen(PORT, () => console.log(`Feel Like Pro auth server running at ${BASE_URL}`));
