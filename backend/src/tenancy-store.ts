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
import type {
  EndorsementAccountInput,
  InstitutionalEndorsementAccount,
  MandateInput,
  MandateScopeType,
  OperationalFunction,
  OperationalMandate,
} from "./operational-mandate";
import { isOperationalFunction } from "./operational-mandate";

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

export type OfficerProfileRecord = {
  id: string;
  institutionId: string;
  displayName: string;
  isActive: boolean;
};

export type OfficerWithAccounts = OfficerProfileRecord & {
  accounts: { account: string; role: WorkspaceRole; isActive: boolean }[];
};

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
  `CREATE TABLE IF NOT EXISTS officer_profiles (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     display_name TEXT NOT NULL,
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     created_at TIMESTAMP NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMP NOT NULL DEFAULT NOW()
   );`,
  `CREATE TABLE IF NOT EXISTS institution_memberships (
     id SERIAL PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     account_address TEXT NOT NULL,
     role TEXT NOT NULL,
     officer_id TEXT REFERENCES officer_profiles (id),
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     created_at TIMESTAMP NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
     CONSTRAINT institution_memberships_pair_unique UNIQUE (institution_id, account_address),
     CONSTRAINT institution_memberships_role_known CHECK (role IN ('ADMIN', 'OFFICER', 'READER'))
   );`,
  `ALTER TABLE institution_memberships ADD COLUMN IF NOT EXISTS officer_id TEXT REFERENCES officer_profiles (id);`,
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
  `ALTER TABLE workspace_authority_history ADD COLUMN IF NOT EXISTS details JSONB;`,
  `CREATE TABLE IF NOT EXISTS workspace_admin_proposals (
     institution_id TEXT PRIMARY KEY REFERENCES institutions(id),
     administrator TEXT NOT NULL, successor TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS operational_mandates (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     account_address TEXT,
     function TEXT NOT NULL,
     scope_type TEXT NOT NULL,
     program_id TEXT,
     valid_from BIGINT NOT NULL,
     valid_until BIGINT NOT NULL,
     assignment_ref TEXT NOT NULL,
     nominal_limit TEXT,
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL,
     created_by TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS institutional_endorsement_accounts (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     account_address TEXT NOT NULL,
     label TEXT NOT NULL,
     authorized_officer_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL,
     created_by TEXT NOT NULL,
     CONSTRAINT institutional_endorsement_unique UNIQUE (institution_id, account_address)
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

const mandateFromRow = (row: any): OperationalMandate => ({
  id: row.id,
  institutionId: row.institution_id,
  officerId: row.officer_id,
  accountAddress: row.account_address ?? null,
  function: row.function as OperationalFunction,
  scopeType: row.scope_type as MandateScopeType,
  programId: row.program_id ?? null,
  validFrom: asSeconds(row.valid_from),
  validUntil: asSeconds(row.valid_until),
  assignmentRef: row.assignment_ref,
  nominalLimit: row.nominal_limit ?? null,
  isActive: Boolean(row.is_active),
  createdAt: asSeconds(row.created_at),
  updatedAt: asSeconds(row.updated_at),
  createdBy: row.created_by,
});

const endorsementAccountFromRow = (row: any): InstitutionalEndorsementAccount => {
  let authorized: string[] = [];
  try {
    if (typeof row.authorized_officer_ids === "string") {
      authorized = JSON.parse(row.authorized_officer_ids);
    } else if (Array.isArray(row.authorized_officer_ids)) {
      authorized = row.authorized_officer_ids;
    }
  } catch {
    authorized = [];
  }
  return {
    id: row.id,
    institutionId: row.institution_id,
    accountAddress: row.account_address,
    label: row.label,
    authorizedOfficerIds: authorized,
    isActive: Boolean(row.is_active),
    createdAt: asSeconds(row.created_at),
    updatedAt: asSeconds(row.updated_at),
    createdBy: row.created_by,
  };
};

export class OfficerConflict extends Error {}
export class OfficerAuthorityChanged extends Error {}

export function createWorkspaceStore(db: WorkspaceDatabase & { transaction: <T>(work: (tx: WorkspaceDatabase) => Promise<T>) => Promise<T> }) {
  const one = async (query: any) => rowsOf(await db.execute(query))[0] ?? null;

  async function lockAdministrator(tx: WorkspaceDatabase, institutionId: string, actor: string) {
    await tx.execute(sql`SELECT id FROM institutions WHERE id = ${institutionId} FOR UPDATE`);
    const current = rowsOf(await tx.execute(sql`
      SELECT m.id FROM institution_memberships m LEFT JOIN officer_profiles o ON o.id = m.officer_id
      WHERE m.institution_id = ${institutionId} AND m.account_address = ${normalizeAccount(actor)}
        AND m.is_active AND m.role = 'ADMIN' AND (m.officer_id IS NULL OR o.is_active)
    `))[0];
    if (!current) throw new OfficerAuthorityChanged("Kewenangan administrator sudah berubah. Periksa kembali akses Anda.");
  }

  async function linkAccount(tx: WorkspaceDatabase, input: {
    officerId: string;
    institutionId: string;
    account: string;
    role: WorkspaceRole;
    actor: string;
    now: number;
  }): Promise<boolean> {
    const actor = normalizeAccount(input.actor);
    const account = normalizeAccount(input.account);

    const rows = rowsOf(await tx.execute(sql`
      SELECT id, is_active FROM officer_profiles
      WHERE id = ${input.officerId} AND institution_id = ${input.institutionId}
    `));
    const officer = rows[0] ?? null;
    if (!officer || !officer.is_active) return false;
    const previous = rowsOf(await tx.execute(sql`
      SELECT officer_id, role, is_active FROM institution_memberships
      WHERE institution_id = ${input.institutionId} AND account_address = ${account}
    `))[0];
    if (previous?.officer_id && previous.officer_id !== input.officerId) {
      throw new OfficerConflict("Akun sudah terkait identitas petugas lain. Gunakan akun kerja lain untuk menjaga atribusi historis.");
    }

    await tx.execute(sql`
      INSERT INTO institution_memberships (institution_id, account_address, role, officer_id, is_active)
      VALUES (${input.institutionId}, ${account}, ${input.role}, ${input.officerId}, TRUE)
      ON CONFLICT (institution_id, account_address) DO UPDATE SET
        role = CASE WHEN institution_memberships.role = 'ADMIN' THEN 'ADMIN' ELSE EXCLUDED.role END,
        officer_id = EXCLUDED.officer_id, is_active = TRUE, updated_at = NOW()
    `);

    await tx.execute(sql`
      INSERT INTO workspace_authority_history (institution_id, actor, account, role, action, occurred_at, details)
      VALUES (${input.institutionId}, ${actor}, ${account}, ${previous?.role === "ADMIN" ? "ADMIN" : input.role}, 'LINK_ACCOUNT', ${input.now},
        ${JSON.stringify({ officerId: input.officerId, previousOfficerId: previous?.officer_id ?? null })}::jsonb)
    `);

    return true;
  }

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
        SELECT m.institution_id, m.account_address, m.role, m.officer_id FROM institution_memberships m
        LEFT JOIN officer_profiles o ON o.id = m.officer_id
        WHERE m.account_address = ${normalizeAccount(account)} AND m.is_active
          AND (m.officer_id IS NULL OR o.is_active)
      `);
      if (!row) return null;
      return {
        institutionId: row.institution_id,
        account: row.account_address,
        role: asRole(row.role),
        isActive: true,
        ...(row.officer_id ? { officerId: row.officer_id } : {}),
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
      return rowsOf(await db.execute(sql`SELECT id, actor, account, role, action, details, occurred_at AS "occurredAt"
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
      { account: string; role: WorkspaceRole; officerId?: string | null; displayName?: string | null }[]
    > {
      const rows = rowsOf(
        await db.execute(sql`
          SELECT m.account_address, m.role, m.officer_id, o.display_name
          FROM institution_memberships m
          LEFT JOIN officer_profiles o ON m.officer_id = o.id
          WHERE m.institution_id = ${institutionId} AND m.is_active ORDER BY m.account_address ASC
        `)
      );
      return rows.map((row) => ({
        account: row.account_address,
        role: asRole(row.role),
        officerId: row.officer_id ?? null,
        displayName: row.display_name ?? null,
      }));
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

    async createOfficerProfile(input: {
      id?: string;
      account?: string;
      role?: WorkspaceRole;
      institutionId: string;
      displayName: string;
      actor: string;
      now: number;
    }): Promise<OfficerProfileRecord> {
      const name = input.displayName.trim();
      if (!name) throw new Error("Nama petugas tidak boleh kosong.");
      const id = input.id?.trim() || `off_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const actor = normalizeAccount(input.actor);

      return db.transaction(async (tx) => {
        await lockAdministrator(tx, input.institutionId, input.actor);
        const details = { displayName: name, account: input.account ? normalizeAccount(input.account) : null, role: input.role ?? "OFFICER" };
        const receipt = rowsOf(await tx.execute(sql`
          SELECT details FROM workspace_authority_history
          WHERE institution_id = ${input.institutionId} AND account = ${id} AND actor = ${actor} AND action = 'CREATE_OFFICER'
        `))[0];
        if (receipt) {
          if (receipt.details?.displayName !== details.displayName || receipt.details?.account !== details.account || receipt.details?.role !== details.role) {
            throw new OfficerConflict("Identitas operasi sudah dipakai dengan data berbeda.");
          }
          return { id, institutionId: input.institutionId, displayName: name, isActive: true };
        }
        if (rowsOf(await tx.execute(sql`SELECT id FROM officer_profiles WHERE id = ${id}`)).length) {
          throw new OfficerConflict("ID profil sudah digunakan. Gunakan identitas operasi baru.");
        }
        await tx.execute(sql`
          INSERT INTO officer_profiles (id, institution_id, display_name, is_active)
          VALUES (${id}, ${input.institutionId}, ${name}, TRUE)
        `);
        await tx.execute(sql`
          INSERT INTO workspace_authority_history (institution_id, actor, account, role, action, occurred_at, details)
          VALUES (${input.institutionId}, ${actor}, ${id}, 'OFFICER', 'CREATE_OFFICER', ${input.now}, ${JSON.stringify(details)}::jsonb)
        `);
        if (input.account) await linkAccount(tx, { ...input, officerId: id, account: input.account, role: input.role ?? "OFFICER" });
        return {
          id,
          institutionId: input.institutionId,
          displayName: name,
          isActive: true,
        };
      });
    },

    async updateOfficerProfile(input: {
      officerId: string;
      institutionId: string;
      displayName?: string;
      isActive?: boolean;
      actor: string;
      now: number;
    }): Promise<OfficerProfileRecord | null> {
      const actor = normalizeAccount(input.actor);
      return db.transaction(async (tx) => {
        await lockAdministrator(tx, input.institutionId, input.actor);
        const rows = rowsOf(await tx.execute(sql`
          SELECT id, institution_id, display_name, is_active FROM officer_profiles
          WHERE id = ${input.officerId} AND institution_id = ${input.institutionId}
        `));
        const existing = rows[0] ?? null;
        if (!existing) return null;

        const newName = input.displayName !== undefined ? input.displayName.trim() : existing.display_name;
        if (!newName) throw new Error("Nama petugas tidak boleh kosong.");
        const newActive = input.isActive !== undefined ? input.isActive : Boolean(existing.is_active);

        await tx.execute(sql`
          UPDATE officer_profiles
          SET display_name = ${newName}, is_active = ${newActive}, updated_at = NOW()
          WHERE id = ${input.officerId} AND institution_id = ${input.institutionId}
        `);

        if (!newActive) {
          const administrators = rowsOf(await tx.execute(sql`
            SELECT id FROM institution_memberships WHERE institution_id = ${input.institutionId}
              AND officer_id = ${input.officerId} AND role = 'ADMIN' AND is_active
          `));
          if (administrators.length) throw new OfficerConflict("Alihkan administrator kepada penerus sebelum menonaktifkan profil ini.");
          await tx.execute(sql`
            UPDATE workspace_sessions SET revoked_at = ${input.now}
            WHERE institution_id = ${input.institutionId} AND account_address IN (
              SELECT account_address FROM institution_memberships
              WHERE institution_id = ${input.institutionId} AND officer_id = ${input.officerId}
            ) AND revoked_at IS NULL
          `);
        }

        await tx.execute(sql`
          INSERT INTO workspace_authority_history (institution_id, actor, account, role, action, occurred_at, details)
          VALUES (${input.institutionId}, ${actor}, ${input.officerId}, 'OFFICER', 'UPDATE_OFFICER', ${input.now},
            ${JSON.stringify({ before: { displayName: existing.display_name, isActive: Boolean(existing.is_active) }, after: { displayName: newName, isActive: newActive } })}::jsonb)
        `);

        return {
          id: input.officerId,
          institutionId: input.institutionId,
          displayName: newName,
          isActive: newActive,
        };
      });
    },

    async linkOfficerAccount(input: Parameters<typeof linkAccount>[1]): Promise<boolean> {
      return db.transaction(async tx => {
        await lockAdministrator(tx, input.institutionId, input.actor);
        return linkAccount(tx, input);
      });
    },

    async unlinkOfficerAccount(input: {
      officerId: string;
      institutionId: string;
      account: string;
      actor: string;
      now: number;
    }): Promise<boolean> {
      const actor = normalizeAccount(input.actor);
      const account = normalizeAccount(input.account);

      return db.transaction(async (tx) => {
        await lockAdministrator(tx, input.institutionId, input.actor);
        const administrators = rowsOf(await tx.execute(sql`
          SELECT id FROM institution_memberships WHERE institution_id = ${input.institutionId}
            AND account_address = ${account} AND officer_id = ${input.officerId} AND role = 'ADMIN' AND is_active
        `));
        if (administrators.length) throw new OfficerConflict("Alihkan administrator kepada penerus sebelum melepas akun ini.");
        const rows = rowsOf(await tx.execute(sql`
          UPDATE institution_memberships
          SET is_active = FALSE, updated_at = NOW()
          WHERE institution_id = ${input.institutionId} AND account_address = ${account} AND officer_id = ${input.officerId}
          RETURNING id
        `));
        const updated = rows[0] ?? null;
        if (!updated) return false;

        await tx.execute(sql`
          UPDATE workspace_sessions SET revoked_at = ${input.now}
          WHERE institution_id = ${input.institutionId} AND account_address = ${account} AND revoked_at IS NULL
        `);

        await tx.execute(sql`
          INSERT INTO workspace_authority_history (institution_id, actor, account, role, action, occurred_at, details)
          VALUES (${input.institutionId}, ${actor}, ${account}, 'OFFICER', 'UNLINK_ACCOUNT', ${input.now},
            ${JSON.stringify({ officerId: input.officerId })}::jsonb)
        `);

        return true;
      });
    },

    async getOfficerForAccount(account: string, institutionId: string): Promise<OfficerProfileRecord | null> {
      const row = await one(sql`
        SELECT o.id, o.institution_id, o.display_name, o.is_active
        FROM institution_memberships m
        JOIN officer_profiles o ON m.officer_id = o.id
        WHERE m.account_address = ${normalizeAccount(account)}
          AND m.institution_id = ${institutionId}
          AND m.is_active
      `);
      if (!row) return null;
      return {
        id: row.id,
        institutionId: row.institution_id,
        displayName: row.display_name,
        isActive: Boolean(row.is_active),
      };
    },

    async listOfficers(institutionId: string): Promise<OfficerWithAccounts[]> {
      const officers = rowsOf(await db.execute(sql`
        SELECT id, institution_id, display_name, is_active
        FROM officer_profiles
        WHERE institution_id = ${institutionId}
        ORDER BY created_at ASC, id ASC
      `));

      const memberships = rowsOf(await db.execute(sql`
        SELECT account_address, role, is_active, officer_id
        FROM institution_memberships
        WHERE institution_id = ${institutionId} AND officer_id IS NOT NULL
        ORDER BY id ASC
      `));

      return officers.map((o) => {
        const linked = memberships
          .filter((m) => m.officer_id === o.id)
          .map((m) => ({
            account: m.account_address,
            role: asRole(m.role),
            isActive: Boolean(m.is_active),
          }));
        return {
          id: o.id,
          institutionId: o.institution_id,
          displayName: o.display_name,
          isActive: Boolean(o.is_active),
          accounts: linked,
        };
      });
    },

    async listMandates(
      institutionId: string,
      filter?: { officerId?: string; activeOnly?: boolean }
    ): Promise<OperationalMandate[]> {
      const rows = rowsOf(
        await db.execute(sql`
          SELECT * FROM operational_mandates
          WHERE institution_id = ${institutionId}
            ${filter?.officerId ? sql`AND officer_id = ${filter.officerId}` : sql``}
            ${filter?.activeOnly ? sql`AND is_active = TRUE` : sql``}
          ORDER BY created_at DESC, id ASC
        `)
      );
      return rows.map(mandateFromRow);
    },

    async getMandate(institutionId: string, id: string): Promise<OperationalMandate | null> {
      const row = await one(
        sql`SELECT * FROM operational_mandates WHERE institution_id = ${institutionId} AND id = ${id}`
      );
      return row ? mandateFromRow(row) : null;
    },

    async grantMandate(input: {
      id?: string;
      institutionId: string;
      actor: string;
      now: number;
      mandate: MandateInput;
    }): Promise<OperationalMandate> {
      return db.transaction(async (tx) => {
        await lockAdministrator(tx, input.institutionId, input.actor);

        const officerRows = rowsOf(
          await tx.execute(sql`
            SELECT id, is_active FROM officer_profiles
            WHERE id = ${input.mandate.officerId} AND institution_id = ${input.institutionId}
          `)
        );
        const officer = officerRows[0] ?? null;
        if (!officer) throw new OfficerConflict("Petugas tidak ditemukan pada lembaga ini.");
        if (!officer.is_active) throw new OfficerConflict("Tidak dapat memberikan mandat kepada petugas nonaktif.");

        const id = input.id || crypto.randomUUID();

        if (input.id) {
          const existing = rowsOf(
            await tx.execute(
              sql`SELECT * FROM operational_mandates WHERE id = ${input.id} AND institution_id = ${input.institutionId}`
            )
          )[0];
          if (existing) {
            const m = mandateFromRow(existing);
            if (
              m.officerId === input.mandate.officerId &&
              m.function === input.mandate.function &&
              m.assignmentRef === input.mandate.assignmentRef
            ) {
              return m;
            }
            throw new OfficerConflict("ID mandat sudah digunakan dengan konfigurasi berbeda.");
          }
        }

        const acc = input.mandate.accountAddress ? normalizeAccount(input.mandate.accountAddress) : null;
        await tx.execute(sql`
          INSERT INTO operational_mandates (
            id, institution_id, officer_id, account_address, function, scope_type,
            program_id, valid_from, valid_until, assignment_ref, nominal_limit,
            is_active, created_at, updated_at, created_by
          ) VALUES (
            ${id}, ${input.institutionId}, ${input.mandate.officerId}, ${acc},
            ${input.mandate.function}, ${input.mandate.scopeType}, ${input.mandate.programId ?? null},
            ${input.mandate.validFrom}, ${input.mandate.validUntil}, ${input.mandate.assignmentRef},
            ${input.mandate.nominalLimit ?? null}, TRUE, ${input.now}, ${input.now},
            ${normalizeAccount(input.actor)}
          )
        `);

        await tx.execute(sql`
          INSERT INTO workspace_authority_history (
            institution_id, actor, account, role, action, occurred_at, details
          ) VALUES (
            ${input.institutionId}, ${normalizeAccount(input.actor)}, ${normalizeAccount(input.actor)},
            'ADMIN', 'GRANT_MANDATE', ${input.now},
            ${JSON.stringify({
              mandateId: id,
              officerId: input.mandate.officerId,
              function: input.mandate.function,
              scopeType: input.mandate.scopeType,
              programId: input.mandate.programId ?? null,
              validFrom: input.mandate.validFrom,
              validUntil: input.mandate.validUntil,
              assignmentRef: input.mandate.assignmentRef,
              nominalLimit: input.mandate.nominalLimit ?? null,
            })}::jsonb
          )
        `);

        const created = rowsOf(
          await tx.execute(sql`SELECT * FROM operational_mandates WHERE id = ${id}`)
        )[0];
        return mandateFromRow(created);
      });
    },

    async updateMandate(input: {
      id: string;
      institutionId: string;
      actor: string;
      now: number;
      patch: {
        scopeType?: MandateScopeType;
        programId?: string | null;
        validFrom?: number;
        validUntil?: number;
        assignmentRef?: string;
        nominalLimit?: string | null;
        isActive?: boolean;
      };
    }): Promise<OperationalMandate | null> {
      return db.transaction(async (tx) => {
        await lockAdministrator(tx, input.institutionId, input.actor);

        const current = rowsOf(
          await tx.execute(
            sql`SELECT * FROM operational_mandates WHERE id = ${input.id} AND institution_id = ${input.institutionId}`
          )
        )[0];
        if (!current) return null;

        const before = mandateFromRow(current);
        const scopeType = input.patch.scopeType ?? before.scopeType;
        const programId =
          input.patch.scopeType === "ALL_PROGRAMS"
            ? null
            : input.patch.programId !== undefined
            ? input.patch.programId
            : before.programId;
        const validFrom = input.patch.validFrom ?? before.validFrom;
        const validUntil = input.patch.validUntil ?? before.validUntil;
        const assignmentRef = input.patch.assignmentRef ?? before.assignmentRef;
        const nominalLimit =
          input.patch.nominalLimit !== undefined ? input.patch.nominalLimit : before.nominalLimit;
        const isActive = input.patch.isActive !== undefined ? input.patch.isActive : before.isActive;

        await tx.execute(sql`
          UPDATE operational_mandates SET
            scope_type = ${scopeType},
            program_id = ${programId},
            valid_from = ${validFrom},
            valid_until = ${validUntil},
            assignment_ref = ${assignmentRef},
            nominal_limit = ${nominalLimit},
            is_active = ${isActive},
            updated_at = ${input.now}
          WHERE id = ${input.id} AND institution_id = ${input.institutionId}
        `);

        await tx.execute(sql`
          INSERT INTO workspace_authority_history (
            institution_id, actor, account, role, action, occurred_at, details
          ) VALUES (
            ${input.institutionId}, ${normalizeAccount(input.actor)}, ${normalizeAccount(input.actor)},
            'ADMIN', 'UPDATE_MANDATE', ${input.now},
            ${JSON.stringify({
              mandateId: input.id,
              before: {
                scopeType: before.scopeType,
                programId: before.programId,
                validFrom: before.validFrom,
                validUntil: before.validUntil,
                assignmentRef: before.assignmentRef,
                nominalLimit: before.nominalLimit,
                isActive: before.isActive,
              },
              after: {
                scopeType,
                programId,
                validFrom,
                validUntil,
                assignmentRef,
                nominalLimit,
                isActive,
              },
            })}::jsonb
          )
        `);

        const updated = rowsOf(
          await tx.execute(sql`SELECT * FROM operational_mandates WHERE id = ${input.id}`)
        )[0];
        return mandateFromRow(updated);
      });
    },

    async revokeMandate(input: {
      id: string;
      institutionId: string;
      actor: string;
      now: number;
    }): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockAdministrator(tx, input.institutionId, input.actor);

        const current = rowsOf(
          await tx.execute(
            sql`SELECT * FROM operational_mandates WHERE id = ${input.id} AND institution_id = ${input.institutionId}`
          )
        )[0];
        if (!current) return false;

        await tx.execute(sql`
          UPDATE operational_mandates SET
            is_active = FALSE,
            updated_at = ${input.now}
          WHERE id = ${input.id} AND institution_id = ${input.institutionId}
        `);

        await tx.execute(sql`
          INSERT INTO workspace_authority_history (
            institution_id, actor, account, role, action, occurred_at, details
          ) VALUES (
            ${input.institutionId}, ${normalizeAccount(input.actor)}, ${normalizeAccount(input.actor)},
            'ADMIN', 'REVOKE_MANDATE', ${input.now},
            ${JSON.stringify({ mandateId: input.id })}::jsonb
          )
        `);

        return true;
      });
    },

    async activeMandatesForOfficer(
      institutionId: string,
      officerId: string,
      now: number
    ): Promise<OperationalMandate[]> {
      const rows = rowsOf(
        await db.execute(sql`
          SELECT m.* FROM operational_mandates m
          JOIN officer_profiles o ON o.id = m.officer_id
          WHERE m.institution_id = ${institutionId}
            AND m.officer_id = ${officerId}
            AND m.is_active = TRUE
            AND o.is_active = TRUE
            AND m.valid_from <= ${now}
            AND m.valid_until >= ${now}
          ORDER BY m.created_at ASC
        `)
      );
      return rows.map(mandateFromRow);
    },

    async activeMandatesForAccount(
      institutionId: string,
      account: string,
      now: number
    ): Promise<OperationalMandate[]> {
      const normalized = normalizeAccount(account);
      const member = rowsOf(
        await db.execute(sql`
          SELECT officer_id FROM institution_memberships
          WHERE institution_id = ${institutionId}
            AND account_address = ${normalized}
            AND is_active = TRUE
        `)
      )[0];
      if (!member?.officer_id) return [];

      const rows = rowsOf(
        await db.execute(sql`
          SELECT m.* FROM operational_mandates m
          JOIN officer_profiles o ON o.id = m.officer_id
          WHERE m.institution_id = ${institutionId}
            AND m.officer_id = ${member.officer_id}
            AND m.is_active = TRUE
            AND o.is_active = TRUE
            AND m.valid_from <= ${now}
            AND m.valid_until >= ${now}
            AND (m.account_address IS NULL OR m.account_address = ${normalized})
          ORDER BY m.created_at ASC
        `)
      );
      return rows.map(mandateFromRow);
    },

    async listEndorsementAccounts(
      institutionId: string,
      activeOnly?: boolean
    ): Promise<InstitutionalEndorsementAccount[]> {
      const rows = rowsOf(
        await db.execute(sql`
          SELECT * FROM institutional_endorsement_accounts
          WHERE institution_id = ${institutionId}
            ${activeOnly ? sql`AND is_active = TRUE` : sql``}
          ORDER BY created_at ASC
        `)
      );
      return rows.map(endorsementAccountFromRow);
    },

    async getEndorsementAccount(
      institutionId: string,
      id: string
    ): Promise<InstitutionalEndorsementAccount | null> {
      const row = await one(
        sql`SELECT * FROM institutional_endorsement_accounts WHERE institution_id = ${institutionId} AND id = ${id}`
      );
      return row ? endorsementAccountFromRow(row) : null;
    },

    async registerEndorsementAccount(input: {
      id?: string;
      institutionId: string;
      actor: string;
      now: number;
      data: EndorsementAccountInput;
    }): Promise<InstitutionalEndorsementAccount> {
      return db.transaction(async (tx) => {
        await lockAdministrator(tx, input.institutionId, input.actor);

        const acc = normalizeAccount(input.data.accountAddress);
        const existing = rowsOf(
          await tx.execute(
            sql`SELECT * FROM institutional_endorsement_accounts WHERE institution_id = ${input.institutionId} AND account_address = ${acc}`
          )
        )[0];

        const id = input.id || crypto.randomUUID();
        const authorizedJson = JSON.stringify(input.data.authorizedOfficerIds || []);

        if (existing) {
          if (existing.is_active) {
            if (existing.label === input.data.label) {
              return endorsementAccountFromRow(existing);
            }
            throw new OfficerConflict("Akun pengesahan ini sudah terdaftar pada lembaga ini.");
          }
          await tx.execute(sql`
            UPDATE institutional_endorsement_accounts SET
              label = ${input.data.label},
              authorized_officer_ids = ${authorizedJson}::jsonb,
              is_active = TRUE,
              updated_at = ${input.now}
            WHERE id = ${existing.id}
          `);
          await tx.execute(sql`
            INSERT INTO workspace_authority_history (
              institution_id, actor, account, role, action, occurred_at, details
            ) VALUES (
              ${input.institutionId}, ${normalizeAccount(input.actor)}, ${acc},
              'ADMIN', 'REGISTER_ENDORSEMENT_ACCOUNT', ${input.now},
              ${JSON.stringify({ id: existing.id, account: acc, reactivated: true })}::jsonb
            )
          `);
          const row = rowsOf(
            await tx.execute(
              sql`SELECT * FROM institutional_endorsement_accounts WHERE id = ${existing.id}`
            )
          )[0];
          return endorsementAccountFromRow(row);
        }

        await tx.execute(sql`
          INSERT INTO institutional_endorsement_accounts (
            id, institution_id, account_address, label, authorized_officer_ids,
            is_active, created_at, updated_at, created_by
          ) VALUES (
            ${id}, ${input.institutionId}, ${acc}, ${input.data.label},
            ${authorizedJson}::jsonb, TRUE, ${input.now}, ${input.now},
            ${normalizeAccount(input.actor)}
          )
        `);

        await tx.execute(sql`
          INSERT INTO workspace_authority_history (
            institution_id, actor, account, role, action, occurred_at, details
          ) VALUES (
            ${input.institutionId}, ${normalizeAccount(input.actor)}, ${acc},
            'ADMIN', 'REGISTER_ENDORSEMENT_ACCOUNT', ${input.now},
            ${JSON.stringify({ id, account: acc, label: input.data.label })}::jsonb
          )
        `);

        const created = rowsOf(
          await tx.execute(
            sql`SELECT * FROM institutional_endorsement_accounts WHERE id = ${id}`
          )
        )[0];
        return endorsementAccountFromRow(created);
      });
    },

    async updateEndorsementAccount(input: {
      id: string;
      institutionId: string;
      actor: string;
      now: number;
      patch: {
        label?: string;
        authorizedOfficerIds?: string[];
        isActive?: boolean;
      };
    }): Promise<InstitutionalEndorsementAccount | null> {
      return db.transaction(async (tx) => {
        await lockAdministrator(tx, input.institutionId, input.actor);

        const current = rowsOf(
          await tx.execute(
            sql`SELECT * FROM institutional_endorsement_accounts WHERE id = ${input.id} AND institution_id = ${input.institutionId}`
          )
        )[0];
        if (!current) return null;

        const before = endorsementAccountFromRow(current);
        const label = input.patch.label ?? before.label;
        const authorized = input.patch.authorizedOfficerIds ?? before.authorizedOfficerIds;
        const isActive = input.patch.isActive !== undefined ? input.patch.isActive : before.isActive;

        await tx.execute(sql`
          UPDATE institutional_endorsement_accounts SET
            label = ${label},
            authorized_officer_ids = ${JSON.stringify(authorized)}::jsonb,
            is_active = ${isActive},
            updated_at = ${input.now}
          WHERE id = ${input.id} AND institution_id = ${input.institutionId}
        `);

        await tx.execute(sql`
          INSERT INTO workspace_authority_history (
            institution_id, actor, account, role, action, occurred_at, details
          ) VALUES (
            ${input.institutionId}, ${normalizeAccount(input.actor)}, ${before.accountAddress},
            'ADMIN', 'UPDATE_ENDORSEMENT_ACCOUNT', ${input.now},
            ${JSON.stringify({
              id: input.id,
              before: { label: before.label, authorized: before.authorizedOfficerIds, isActive: before.isActive },
              after: { label, authorized, isActive },
            })}::jsonb
          )
        `);

        const updated = rowsOf(
          await tx.execute(
            sql`SELECT * FROM institutional_endorsement_accounts WHERE id = ${input.id}`
          )
        )[0];
        return endorsementAccountFromRow(updated);
      });
    },

    async revokeEndorsementAccount(input: {
      id: string;
      institutionId: string;
      actor: string;
      now: number;
    }): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockAdministrator(tx, input.institutionId, input.actor);

        const current = rowsOf(
          await tx.execute(
            sql`SELECT * FROM institutional_endorsement_accounts WHERE id = ${input.id} AND institution_id = ${input.institutionId}`
          )
        )[0];
        if (!current) return false;

        await tx.execute(sql`
          UPDATE institutional_endorsement_accounts SET
            is_active = FALSE,
            updated_at = ${input.now}
          WHERE id = ${input.id} AND institution_id = ${input.institutionId}
        `);

        await tx.execute(sql`
          INSERT INTO workspace_authority_history (
            institution_id, actor, account, role, action, occurred_at, details
          ) VALUES (
            ${input.institutionId}, ${normalizeAccount(input.actor)}, ${current.account_address},
            'ADMIN', 'REVOKE_ENDORSEMENT_ACCOUNT', ${input.now},
            ${JSON.stringify({ id: input.id, account: current.account_address })}::jsonb
          )
        `);

        return true;
      });
    },

    async activeEndorsementAccountsForOfficer(
      institutionId: string,
      officerId: string
    ): Promise<InstitutionalEndorsementAccount[]> {
      const all = await this.listEndorsementAccounts(institutionId, true);
      return all.filter(
        (ea) =>
          ea.authorizedOfficerIds.length === 0 ||
          ea.authorizedOfficerIds.includes(officerId)
      );
    },
  };
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
