/**
 * Where workspace tenancy is kept (Spec #68, ticket #69).
 *
 * The rules live in `./tenancy`, which is pure. This module is the adapter that
 * makes them durable, and it is deliberately thin: it holds no policy the pure
 * core does not already state, so nothing can be enforced here and forgotten
 * there, or the reverse.
 *
 * What it does own is the part a pure function cannot express - the constraints
 * the database itself refuses to break:
 *
 * - A membership must name an institution that exists.
 * - One account is active in at most one institution, enforced by a partial
 *   unique index rather than by a check some future caller might skip.
 * - A session may only exist for a real `(institution, account)` membership
 *   pair, enforced by a composite foreign key. Cross-institution access is
 *   therefore not merely refused by a route; it cannot be stored.
 * - A challenge is spent by a single conditional `UPDATE`, so two requests
 *   racing for the same nonce cannot both win.
 *
 * The schema is **additive**. It creates its own tables and alters none that
 * already exist, and no step here adopts historical rows into a tenant: a
 * donation recorded before institutions existed belongs to no institution, and
 * saying otherwise would be inventing provenance.
 *
 * Written against Drizzle's driver-agnostic `execute`, so the same statements
 * run on the deployed PostgreSQL and on the PGlite database the tests isolate.
 */

import { sql } from "drizzle-orm";
import type { AccessChallenge, Membership, WorkspaceRole } from "./tenancy";
import { isWorkspaceRole, normalizeAccount } from "./tenancy";

/** Any Drizzle PostgreSQL handle: `postgres-js` in production, PGlite in tests. */
export type WorkspaceDatabase = {
  execute: (query: any) => Promise<any>;
};

export type InstitutionRecord = {
  id: string;
  legalName: string;
  scopeUnit: string;
  scopeLevel: string;
  mandateNote: string;
  isSynthetic: boolean;
};

export type SessionRecord = {
  institutionId: string;
  account: string;
  role: WorkspaceRole;
  expiresAt: number;
};

/**
 * A stored challenge, with the purpose exactly as it was written. The purpose is
 * read back rather than assumed, so a row minted by something else cannot be
 * treated as a workspace sign-in.
 */
export type StoredChallenge = { challenge: AccessChallenge; purpose: string };

export type ChallengeConsumption =
  | { outcome: "consumed"; challenge: AccessChallenge }
  | { outcome: "already-consumed" }
  | { outcome: "unknown" };

/**
 * The dev migration, as one ordered list. Every statement is `IF NOT EXISTS`,
 * so running it twice is a no-op and running it against a deployment that
 * already has these tables changes nothing.
 */
