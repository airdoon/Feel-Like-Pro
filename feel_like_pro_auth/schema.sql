CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), telegram_id bigint NOT NULL UNIQUE,
  telegram_username text, display_name text NOT NULL, avatar_url text, nickname text,
  role text NOT NULL DEFAULT 'player' CHECK (role IN ('player','admin')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, logo_url text,
  captain_id uuid NOT NULL REFERENCES users(id), invite_code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(team_id,user_id)
);
CREATE TABLE IF NOT EXISTS tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, title text NOT NULL,
  game text NOT NULL DEFAULT 'Dota 2', description text NOT NULL DEFAULT '',
  rules text NOT NULL DEFAULT '', prizes text NOT NULL DEFAULT '',
  format text NOT NULL DEFAULT 'single' CHECK (format IN ('single','double')),
  participant_type text NOT NULL DEFAULT 'team' CHECK (participant_type IN ('team','solo')),
  team_size int NOT NULL DEFAULT 5 CHECK (team_size BETWEEN 1 AND 20),
  max_entries int NOT NULL DEFAULT 16 CHECK (max_entries BETWEEN 2 AND 32),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','live','completed')),
  registration_open_at timestamptz, registration_close_at timestamptz,
  starts_at timestamptz NOT NULL, ends_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournaments_status_starts_idx ON tournaments(status,starts_at);
CREATE TABLE IF NOT EXISTS tournament_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id), user_id uuid REFERENCES users(id),
  submitted_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  review_note text, reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((team_id IS NOT NULL) <> (user_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS entries_active_team_idx ON tournament_entries(tournament_id,team_id) WHERE team_id IS NOT NULL AND status IN ('pending','approved');
CREATE UNIQUE INDEX IF NOT EXISTS entries_active_user_idx ON tournament_entries(tournament_id,user_id) WHERE user_id IS NOT NULL AND status IN ('pending','approved');
CREATE TABLE IF NOT EXISTS entry_roster (
  entry_id uuid NOT NULL REFERENCES tournament_entries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id), name_snapshot text NOT NULL,
  PRIMARY KEY(entry_id,user_id)
);
CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  bracket text NOT NULL CHECK (bracket IN ('upper','lower','final')),
  round_no int NOT NULL, position int NOT NULL,
  entry_a_id uuid REFERENCES tournament_entries(id), entry_b_id uuid REFERENCES tournament_entries(id),
  source_a_id uuid REFERENCES matches(id), source_b_id uuid REFERENCES matches(id),
  source_a_result text CHECK (source_a_result IN ('winner','loser')),
  source_b_result text CHECK (source_b_result IN ('winner','loser')),
  score_a int CHECK (score_a >= 0), score_b int CHECK (score_b >= 0),
  winner_id uuid REFERENCES tournament_entries(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','completed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tournament_id,bracket,round_no,position)
);
CREATE INDEX IF NOT EXISTS matches_tournament_idx ON matches(tournament_id,bracket,round_no,position);
CREATE TABLE IF NOT EXISTS tournament_results (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES tournament_entries(id),
  place int NOT NULL CHECK (place BETWEEN 1 AND 3),
  name_snapshot text NOT NULL, logo_url_snapshot text,
  roster_snapshot jsonb NOT NULL DEFAULT '[]', published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tournament_id,place), UNIQUE(tournament_id,entry_id)
);
CREATE TABLE IF NOT EXISTS free_players (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  game text NOT NULL DEFAULT 'Dota 2', mmr int NOT NULL CHECK (mmr BETWEEN 0 AND 20000),
  position text NOT NULL, heroes text[] NOT NULL DEFAULT '{}', description text NOT NULL DEFAULT '',
  is_visible boolean NOT NULL DEFAULT false, contact_consent boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
  title text NOT NULL, summary text NOT NULL DEFAULT '', body text NOT NULL,
  cover_url text, status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  author_id uuid NOT NULL REFERENCES users(id), published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_published_idx ON news(status,published_at DESC);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
