extern crate std;

use {
    quasar_svm::{Account, ProgramError, Pubkey, QuasarSvm},
    solana_address::Address,
    solana_instruction::Instruction,
    spl_token_interface::state::{Account as TokenAccount, AccountState, Mint as SplMint},
    std::vec,
    zkt_core_client::*,
};

const ADMIN: Address = Address::new_from_array([1; 32]);
const ORGANIZER: Address = Address::new_from_array([2; 32]);
const DONOR: Address = Address::new_from_array([3; 32]);
const FALLBACK: Address = Address::new_from_array([4; 32]);
const MINT: Address = Address::new_from_array([5; 32]);
const DONOR_TA: Address = Address::new_from_array([6; 32]);
const DEST_TA: Address = Address::new_from_array([7; 32]);
const FALLBACK_TA: Address = Address::new_from_array([8; 32]);
const OUTSIDER: Address = Address::new_from_array([9; 32]);

const DAY: i64 = 86_400;
const T0: i64 = 1_750_000_000;
// Pool cap policy stand-in (token base units; IDRX has 2 decimals).
const MAX_POOL_CAP: u64 = 50_000_000;
const POOL_CAP: u64 = 10_000;

fn pk(a: &Address) -> Pubkey {
    Pubkey::new_from_array(*a.as_array())
}

fn system_program() -> Address {
    Address::new_from_array(quasar_svm::system_program::ID.to_bytes())
}

fn token_program() -> Address {
    Address::new_from_array(quasar_svm::SPL_TOKEN_PROGRAM_ID.to_bytes())
}

fn ata_program() -> Address {
    Address::new_from_array(quasar_svm::SPL_ASSOCIATED_TOKEN_PROGRAM_ID.to_bytes())
}

fn ata(wallet: &Address, mint: &Address) -> Address {
    Address::find_program_address(
        &[wallet.as_ref(), token_program().as_ref(), mint.as_ref()],
        &ata_program(),
    )
    .0
}

fn signer(address: &Address) -> Account {
    quasar_svm::token::create_keyed_system_account(&pk(address), 10_000_000_000)
}

fn empty(address: &Address) -> Account {
    Account {
        address: pk(address),
        lamports: 0,
        data: vec![],
        owner: quasar_svm::system_program::ID,
        executable: false,
    }
}

fn mint_account(address: &Address, authority: &Address) -> Account {
    quasar_svm::token::create_keyed_mint_account(
        &pk(address),
        &SplMint {
            mint_authority: Some(pk(authority)).into(),
            supply: 1_000_000_000,
            decimals: 2, // IDRX parity
            is_initialized: true,
            freeze_authority: None.into(),
        },
    )
}

fn token_account(address: &Address, mint: &Address, owner: &Address, amount: u64) -> Account {
    quasar_svm::token::create_keyed_token_account(
        &pk(address),
        &TokenAccount {
            mint: pk(mint),
            owner: pk(owner),
            amount,
            state: AccountState::Initialized,
            ..TokenAccount::default()
        },
    )
}

fn token_amount(svm_account: &Account) -> u64 {
    u64::from_le_bytes(svm_account.data[64..72].try_into().unwrap())
}

fn setup() -> QuasarSvm {
    let elf = std::fs::read("target/deploy/zkt_core.so").unwrap();
    let mut svm = QuasarSvm::new()
        .with_program(&pk(&ID), &elf)
        .with_token_program()
        .with_associated_token_program();
    svm.warp_to_timestamp(T0);
    svm
}

fn config_pda() -> Address {
    find_config_address(&ID).0
}

fn init_config_ix() -> Instruction {
    Init_configInstruction {
        authority: ADMIN,
        config: config_pda(),
        system_program: system_program(),
        fallback_authority: FALLBACK,
        max_pool_cap: MAX_POOL_CAP,
    }
    .into()
}

fn whitelist_ix(wallet: Address) -> Instruction {
    Whitelist_organizerInstruction {
        authority: ADMIN,
        config: config_pda(),
        wallet,
        organizer: find_organizer_address(&wallet, &ID).0,
        system_program: system_program(),
    }
    .into()
}

fn create_pool_ix(campaign_type: u8) -> Instruction {
    let pool = find_pool_address(&ORGANIZER, 0, &ID).0;
    Create_poolInstruction {
        organizer: ORGANIZER,
        config: config_pda(),
        organizer_account: find_organizer_address(&ORGANIZER, &ID).0,
        mint: MINT,
        pool,
        vault: ata(&pool, &MINT),
        token_program: token_program(),
        system_program: system_program(),
        ata_program: ata_program(),
        index: 0,
        campaign_type,
        cap: POOL_CAP,
    }
    .into()
}

