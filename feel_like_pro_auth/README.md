# Feel Like Pro — real authentication starter

This package keeps the existing Feel Like Pro HTML design and adds a Node.js backend for Google OAuth, Telegram Login Widget validation, Steam OpenID, server sessions, `/api/me`, and logout.

> This is an authentication starter, not a finished production account platform. It does not yet persist user profiles in a database or merge identities from different providers. Logging in with Google and later Steam currently produces different provider identities; account linking needs a deliberate verified flow and database schema.

## Requirements
- Node.js 20 or newer
- Google OAuth Web client (for Google)
- Telegram bot from `@BotFather` (for Telegram)
- Steam Web API key (for profile details and the Steam strategy setup)

## 1. Run locally
1. Extract the ZIP.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Set `SESSION_SECRET` to a random secret of at least 32 characters. Example generation: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
6. Set `BASE_URL=http://localhost:3000`.
7. Fill provider credentials as described below.
8. Run `npm start` and open `http://localhost:3000`.

## 2. Google OAuth
1. Open Google Cloud Console and create/select a project.
2. Configure the OAuth consent screen / Google Auth Platform.
3. Create an OAuth client ID of type **Web application**.
4. Add `http://localhost:3000` to Authorized JavaScript origins.
5. Add `http://localhost:3000/auth/google/callback` to Authorized redirect URIs.
6. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
7. For production, replace localhost with your HTTPS domain and update the callback URL in Google Console and `BASE_URL`.

Official guide: https://supabase.com/docs/guides/auth/social-login/auth-google (general Google OAuth setup; this starter uses Passport directly).

## 3. Telegram Login
1. Message `@BotFather`, create a bot, and copy its token into `TELEGRAM_BOT_TOKEN`.
2. Set `TELEGRAM_BOT_USERNAME` to the bot username without `@`.
3. In BotFather, use `/setdomain` and set the exact domain that will host the site. For local testing, Telegram's widget may require a publicly reachable domain; test on a deployed HTTPS domain or tunnel if localhost is rejected.
4. The widget needs to be inserted into the page using the configured bot username. The server endpoint `/auth/telegram` validates the signature and rejects payloads older than five minutes.

Official guide: https://core.telegram.org/widgets/login/

## 4. Steam OpenID
1. Get a Steam Web API key at https://steamcommunity.com/dev/apikey (Steam OpenID identity itself uses Steam's OpenID endpoint).
2. Set `STEAM_API_KEY` in `.env`.
3. For local testing, Steam may reject localhost as a realm/return URL. Deploy to a public HTTPS domain or use a suitable public development tunnel, then set `BASE_URL` to that exact origin.
4. Ensure `BASE_URL` ends up matching the site origin, and that callback URL is `/auth/steam/return`.

Steam documentation: https://partner.steamgames.com/doc/features/auth

## 5. Production checklist
- Use HTTPS and a real public domain.
- Use a strong unique `SESSION_SECRET`; never commit `.env`.
- Replace the default in-memory Express session store with a persistent production session store (e.g. Redis/Postgres adapter).
- Add persistent users and profiles, unique provider IDs, verified account-linking flow, CSRF protection for state-changing app actions, rate limiting at the edge, logging and backups.
- Set `NODE_ENV=production` behind a correctly configured HTTPS reverse proxy.
- Configure platform callback URLs to match your real deployment domain exactly.
- Do not make admin status or tournament approvals depend on browser-only state. Enforce roles server-side.

## Routes
- `GET /auth/google` — start Google sign-in
- `GET /auth/google/callback` — Google callback
- `GET /auth/steam` — start Steam sign-in
- `GET /auth/steam/return` — Steam callback
- `POST /auth/telegram` — Telegram widget payload validation
- `GET /api/me` — current session
- `POST /auth/logout` — end session
- `GET /health` — server health check
