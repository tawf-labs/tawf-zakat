-- Schema snapshot before personal officer profiles, commit 0e2757a.
CREATE TABLE IF NOT EXISTS institutions (
     id TEXT PRIMARY KEY,
     legal_name TEXT NOT NULL,
     scope_unit TEXT NOT NULL,
     scope_level TEXT NOT NULL,
     mandate_note TEXT NOT NULL,
     is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
     created_at TIMESTAMP NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMP NOT NULL DEFAULT NOW()
   );
CREATE TABLE IF NOT EXISTS institution_memberships (
     id SERIAL PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     account_address TEXT NOT NULL,
     role TEXT NOT NULL,
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     created_at TIMESTAMP NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
     CONSTRAINT institution_memberships_pair_unique UNIQUE (institution_id, account_address),
     CONSTRAINT institution_memberships_role_known CHECK (role IN ('ADMIN', 'OFFICER', 'READER'))
   );
CREATE UNIQUE INDEX IF NOT EXISTS institution_memberships_one_active_per_account
     ON institution_memberships (account_address) WHERE is_active;
CREATE TABLE IF NOT EXISTS workspace_challenges (
     nonce TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     account_address TEXT NOT NULL,
     purpose TEXT NOT NULL,
     issued_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     consumed_at BIGINT
   );
CREATE TABLE IF NOT EXISTS workspace_sessions (
     token_hash TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL,
     account_address TEXT NOT NULL,
     role TEXT NOT NULL,
     issued_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     revoked_at BIGINT,
     CONSTRAINT workspace_sessions_membership_fk
       FOREIGN KEY (institution_id, account_address)
       REFERENCES institution_memberships (institution_id, account_address)
   );
CREATE TABLE IF NOT EXISTS workspace_authority_history (
     id SERIAL PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id),
     actor TEXT NOT NULL, account TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL,
     occurred_at BIGINT NOT NULL
   );
CREATE TABLE IF NOT EXISTS workspace_admin_proposals (
     institution_id TEXT PRIMARY KEY REFERENCES institutions(id),
     administrator TEXT NOT NULL, successor TEXT NOT NULL
   );
