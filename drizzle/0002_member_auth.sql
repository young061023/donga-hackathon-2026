CREATE TABLE accounts (
 user_id text PRIMARY KEY NOT NULL REFERENCES users(id),
 email text NOT NULL UNIQUE,
 password_hash text NOT NULL
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id),
 expires_at integer NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE auth_attempts (key text PRIMARY KEY NOT NULL, count integer NOT NULL, expires_at integer NOT NULL);
