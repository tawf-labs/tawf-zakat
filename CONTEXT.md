CONTEXT.MD: Zakat Transparency & Anti-Corruption Protocol (ZAKAT-L1)1. Executive Summary & Problem FramingCore Problem: Korupsi dan ketidakpercayaan publik pada lembaga amil zakat (penggelapan dana masuk, penggelembungan hak operasional amil, penahanan dana gelap, serta mustahik fiktif).Target Audience:Primary (Web2/Awam): Muzakki Indonesia yang ingin berdonasi via fiat (QRIS / Virtual Account) tanpa perlu tahu apa itu gas fee, seed phrase, atau dompet Web3.Secondary (Web3 Native): Komunitas kripto/diaspora yang ingin menyalurkan zakat secara on-chain langsung via token USDC.Core Architecture Strategy: Multi-Unit Ledger Architecture (No Complex FX Oracle). Smart contract memisahkan pencatatan saldo akuntansi Fiat (IDR) dan custody aset nyata (USDC) secara independen untuk menghindari risiko depeg atau ketiadaan feed oracle USD/IDR di Ethereum L1.2. Inflow Architecture: Dual-Gate Ingestion                    ┌─────────────────────────────────────────────────────────┐
                    │                    ZAKAT INFLOW GATE                    │
                    └─────────────────────────────────────────────────────────┘
                                   │                           │
                    [JALUR A: FIAT QRIS / VA]        [JALUR B: WEB3 DIRECT USDC]
                                   │                           │
                   Payment Gateway (Midtrans/Xendit)  Direct Web3 Deposit (ERC-20 Transfer)
                                   │                           │
                    Rekening Escrow Bank Amil          Smart Contract Vault (On-Chain Custody)
                                   │                           │
                       Off-Chain Batching Engine               │
                      (Build Daily Merkle Tree)                │
                                   │                           │
                                   └─────────────┬─────────────┘
                                                 ▼
                                ┌─────────────────────────────────┐
                                │     ETHEREUM L1 SMART CONTRACT   │
                                │         (ZakatVault.sol)        │
                                └─────────────────────────────────┘
A. Jalur Fiat (QRIS / Virtual Account)Karakteristik: Uang fisik mengendap di rekening bank/escrow amil. Smart contract hanya mencatat State Root (Merkle Root) dan akumulasi nilai IDR untuk efisiensi gas fee L1.Batching Settlement: Relayer mengagregasi ratusan donasi fiat harian menjadi 1 transaksi L1 (recordBatchSettlement).Muzakki Verification: Muzakki menerima Merkle Inclusion Proof di web client untuk memverifikasi donasinya tercatat pada Root yang terkunci di L1.B. Jalur Web3-Native (USDC Custody Vault)Karakteristik: Smart contract bertindak sebagai Custodial Vault yang secara riil menampung token ERC-20 USDC (USDC.transferFrom(msg.sender, address(this), amount)).Direct Execution: Tidak memerlukan batching relayer; transaksi dieksekusi langsung oleh wallet donatur ke smart contract L1.3. Privacy Mechanism: "Mode Publik" vs "Mode Hamba Allah"Sistem menyediakan opsi privasi di kedua jalur pembayaran:Mode PrivasiImplementasi Jalur Fiat (QRIS)Implementasi Jalur Web3 (USDC)Mode PublikNama muzakki dicatat di metadata off-chain & dashboard transparansi.Alamat wallet msg.sender dicatat secara publik di log event smart contract.Mode Hamba Allah (Private)Nama disamarkan menjadi Hamba Allah. Daun Merkle dihitung via salt: Leaf = Keccak256(TrxID + Salt + Amount). Muzakki memegang Salt sebagai bukti kepemilikan independen.Muzakki menyetor melalui pola ERC-2612 Permit via Relayer/Paymaster atau menyetor komitmen hash tanpa mengaitkan identitas Web2.4. Downstream Governance & Anti-Corruption ExecutionCuplikan kodeflowchart TD
    subgraph Invariant_Split ["1. Pembagian Alokasi Syariah (Code-is-Law)"]
        A[Dana Masuk: IDR / USDC] --> B{Smart Contract Split}
        B -->|Plafon Maksimal 12.5%| C[Amil Treasury Pool]
        B -->|Minimal 87.5% Terkunci| D[Mustahik Vault Pool]
    end

    subgraph MultiSig_Governance ["2. Otorisasi Pengeluaran Multi-Sig"]
        D -->|Pengajuan Program Bantuan| E[Disbursement Proposal]
        F[Amil Internal] -->|Approve 1| G{Multi-Sig 2-of-3}
        H[Dewan Pengawas Syariah] -->|Approve 2| G
        I[Auditor Independen] -->|Approve 3| G
        E --> G
    end

    subgraph Proof_Of_Disbursement ["3. Eksekusi & Bukti Penyaluran"]
        G -->|Lolos Approval| J[Transfer Fiat API / Penarikan USDC]
        J -->|KTP & Struk Penerima| K[Salted Hash Engine: NIK + Tanda Tangan]
        K -->|Pinning Metadata| L[IPFS Storage]
        L -->|Input CID ke L1| M[recordDisbursement]
        M -->|Update Invariant & Kunci Data| N[Public Transparency Dashboard]
    end