fn donate_ix(amount: u64, receipt_index: u64) -> Instruction {
    let pool = find_pool_address(&ORGANIZER, 0, &ID).0;
    DonateInstruction {
        donor: DONOR,
        config: config_pda(),
        pool,
        vault: ata(&pool, &MINT),
        donor_ta: DONOR_TA,
        receipt: find_receipt_address(&pool, receipt_index, &ID).0,
        token_program: token_program(),
        system_program: system_program(),
        amount,
        receipt_index,
    }
    .into()
}

fn withdraw_ix(amount: u64) -> Instruction {
    let pool = find_pool_address(&ORGANIZER, 0, &ID).0;
    WithdrawInstruction {
        organizer: ORGANIZER,
        config: config_pda(),
        pool,
        vault: ata(&pool, &MINT),
        dest_ta: DEST_TA,
        token_program: token_program(),
        amount,
    }
    .into()
}

fn set_config_ix(paused: bool) -> Instruction {
    Set_configInstruction {
        authority: ADMIN,
        config: config_pda(),
        fallback_authority: FALLBACK,
        max_pool_cap: MAX_POOL_CAP,
        paused,
    }
    .into()
}

fn redistribute_ix(fallback_ta: Address) -> Instruction {
    let pool = find_pool_address(&ORGANIZER, 0, &ID).0;
    RedistributeInstruction {
        config: config_pda(),
        pool,
        vault: ata(&pool, &MINT),
        fallback_ta,
        token_program: token_program(),
    }
    .into()
}

/// Bootstraps config + whitelisted organizer + an active zakat pool with one
/// 4_000 donation in the vault. Shared prefix for the lifecycle tests.
fn setup_funded_zakat_pool(svm: &mut QuasarSvm) {
    let pool = find_pool_address(&ORGANIZER, 0, &ID).0;
    svm.process_instruction(&init_config_ix(), &[signer(&ADMIN), empty(&config_pda())])
        .assert_success();
    svm.process_instruction(
        &whitelist_ix(ORGANIZER),
        &[
            signer(&ADMIN),
            empty(&ORGANIZER),
            empty(&find_organizer_address(&ORGANIZER, &ID).0),
        ],
    )
    .assert_success();
    svm.process_instruction(
        &create_pool_ix(0),
        &[
            signer(&ORGANIZER),
            mint_account(&MINT, &ADMIN),
            empty(&pool),
            empty(&ata(&pool, &MINT)),
        ],
    )
    .assert_success();
    svm.process_instruction(
        &donate_ix(4_000, 0),
        &[
            signer(&DONOR),
            token_account(&DONOR_TA, &MINT, &DONOR, 10_000),
            empty(&find_receipt_address(&pool, 0, &ID).0),
        ],
    )
    .assert_success();
}

#[test]
fn test_init_config() {
    let mut svm = setup();
    let result =
        svm.process_instruction(&init_config_ix(), &[signer(&ADMIN), empty(&config_pda())]);
    result.assert_success();

    let data = &result.account(&pk(&config_pda())).unwrap().data;
    assert_eq!(data[0], 1, "config discriminator");
    assert_eq!(&data[1..33], ADMIN.as_ref(), "authority");
    assert_eq!(&data[65..97], FALLBACK.as_ref(), "fallback authority");
    assert_eq!(&data[97..105], &MAX_POOL_CAP.to_le_bytes(), "max pool cap");
}

#[test]
fn test_whitelist_requires_admin() {
    let mut svm = setup();
    svm.process_instruction(&init_config_ix(), &[signer(&ADMIN), empty(&config_pda())])
        .assert_success();

    let mut ix = whitelist_ix(ORGANIZER);
    ix.accounts[0].pubkey = OUTSIDER;
    let result = svm.process_instruction(
        &ix,
        &[
            signer(&OUTSIDER),
            empty(&ORGANIZER),
            empty(&find_organizer_address(&ORGANIZER, &ID).0),
        ],
    );
    assert!(result.is_err(), "non-admin whitelist must fail");
}

