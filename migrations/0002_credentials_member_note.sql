-- ログインID/パスワード、メンバーの備考
ALTER TABLE members ADD COLUMN login_id TEXT;
ALTER TABLE members ADD COLUMN password_hash TEXT;
ALTER TABLE members ADD COLUMN note TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_login ON members(login_id) WHERE login_id IS NOT NULL;