A. Pembagian Hak Amil Otomatis (Invariant Lock)Smart contract mengunci batas atas hak amil maksimal 12.5% (1/8) secara terprogram (MAX_AMIL_BPS = 1250).Sisanya (minimal 87.5%) mutlak terkunci hanya untuk 7 asnaf mustahik lainnya.B. Otorisasi Penyaluran (Multi-Sig 2-of-3)Penyaluran dana mustahik wajib mendapatkan persetujuan minimal 2 dari 3 entitas kunci:Kunci 1: Manajemen Amil Operasional.Kunci 2: Dewan Pengawas Syariah (DPS).Kunci 3: Auditor Eksternal / Lembaga Independen.C. Proof-of-Disbursement & Anti-Mustahik FiktifSalted Hashing NIK: $\text{beneficiaryHash} = \text{Keccak256}(\text{NIK} + \text{Nama} + \text{SecretSalt})$ untuk menjaga privasi penerima dari doxxing sekaligus mencegah manipulasi data.Anti-Double Claim: Smart contract mencatat mapping hasReceivedZakat[beneficiaryHash][periodId] agar 1 identitas tidak bisa diklaim ganda dalam 1 periode bantuan.IPFS Evidence CID: Foto penyerahan tersamar (blur), struk bank, dan tanda tangan digital diunggah ke IPFS dan diikat permanen ke transaksi L1.5. Technical Specifications: Solidity Smart Contract InterfaceSolidity// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract ZakatProtocolL1 is AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");
    bytes32 public constant SHARIA_SUPERVISOR_ROLE = keccak256("SHARIA_SUPERVISOR_ROLE");

    uint256 public constant MAX_AMIL_BPS = 1250; // 12.5% (Basis Points / 10000)

    IERC20 public immutable usdcToken;

    // --- FIAT LEDGER (Accounting Invariant in IDR) ---
    uint256 public totalCollectedIDR;
    uint256 public mustahikVaultIDR;
    uint256 public amilTreasuryIDR;
    uint256 public totalDisbursedIDR;

    // --- USDC VAULT (Real Custody Tokens) ---
    uint256 public totalCollectedUSDC;
    uint256 public mustahikVaultUSDC;
    uint256 public amilTreasuryUSDC;
    uint256 public totalDisbursedUSDC;

    // Batch Settlement: batchId => merkleRoot
    mapping(uint256 => bytes32) public fiatBatchRoots;

    // Anti-Double Claim: beneficiaryHash => (periodId => isClaimed)
    mapping(bytes32 => mapping(uint256 => bool)) public hasReceivedZakat;

    // Events
    event FiatBatchSettled(uint256 indexed batchId, bytes32 merkleRoot, uint256 totalAmountIDR);
    event USDCDeposited(address indexed donor, uint256 amountUSDC, bool isAnonymous, bytes32 commitmentHash);
    event DisbursementRecorded(
        uint8 indexed currencyType, // 0 = IDR, 1 = USDC
        uint256 amount,
        uint8 asnafCategory,
        bytes32 indexed beneficiaryHash,
        string ipfsProofCID
    );

    constructor(address _usdcAddress, address _admin, address _relayer, address _dps) {
        usdcToken = IERC20(_usdcAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _relayer);
        _grantRole(SHARIA_SUPERVISOR_ROLE, _dps);
    }

    // --- INFLOW: FIAT BATCH SETTLEMENT ---
    function recordFiatBatchSettlement(
        uint256 _batchId,
        bytes32 _merkleRoot,
        uint256 _totalBatchAmountIDR
    ) external onlyRole(RELAYER_ROLE) {
        require(fiatBatchRoots[_batchId] == bytes32(0), "Batch already settled");

        uint256 amilShare = (_totalBatchAmountIDR * MAX_AMIL_BPS) / 10000;
        uint256 mustahikShare = _totalBatchAmountIDR - amilShare;

        fiatBatchRoots[_batchId] = _merkleRoot;
        totalCollectedIDR += _totalBatchAmountIDR;
        amilTreasuryIDR += amilShare;
        mustahikVaultIDR += mustahikShare;

        emit FiatBatchSettled(_batchId, _merkleRoot, _totalBatchAmountIDR);
    }

    // --- INFLOW: DIRECT USDC DEPOSIT ---
    function depositUSDC(
        uint256 _amountUSDC,
        bool _isAnonymous,
        bytes32 _anonymousCommitment
    ) external {
        require(_amountUSDC > 0, "Amount must be > 0");
        require(usdcToken.transferFrom(msg.sender, address(this), _amountUSDC), "USDC Transfer failed");

        uint256 amilShare = (_amountUSDC * MAX_AMIL_BPS) / 10000;
        uint256 mustahikShare = _amountUSDC - amilShare;

        totalCollectedUSDC += _amountUSDC;
        amilTreasuryUSDC += amilShare;
        mustahikVaultUSDC += mustahikShare;

        emit USDCDeposited(
            _isAnonymous ? address(0) : msg.sender,
            _amountUSDC,
            _isAnonymous,
            _anonymousCommitment
        );
    }

    // --- OUTFLOW: PROOF OF DISBURSEMENT ---
    function recordDisbursement(
        uint8 _currencyType, // 0 = IDR (Catat Mutasi), 1 = USDC (Transfer On-Chain)
        uint256 _amount,
        uint8 _asnafCategory,
        bytes32 _beneficiaryHash,
        string calldata _ipfsProofCID,
        uint256 _periodId,
        address _usdcRecipient
    ) external onlyRole(RELAYER_ROLE) {
        require(!hasReceivedZakat[_beneficiaryHash][_periodId], "Double claim detected for beneficiary");

        if (_currencyType == 0) {
            // Fiat Outflow
            require(_amount <= mustahikVaultIDR, "Insufficient IDR vault balance");
            mustahikVaultIDR -= _amount;
            totalDisbursedIDR += _amount;
        } else if (_currencyType == 1) {
            // USDC Outflow
            require(_amount <= mustahikVaultUSDC, "Insufficient USDC vault balance");
            require(_usdcRecipient != address(0), "Invalid recipient address");
            mustahikVaultUSDC -= _amount;
            totalDisbursedUSDC += _amount;
            require(usdcToken.transfer(_usdcRecipient, _amount), "USDC transfer failed");
        } else {
            revert("Invalid currency type");
        }

        hasReceivedZakat[_beneficiaryHash][_periodId] = true;

        emit DisbursementRecorded(_currencyType, _amount, _asnafCategory, _beneficiaryHash, _ipfsProofCID);
    }
}
6. End-to-End Verification PipelineVerifikasi Muzakki (Client-Side Merkle Check):Muzakki memasukkan Transaction ID dan Salt di antarmuka web.Browser menghitung leaf $\text{Keccak256}(\dots)$ dan menarik sibling proof dari backend.Browser memvalidasi bukti terhadap fiatBatchRoots[batchId] di L1 tanpa membebankan gas fee ke muzakki.Audit Publik (Dashboard Transparansi):Dashboard menampilkan total kas masuk vs total kas keluar untuk IDR dan USDC secara real-time.Setiap pengeluaran memiliki tautan langsung ke IPFS CID bukti penyaluran dan identifier hash penerima zakat.