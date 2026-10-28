PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('staff', 'learner', 'resident')),
  pgy INTEGER,
  extension TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  CHECK ((role = 'resident' AND pgy IS NOT NULL AND pgy BETWEEN 1 AND 5)
      OR (role IN ('staff', 'learner') AND pgy IS NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY NOT NULL,
  procedure TEXT NOT NULL,
  location TEXT NOT NULL,
  contact TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  staff_id TEXT REFERENCES users(id),
  learner_id TEXT REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'in_progress', 'completed', 'expired', 'cancelled')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER,
  coordinated_at INTEGER,
  completed_at INTEGER,
  cancelled_at INTEGER,
  expired_at INTEGER,
  eta_minutes INTEGER CHECK (eta_minutes IS NULL OR eta_minutes IN (3, 5, 10)),
  contacted INTEGER NOT NULL DEFAULT 0 CHECK (contacted IN (0, 1)),
  supervisor_id TEXT REFERENCES users(id),
  participation TEXT CHECK (participation IS NULL OR participation IN ('performed', 'assisted', 'observed')),
  manual INTEGER NOT NULL DEFAULT 0 CHECK (manual IN (0, 1)),
  cancellation_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS current_claim_per_learner ON requests(learner_id)
  WHERE learner_id IS NOT NULL AND status IN ('claimed', 'in_progress');
CREATE INDEX IF NOT EXISTS requests_by_staff ON requests(staff_id);
CREATE INDEX IF NOT EXISTS requests_by_learner ON requests(learner_id);
CREATE INDEX IF NOT EXISTS requests_by_status_expiry ON requests(status, expires_at);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
  UNIQUE (request_id, user_id)
);
CREATE INDEX IF NOT EXISTS alerts_by_user ON alerts(user_id);

CREATE TABLE IF NOT EXISTS goals (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  procedure TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target BETWEEN 1 AND 999),
  PRIMARY KEY (user_id, procedure)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
