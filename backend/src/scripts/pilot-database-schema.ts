/** Blank-database baseline, transcribed from the seven legacy tables in db/schema.ts.
 * Never an upgrade/migration and never drizzle push; domain tables use store DDL.
 */
export const PILOT_LEGACY_SCHEMA = [
  `CREATE TABLE merkle_batches (
    id SERIAL PRIMARY KEY, batch_number INTEGER NOT NULL UNIQUE, merkle_root TEXT NOT NULL,
    total_amount_idr BIGINT NOT NULL, item_count INTEGER, tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending', settled_at TIMESTAMP DEFAULT now())`,
  `CREATE TABLE donations (
    id SERIAL PRIMARY KEY, trx_id TEXT NOT NULL UNIQUE, donor_name TEXT NOT NULL,
    is_anonymous BOOLEAN NOT NULL DEFAULT false, amount_idr BIGINT NOT NULL, salt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', payment_method TEXT NOT NULL DEFAULT 'QRIS',
    qr_string TEXT, qr_url TEXT, batch_id INTEGER, created_at TIMESTAMP DEFAULT now(), paid_at TIMESTAMP,
    amount_usdc_6dp TEXT, deposit_chain_id INTEGER, deposit_contract TEXT, deposit_tx_hash TEXT, deposit_log_index INTEGER)`,
  `CREATE TABLE disbursement_proposals (
    id SERIAL PRIMARY KEY, proposal_id_on_chain INTEGER NOT NULL UNIQUE,
    currency_type INTEGER NOT NULL DEFAULT 0, amount BIGINT NOT NULL, amount_exact TEXT,
    asnaf_category TEXT NOT NULL, beneficiary_name TEXT NOT NULL, beneficiary_nik_masked TEXT NOT NULL,
    beneficiary_hash TEXT NOT NULL, ipfs_proof_cid TEXT NOT NULL, disbursement_receipt_cid TEXT,
    period_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', cancel_reason TEXT,
    approval_count INTEGER NOT NULL DEFAULT 1, approved_by TEXT NOT NULL DEFAULT '["Amil Internal"]',
    tx_hash TEXT, audit_status TEXT NOT NULL DEFAULT 'PENDING', auditor_address TEXT, auditor_name TEXT,
    audit_report_cid TEXT, audit_opinion TEXT, audit_notes TEXT, audited_at TIMESTAMP, audit_tx_hash TEXT,
    lai_document_cid TEXT, financial_statements_cid TEXT, safe_status TEXT DEFAULT 'IDLE',
    safe_confirmations_count INTEGER DEFAULT 0, safe_confirmations_required INTEGER DEFAULT 2,
    created_at TIMESTAMP DEFAULT now(), executed_at TIMESTAMP)`,
  `CREATE TABLE indexer_state (
    id SERIAL PRIMARY KEY, indexer_key TEXT NOT NULL UNIQUE DEFAULT 'sepolia_zakat_l1',
    last_indexed_block INTEGER NOT NULL DEFAULT 11569000, last_sync_at TIMESTAMP DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'SYNCING', total_events_indexed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE onchain_events (
    id SERIAL PRIMARY KEY, tx_hash TEXT NOT NULL, block_number INTEGER NOT NULL,
    log_index INTEGER NOT NULL DEFAULT 0, event_name TEXT NOT NULL, contract_address TEXT NOT NULL,
    args_json TEXT NOT NULL, created_at TIMESTAMP DEFAULT now())`,
  `CREATE TABLE role_members (
    id SERIAL PRIMARY KEY, role_hash TEXT NOT NULL, role_name TEXT NOT NULL, account_address TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true, granted_at_block INTEGER, revoked_at_block INTEGER,
    tx_hash TEXT, updated_at TIMESTAMP DEFAULT now())`,
  `CREATE TABLE auditor_profiles (
    id SERIAL PRIMARY KEY, account_address TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    kap_license_number TEXT NOT NULL, license_proof_cid TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true,
    registered_by TEXT NOT NULL, registered_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now())`,
] as const;