#[test]
fn test_zakat_donate_cap_and_receipt() {
    let mut svm = setup();
    setup_funded_zakat_pool(&mut svm);
    let pool = find_pool_address(&ORGANIZER, 0, &ID).0;

    // Vault holds the donation.
    let vault = svm.get_account(&pk(&ata(&pool, &MINT))).unwrap();
    assert_eq!(token_amount(&vault), 4_000, "vault balance");

    // Receipt records donor + amount.
    let receipt = svm
        .get_account(&pk(&find_receipt_address(&pool, 0, &ID).0))
        .unwrap();
    assert_eq!(receipt.data[0], 4, "receipt discriminator");
    assert_eq!(&receipt.data[1..33], DONOR.as_ref(), "receipt donor");
    assert_eq!(&receipt.data[65..73], &4_000u64.to_le_bytes(), "amount");

    // Over-cap donation rejected (4_000 + 7_000 > 10_000).
    let result = svm.process_instruction(
        &donate_ix(7_000, 1),
        &[empty(&find_receipt_address(&pool, 1, &ID).0)],
    );
    result.assert_error(ProgramError::Custom(6005)); // CapExceeded

    // Wrong receipt index rejected.
    let result = svm.process_instruction(
        &donate_ix(1_000, 5),
        &[empty(&find_receipt_address(&pool, 5, &ID).0)],
    );
    result.assert_error(ProgramError::Custom(6016)); // InvalidReceiptIndex
}

#[test]
fn test_zakat_lifecycle_deadline_extension_redistribution() {
    let mut svm = setup();
    setup_funded_zakat_pool(&mut svm);
    let pool = find_pool_address(&ORGANIZER, 0, &ID).0;

    // Within the 30-day window the organizer may withdraw.
    svm.process_instruction(
        &withdraw_ix(1_000),
        &[token_account(&DEST_TA, &MINT, &ORGANIZER, 0)],
    )
    .assert_success();

    // Past the deadline: withdraw and donate are blocked.
    svm.warp_to_timestamp(T0 + 31 * DAY);
    svm.process_instruction(&withdraw_ix(500), &[])
        .assert_error(ProgramError::Custom(6008)); // WithdrawWindowClosed
    svm.process_instruction(
        &donate_ix(100, 1),
        &[empty(&find_receipt_address(&pool, 1, &ID).0)],
    )
    .assert_error(ProgramError::Custom(6007)); // DonationWindowClosed

    // Redistribution is not yet due during the grace period.
    svm.process_instruction(
        &redistribute_ix(FALLBACK_TA),
        &[token_account(&FALLBACK_TA, &MINT, &FALLBACK, 0)],
    )
    .assert_error(ProgramError::Custom(6012)); // RedistributionNotDue

    // Admin extends within the grace period -> +14 days, withdraw reopens.
    let extend: Instruction = Extend_deadlineInstruction {
        authority: ADMIN,
        config: config_pda(),
        pool,
    }
    .into();
    svm.process_instruction(&extend, &[]).assert_success();
    svm.process_instruction(&withdraw_ix(500), &[])
        .assert_success();

    // Second extension is rejected.
    svm.process_instruction(&extend, &[])
        .assert_error(ProgramError::Custom(6010)); // AlreadyExtended

    // After extended deadline (44d) + grace (7d): redistribution due,
    // but only into a token account owned by the fallback authority.
    svm.warp_to_timestamp(T0 + 52 * DAY);
    svm.process_instruction(&redistribute_ix(DEST_TA), &[])
        .assert_error(ProgramError::Custom(6014)); // InvalidFallbackDestination

    // (the earlier RedistributionNotDue attempt failed, so FALLBACK_TA was
    // never committed to the SVM database — provide it again)
    let result = svm.process_instruction(
        &redistribute_ix(FALLBACK_TA),
        &[token_account(&FALLBACK_TA, &MINT, &FALLBACK, 0)],
    );
    result.assert_success();

    let vault = result.account(&pk(&ata(&pool, &MINT))).unwrap();
    assert_eq!(token_amount(&vault), 0, "vault drained");
    let fallback = result.account(&pk(&FALLBACK_TA)).unwrap();
    assert_eq!(token_amount(&fallback), 2_500, "fallback received rest");
    let pool_data = &result.account(&pk(&pool)).unwrap().data;
    assert_eq!(pool_data[106], 1, "pool status closed");

    // Closed pool rejects further redistribution.
    svm.process_instruction(&redistribute_ix(FALLBACK_TA), &[])
        .assert_error(ProgramError::Custom(6006)); // PoolNotActive
}