export const WORKSPACE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS institutions (
     id TEXT PRIMARY KEY,
     legal_name TEXT NOT NULL,
     scope_unit TEXT NOT NULL,
     scope_level TEXT NOT NULL,
     mandate_note TEXT NOT NULL,
     is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
     created_at TIMESTAMP NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMP NOT NULL DEFAULT NOW()
   );`,
  `CREATE TABLE IF NOT EXISTS institution_memberships (
     id SERIAL PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     account_address TEXT NOT NULL,
     role TEXT NOT NULL,
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     created_at TIMESTAMP NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
     CONSTRAINT institution_memberships_pair_unique UNIQUE (institution_id, account_address),
     CONSTRAINT institution_memberships_role_known CHECK (role IN ('ADMIN', 'OFFICER', 'READER'))
   );`,
  // One active institution per account. A deactivated row stays for the record.
  `CREATE UNIQUE INDEX IF NOT EXISTS institution_memberships_one_active_per_account
     ON institution_memberships (account_address) WHERE is_active;`,
  `CREATE TABLE IF NOT EXISTS workspace_challenges (
     nonce TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     account_address TEXT NOT NULL,
     purpose TEXT NOT NULL,
     issued_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     consumed_at BIGINT
   );`,
  `CREATE TABLE IF NOT EXISTS workspace_sessions (
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
   );`,
  `CREATE TABLE IF NOT EXISTS workspace_authority_history (
     id SERIAL PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id),
     actor TEXT NOT NULL, account TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL,
     occurred_at BIGINT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS workspace_admin_proposals (
     institution_id TEXT PRIMARY KEY REFERENCES institutions(id),
     administrator TEXT NOT NULL, successor TEXT NOT NULL
   );`,
] as const;

const rowsOf = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

/** Unix seconds cross the driver boundary as `BIGINT`; bring them back as numbers. */
const asSeconds = (value: unknown): number => Number(value);

const institutionFrom = (row: any): InstitutionRecord => ({
  id: row.id,
  legalName: row.legal_name,
  scopeUnit: row.scope_unit,
  scopeLevel: row.scope_level,
  mandateNote: row.mandate_note,
  isSynthetic: Boolean(row.is_synthetic),
});

const challengeFrom = (row: any): StoredChallenge => ({
  purpose: row.purpose,
  challenge: {
    // Cast, not trust: the stored string is returned unchanged as `purpose`
    // above so a caller can check it really is the purpose this app mints.
    purpose: row.purpose as AccessChallenge["purpose"],
    institutionId: row.institution_id,
    account: row.account_address,
    nonce: row.nonce,
    issuedAt: asSeconds(row.issued_at),
    expiresAt: asSeconds(row.expires_at),
  },
});

const asRole = (value: unknown): WorkspaceRole => {
  if (!isWorkspaceRole(value)) throw new Error(`Peran ruang kerja tidak dikenal: ${String(value)}`);
  return value;
};

export function createWorkspaceStore(db: WorkspaceDatabase & { transaction: <T>(work: (tx: WorkspaceDatabase) => Promise<T>) => Promise<T> }) {
  const one = async (query: any) => rowsOf(await db.execute(query))[0] ?? null;

  return {
    async ensureSchema(): Promise<void> {
      for (const statement of WORKSPACE_SCHEMA_STATEMENTS) {
        await db.execute(sql.raw(statement));
      }
    },

    async upsertInstitution(record: InstitutionRecord): Promise<void> {
      await db.execute(sql`
        INSERT INTO institutions (id, legal_name, scope_unit, scope_level, mandate_note, is_synthetic)
        VALUES (${record.id}, ${record.legalName}, ${record.scopeUnit}, ${record.scopeLevel},
                ${record.mandateNote}, ${record.isSynthetic})
        ON CONFLICT (id) DO UPDATE SET
          legal_name = EXCLUDED.legal_name, scope_unit = EXCLUDED.scope_unit,
          scope_level = EXCLUDED.scope_level, mandate_note = EXCLUDED.mandate_note,
          is_synthetic = EXCLUDED.is_synthetic, updated_at = NOW()
      `);
    },

    async getInstitution(id: string): Promise<InstitutionRecord | null> {
      const row = await one(sql`SELECT * FROM institutions WHERE id = ${id}`);
      return row ? institutionFrom(row) : null;
    },

    async upsertMembership(input: {
      institutionId: string;
      account: string;
      role: WorkspaceRole;
    }): Promise<void> {
      await db.execute(sql`
        INSERT INTO institution_memberships (institution_id, account_address, role)
        VALUES (${input.institutionId}, ${normalizeAccount(input.account)}, ${asRole(input.role)})
        ON CONFLICT (institution_id, account_address) DO UPDATE SET
          role = EXCLUDED.role, is_active = TRUE, updated_at = NOW()
      `);
    },

    async deactivateMembership(input: { institutionId: string; account: string }): Promise<void> {
      await db.execute(sql`
        WITH deactivated AS (
          UPDATE institution_memberships SET is_active = FALSE, updated_at = NOW()
          WHERE institution_id = ${input.institutionId} AND account_address = ${normalizeAccount(input.account)}
          RETURNING institution_id, account_address
        )
        UPDATE workspace_sessions s SET revoked_at = COALESCE(s.revoked_at, EXTRACT(EPOCH FROM NOW())::bigint)
        FROM deactivated m WHERE s.institution_id = m.institution_id AND s.account_address = m.account_address
      `);
    },

    async activeMembershipFor(account: string): Promise<Membership | null> {
      const row = await one(sql`
        SELECT institution_id, account_address, role FROM institution_memberships
        WHERE account_address = ${normalizeAccount(account)} AND is_active
      `);
      if (!row) return null;
      return {
        institutionId: row.institution_id,
        account: row.account_address,
        role: asRole(row.role),
        isActive: true,
      };
    },

    async membershipHistoryFor(account: string): Promise<
      { institutionId: string; role: WorkspaceRole; isActive: boolean }[]
    > {
      const rows = rowsOf(
        await db.execute(sql`
          SELECT institution_id, role, is_active FROM institution_memberships
          WHERE account_address = ${normalizeAccount(account)} ORDER BY id ASC
        `)
      );
      return rows.map((row) => ({
        institutionId: row.institution_id,
        role: asRole(row.role),
        isActive: Boolean(row.is_active),
      }));
    },

    async manageMember(institutionId: string, actorInput: string, accountInput: string, role: "OFFICER" | "READER", now: number) {
      const actor = normalizeAccount(actorInput), account = normalizeAccount(accountInput);
      return db.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM institutions WHERE id = ${institutionId} FOR UPDATE`);
        const rows = rowsOf(await tx.execute(sql`
          SELECT account_address, role FROM institution_memberships
          WHERE institution_id = ${institutionId} AND is_active AND account_address IN (${actor}, ${account})
        `));
        if (!rows.some(row => row.account_address === actor && row.role === "ADMIN")
          || rows.some(row => row.account_address === account && row.role === "ADMIN")) return false;
        await tx.execute(sql`INSERT INTO institution_memberships (institution_id, account_address, role)
          VALUES (${institutionId}, ${account}, ${role}) ON CONFLICT (institution_id, account_address)
          DO UPDATE SET role = EXCLUDED.role, is_active = TRUE, updated_at = NOW()`);
        await tx.execute(sql`INSERT INTO workspace_authority_history (institution_id, actor, account, role, action, occurred_at)
          VALUES (${institutionId}, ${actor}, ${account}, ${role}, 'GRANT', ${now})`);
        return true;
      });
    },
    async authorityHistory(institutionId: string) {
      return rowsOf(await db.execute(sql`SELECT id, actor, account, role, action, occurred_at AS "occurredAt"
        FROM workspace_authority_history WHERE institution_id = ${institutionId} ORDER BY id`));
    },
    async administratorProposal(institutionId: string) {
      return await one(sql`SELECT administrator, successor FROM workspace_admin_proposals WHERE institution_id = ${institutionId}`);
    },
    /** One SQL statement locks the institution, changes membership and appends its receipt atomically. */
    async changeMembership(institutionId: string, actorInput: string, accountInput: string, action: "REVOKE" | "PROPOSE" | "ACCEPT", now: number) {
      const actor = normalizeAccount(actorInput), account = normalizeAccount(accountInput);
      return db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM institutions WHERE id = ${institutionId} FOR UPDATE`);
      const result = rowsOf(await tx.execute(sql`
        WITH locked AS MATERIALIZED (SELECT id FROM institutions WHERE id = ${institutionId} FOR UPDATE),
        eligible AS MATERIALIZED (
          SELECT m.* FROM institution_memberships m, locked
          WHERE m.institution_id = locked.id AND m.account_address = ${actor} AND m.is_active
            AND (${action} = 'ACCEPT' OR m.role = 'ADMIN')
        ), target AS MATERIALIZED (
          SELECT m.* FROM institution_memberships m, eligible e
          WHERE m.institution_id = e.institution_id AND m.account_address = ${account} AND m.is_active
            AND m.role <> 'ADMIN'
        ), proposal AS (
          INSERT INTO workspace_admin_proposals (institution_id, administrator, successor)
          SELECT institution_id, ${actor}, account_address FROM target WHERE ${action} = 'PROPOSE'
          ON CONFLICT (institution_id) DO UPDATE SET administrator = EXCLUDED.administrator, successor = EXCLUDED.successor
          RETURNING institution_id
        ), accepted AS (
          DELETE FROM workspace_admin_proposals p USING eligible e
          WHERE ${action} = 'ACCEPT' AND p.institution_id = e.institution_id AND p.successor = ${actor}
            AND EXISTS (SELECT 1 FROM institution_memberships a WHERE a.institution_id = p.institution_id
              AND a.account_address = p.administrator AND a.role = 'ADMIN' AND a.is_active)
          RETURNING p.*
        ), changed AS (
          UPDATE institution_memberships m SET
            is_active = CASE WHEN ${action} = 'REVOKE' THEN FALSE ELSE TRUE END,
            role = CASE WHEN ${action} = 'ACCEPT' THEN CASE WHEN m.account_address = ${actor} THEN 'ADMIN' ELSE 'READER' END ELSE m.role END,
            updated_at = NOW()
          WHERE (${action} = 'REVOKE' AND m.id IN (SELECT id FROM target))
             OR (${action} = 'ACCEPT' AND EXISTS (SELECT 1 FROM accepted a WHERE a.institution_id = m.institution_id
               AND m.account_address IN (a.administrator, a.successor)))
          RETURNING m.account_address, m.role
        ), cancelled AS (
          DELETE FROM workspace_admin_proposals WHERE ${action} = 'REVOKE' AND institution_id = ${institutionId}
            AND successor IN (SELECT account_address FROM changed) RETURNING institution_id
        ), sessions AS (
          UPDATE workspace_sessions SET revoked_at = ${now}
          WHERE institution_id = ${institutionId} AND account_address IN (SELECT account_address FROM changed)
          RETURNING token_hash
        ), history AS (
          INSERT INTO workspace_authority_history (institution_id, actor, account, role, action, occurred_at)
          SELECT ${institutionId}, ${actor}, account_address, role, ${action}, ${now}::bigint FROM changed
          UNION ALL SELECT ${institutionId}, ${actor}, ${account}, 'ADMIN', 'PROPOSE', ${now}::bigint FROM proposal
          RETURNING id
        ) SELECT COUNT(*)::int AS count FROM history
      `))[0];
      return result.count > 0;
      });
    },

    async listInstitutions(): Promise<InstitutionRecord[]> {
      const rows = rowsOf(await db.execute(sql`SELECT * FROM institutions ORDER BY id ASC`));
      return rows.map(institutionFrom);
    },

    async membersOf(institutionId: string): Promise<
      { account: string; role: WorkspaceRole }[]
    > {
      const rows = rowsOf(
        await db.execute(sql`
          SELECT account_address, role FROM institution_memberships
          WHERE institution_id = ${institutionId} AND is_active ORDER BY account_address ASC
        `)
      );
      return rows.map((row) => ({ account: row.account_address, role: asRole(row.role) }));
    },

    async saveChallenge(challenge: AccessChallenge): Promise<void> {
      await db.execute(sql`
        INSERT INTO workspace_challenges (nonce, institution_id, account_address, purpose, issued_at, expires_at)
        VALUES (${challenge.nonce}, ${challenge.institutionId}, ${challenge.account},
                ${challenge.purpose}, ${challenge.issuedAt}, ${challenge.expiresAt})
      `);
    },

    /**
     * Reads a challenge without spending it, so a signature can be judged before
     * a nonce is burned. Anyone can guess at a nonce; only the account that owns
     * one can sign it, and burning on a failed attempt would hand a stranger a
     * way to lock a legitimate officer out of their own challenge.
     */
    async readChallenge(nonce: string): Promise<(StoredChallenge & { consumed: boolean }) | null> {
      const row = await one(sql`
        SELECT nonce, institution_id, account_address, purpose, issued_at, expires_at, consumed_at
        FROM workspace_challenges WHERE nonce = ${nonce.toLowerCase()}
      `);
      if (!row) return null;
      return { ...challengeFrom(row), consumed: row.consumed_at !== null };
    },

    /**
     * Spends a challenge. The conditional `UPDATE` is the whole single-use
     * defence: a second request for the same nonce updates no row, whether it
     * arrives a second later or at the same instant on another connection.
     */
    async consumeChallenge(nonce: string, now: number): Promise<ChallengeConsumption> {
      const claimed = await one(sql`
        UPDATE workspace_challenges SET consumed_at = ${now}
        WHERE nonce = ${nonce.toLowerCase()} AND consumed_at IS NULL
        RETURNING nonce, institution_id, account_address, purpose, issued_at, expires_at
      `);

      if (claimed) return { outcome: "consumed", challenge: challengeFrom(claimed).challenge };

      const existing = await one(sql`SELECT nonce FROM workspace_challenges WHERE nonce = ${nonce.toLowerCase()}`);
      return existing ? { outcome: "already-consumed" } : { outcome: "unknown" };
    },

    async createSession(input: {
      tokenHash: string;
      institutionId: string;
      account: string;
      role: WorkspaceRole;
      issuedAt: number;
      expiresAt: number;
    }): Promise<void> {
      await db.execute(sql`
        INSERT INTO workspace_sessions (token_hash, institution_id, account_address, role, issued_at, expires_at)
        VALUES (${input.tokenHash}, ${input.institutionId}, ${normalizeAccount(input.account)},
                ${asRole(input.role)}, ${input.issuedAt}, ${input.expiresAt})
      `);
    },

    async sessionFor(tokenHash: string, now: number): Promise<SessionRecord | null> {
      const row = await one(sql`
        SELECT institution_id, account_address, role, expires_at FROM workspace_sessions
        WHERE token_hash = ${tokenHash} AND revoked_at IS NULL AND expires_at >= ${now}
      `);
      if (!row) return null;
      return {
        institutionId: row.institution_id,
        account: row.account_address,
        role: asRole(row.role),
        expiresAt: asSeconds(row.expires_at),
      };
    },

    /** Only the supplied token is classified; membership/revocation outranks expiry. */
    async sessionStateFor(tokenHash: string, now: number): Promise<
      { state: "ACTIVE"; session: SessionRecord } | { state: "EXPIRED" | "REVOKED" | "UNKNOWN" }
    > {
      const row = await one(sql`
        SELECT s.institution_id, s.account_address, s.role, s.expires_at, s.revoked_at, m.is_active
        FROM workspace_sessions s LEFT JOIN institution_memberships m
          ON m.institution_id = s.institution_id AND m.account_address = s.account_address
        WHERE s.token_hash = ${tokenHash}
      `);
      if (!row) return { state: "UNKNOWN" };
      if (row.revoked_at !== null || !row.is_active) return { state: "REVOKED" };
      if (asSeconds(row.expires_at) < now) return { state: "EXPIRED" };
      return { state: "ACTIVE", session: { institutionId: row.institution_id, account: row.account_address,
        role: asRole(row.role), expiresAt: asSeconds(row.expires_at) } };
    },

    async revokeSession(tokenHash: string, now: number): Promise<void> {
      await db.execute(sql`
        UPDATE workspace_sessions SET revoked_at = ${now}
        WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
      `);
    },


  };
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