#[test]
fn test_normal_pool_has_no_deadline() {
    let mut svm = setup();
    let pool = find_pool_address(&ORGANIZER, 0, &ID).0;
    svm.process_instruction(&init_config_ix(), &[signer(&ADMIN), empty(&config_pda())])
        .assert_success();
    svm.process_instruction(
        &whitelist_ix(ORGANIZER),
        &[
            signer(&ADMIN),
            empty(&ORGANIZER),
            empty(&find_organizer_address(&ORGANIZER, &ID).0),
        ],
    )
    .assert_success();
    svm.process_instruction(
        &create_pool_ix(1), // CAMPAIGN_NORMAL
        &[
            signer(&ORGANIZER),
            mint_account(&MINT, &ADMIN),
            empty(&pool),
            empty(&ata(&pool, &MINT)),
        ],
    )
    .assert_success();
    svm.process_instruction(
        &donate_ix(4_000, 0),
        &[
            signer(&DONOR),
            token_account(&DONOR_TA, &MINT, &DONOR, 10_000),
            empty(&find_receipt_address(&pool, 0, &ID).0),
        ],
    )
    .assert_success();

    // A year later: normal campaigns still accept donations and withdrawals.
    svm.warp_to_timestamp(T0 + 365 * DAY);
    svm.process_instruction(
        &donate_ix(1_000, 1),
        &[empty(&find_receipt_address(&pool, 1, &ID).0)],
    )
    .assert_success();
    svm.process_instruction(
        &withdraw_ix(2_000),
        &[token_account(&DEST_TA, &MINT, &ORGANIZER, 0)],
    )
    .assert_success();

    // Redistribution never applies to normal campaigns.
    svm.process_instruction(
        &redistribute_ix(FALLBACK_TA),
        &[token_account(&FALLBACK_TA, &MINT, &FALLBACK, 0)],
    )
    .assert_error(ProgramError::Custom(6009)); // NotZakatPool
}

#[test]
fn test_pause_freezes_donate_and_withdraw() {
    let mut svm = setup();
    setup_funded_zakat_pool(&mut svm);
    let pool = find_pool_address(&ORGANIZER, 0, &ID).0;

    // Admin trips the emergency pause.
    svm.process_instruction(&set_config_ix(true), &[])
        .assert_success();

    // Both donor inflow and organizer outflow are frozen.
    svm.process_instruction(
        &donate_ix(1_000, 1),
        &[empty(&find_receipt_address(&pool, 1, &ID).0)],
    )
    .assert_error(ProgramError::Custom(6001)); // Paused
    svm.process_instruction(
        &withdraw_ix(1_000),
        &[token_account(&DEST_TA, &MINT, &ORGANIZER, 0)],
    )
    .assert_error(ProgramError::Custom(6001)); // Paused

    // Unpause restores withdrawals.
    svm.process_instruction(&set_config_ix(false), &[])
        .assert_success();
    svm.process_instruction(
        &withdraw_ix(1_000),
        &[token_account(&DEST_TA, &MINT, &ORGANIZER, 0)],
    )
    .assert_success();
}

#[test]
fn test_authority_two_step_transfer() {
    let mut svm = setup();
    svm.process_instruction(&init_config_ix(), &[signer(&ADMIN), empty(&config_pda())])
        .assert_success();

    // Accept without a pending transfer fails.
    let accept: Instruction = Accept_authorityInstruction {
        new_authority: OUTSIDER,
        config: config_pda(),
    }
    .into();
    svm.process_instruction(&accept, &[signer(&OUTSIDER)])
        .assert_error(ProgramError::Custom(6017)); // NoPendingAuthority

    let transfer: Instruction = Transfer_authorityInstruction {
        authority: ADMIN,
        config: config_pda(),
        new_authority: OUTSIDER,
    }
    .into();
    svm.process_instruction(&transfer, &[]).assert_success();

    // Only the pending authority may accept.
    let mut wrong_accept = accept.clone();
    wrong_accept.accounts[0].pubkey = DONOR;
    svm.process_instruction(&wrong_accept, &[signer(&DONOR)])
        .assert_error(ProgramError::Custom(6000)); // Unauthorized

    let result = svm.process_instruction(&accept, &[]);
    result.assert_success();
    let data = &result.account(&pk(&config_pda())).unwrap().data;
    assert_eq!(&data[1..33], OUTSIDER.as_ref(), "new authority");
    assert_eq!(&data[33..65], &[0u8; 32], "pending cleared");
}
