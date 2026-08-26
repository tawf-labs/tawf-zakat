# Arsitektur & Diagram Alir (Flowcharts) — Tawf Zakat Protocol

Dokumen ini memuat seluruh diagram alir (*flowchart*) arsitektur sistem protokol transparansi zakat (**ZAKAT-L1**) yang telah diimplementasikan pada branch ini.

---

## 1. Diagram Arsitektur Sistem Menyeluruh (High-Level Architecture)

Menampilkan interaksi antara lapisan **Frontend SPA (Vite React)**, **Backend API (Bun + Hono)**, **Smart Contract Ethereum Sepolia (`ZakatProtocolL1.sol`)**, serta **Jaringan Penyimpanan IPFS**.

```mermaid
flowchart TB
    subgraph Clients ["1. Lapisan Klien (Frontend SPA - Vite React)"]
        Muzakki["👤 Muzakki / Donatur (Web2 / Web3)"]
        PublicAuditor["🔍 Publik & Auditor"]
        AmilOfficer["🏢 Amil Operasional"]
        DPS["🏛️ Dewan Pengawas Syariah (DPS)"]
    end

    subgraph FrontendApp ["Frontend Application (frontend/ : Vite + TanStack Router + Tailwind)"]
        DonationUI["Modul Donasi (QRIS Fiat / Web3 USDC)"]
        VerifierUI["Client-Side Merkle Verifier (Zero Gas)"]
        DashboardUI["Dashboard Transparansi Publik"]
        GovernanceUI["Panel Otorisasi Multi-Sig 2-of-3"]
    end

    subgraph BackendRelayer ["2. Lapisan Relayer & Koordinator (backend/ : Bun + Hono API)"]
        DonationAPI["/api/donations/fiat (Generate Salt & TrxID)"]
        MerkleEngine["/api/batch-settlement (Merkle Tree Engine)"]
        ProofAPI["/api/verify-receipt (Sibling Proof Provider)"]
        IPFSService["/api/disbursement/upload-proof (Pinata / Mock IPFS)"]
    end

    subgraph StorageLayer ["3. Lapisan Penyimpanan Data"]
        IPFS["📦 IPFS Decentralized Storage (Metadata & Dokumen Penyerahan)"]
        BankEscrow["🏦 Rekening Bank Escrow Amil (Penampung Uang Fisik IDR)"]
    end

    subgraph BlockchainLayer ["4. Lapisan Blockchain (Ethereum Sepolia L1 Smart Contract)"]
        ZakatContract["📜 ZakatProtocolL1.sol (MAX_AMIL_BPS = 1250, Multi-Sig 2-of-3, Anti-Double Claim)"]
        USDCVault["💰 USDC Token Custody Vault (ERC-20 Real Custody)"]
        FiatLedger["📑 Fiat IDR Accounting Ledger (fiatBatchRoots)"]
    end

    %% Client to Frontend
    Muzakki -->|Pilih Mode Donasi| DonationUI
    Muzakki -->|Input TrxID & Salt| VerifierUI
    PublicAuditor -->|Pantau Arus Kas| DashboardUI
    AmilOfficer & DPS & PublicAuditor -->|Review & Vote| GovernanceUI

    %% Frontend to Backend
    DonationUI -->|Submit Fiat| DonationAPI
    VerifierUI -->|Minta Bukti Sibling| ProofAPI
    GovernanceUI -->|Upload Bukti Bantuan| IPFSService

    %% Backend to Storage & Chain
    DonationAPI --> BankEscrow
    IPFSService -->|Pin Metadata JSON & Foto Blur| IPFS
    MerkleEngine -->|Kirim Merkle Root Harian| ZakatContract

    %% Frontend to Chain
    DonationUI -->|Direct Deposit USDC| USDCVault
    VerifierUI -.->|Validasi Bukti vs Root L1| FiatLedger
    GovernanceUI -->|propose / approve / execute| ZakatContract
```

---

## 2. Diagram Alir Arus Kas Masuk (Dual-Gate Inflow Architecture)

Memperlihatkan perbedaan alur pemrosesan antara **Jalur A (Fiat QRIS/VA via Merkle Batching)** dan **Jalur B (Web3 USDC Direct Custody)**.

```mermaid
flowchart TD
    Start(["Donatur Ingin Berzakat"]) --> Choice{"Pilih Jalur Pembayaran"}

    %% JALUR A: FIAT
    subgraph Jalur_A ["Jalur A: Fiat (QRIS / Virtual Account)"]
        Choice -->|Fiat IDR| FiatForm["Isi Form Donasi & Pilih Mode"]
        FiatForm --> AnonCheck{"Pilih Mode Privasi?"}
        AnonCheck -->|Mode Publik| SetPublic["Mode Publik: Nama Dicatat Terbuka"]
        AnonCheck -->|Mode Hamba Allah| SetAnon["Mode Hamba Allah: Nama Disamarkan & Generate Secret Salt"]
        
        SetPublic & SetAnon --> PayQRIS["Bayar via QRIS / VA ke Rekening Escrow Bank"]
        PayQRIS --> GenerateReceipt["Terbitkan Kuitansi Digital + Secret Salt"]
        
        GenerateReceipt --> OffchainQueue[("Antrian Transaksi Harian Off-Chain")]
        OffchainQueue --> BatchEngine["Bun Hono Merkle Tree Engine"]
        BatchEngine --> CalculateLeaves["Hitung Daun: Keccak256(TrxID + Salt + Amount)"]
        CalculateLeaves --> BuildTree["Bangun Binary Merkle Tree & Dapatkan Merkle Root"]
        
        BuildTree --> RelayerTx["Relayer Memanggil Smart Contract: recordFiatBatchSettlement"]
        RelayerTx --> L1FiatRecord["Kunci Merkle Root di fiatBatchRoots & Update Saldo IDR"]
    end

    %% JALUR B: WEB3 USDC
    subgraph Jalur_B ["Jalur B: Web3 Native (USDC Custodial Vault)"]
        Choice -->|USDC ERC-20| Web3Form["Hubungkan Dompet Web3 / MetaMask"]
        Web3Form --> Web3AnonCheck{"Pilih Mode Privasi?"}
        Web3AnonCheck -->|Mode Publik| MsgSender["Gunakan msg.sender Asli"]
        Web3AnonCheck -->|Mode Hamba Allah| CommitHash["Gunakan Anonymous Commitment Hash"]
        
        MsgSender & CommitHash --> DirectDeposit["Eksekusi Transaksi: depositUSDC ke ZakatProtocolL1"]
        DirectDeposit --> USDCTransfer["USDC.transferFrom ke Smart Contract Vault"]
        USDCTransfer --> L1USDCRecord["Update Saldo totalCollectedUSDC"]
    end

    %% INVARIANT SPLIT
    L1FiatRecord & L1USDCRecord --> InvariantSplit{"Smart Contract Invariant Split"}
    InvariantSplit -->|Maksimal 12.5%| AmilPool["Amil Treasury Pool"]
    InvariantSplit -->|Minimal 87.5% Terkunci| MustahikPool["Mustahik Vault Pool"]
```

---

## 3. Diagram Alir Pembagian Alokasi Syariah (12.5% Invariant Lock)

Menjelaskan rumus matematika kepatuhan syariah yang dikunci pada smart contract (`MAX_AMIL_BPS = 1250`).

```mermaid
flowchart LR
    DanaMasuk["💰 Total Dana Masuk (IDR / USDC)<br/>(Gross Donation Amount)"] --> SplitEngine["⚙️ Formula Smart Contract<br/>(Code-is-Law)"]
    
    SplitEngine --> CalcAmil["amilShare = (Amount * 1250) / 10000<br/>(Maksimal 12.5%)"]
    SplitEngine --> CalcMustahik["mustahikShare = Amount - amilShare<br/>(Minimal 87.5%)"]
    
    CalcAmil --> TreasuryPool["🏢 Amil Treasury Balance<br/>(Biaya Operasional & Hak Amil)"]
    CalcMustahik --> VaultPool["🔒 Mustahik Vault Balance<br/>(Terkunci Khusus 7 Asnaf Lainnya)"]
    
    style CalcAmil fill:#fef3c7,stroke:#d97706,stroke-width:2px
    style CalcMustahik fill:#d1fae5,stroke:#059669,stroke-width:2px
    style VaultPool fill:#ecfdf5,stroke:#10b981,stroke-width:2px
```

---

## 4. Diagram Alir Tata Kelola Penyaluran (Multi-Sig 2-of-3 Governance)

Menjelaskan siklus hidup proposal penyaluran dana mustahik dari pengajuan, persetujuan kuorum, hingga eksekusi anti-klaim ganda.

```mermaid
flowchart TD
    StartGov(["Mulai Proses Penyaluran Dana Mustahik"]) --> InputData["Amil Menginput Data Penerima:<br/>NIK, Nama, Kategori Asnaf, Nominal"]
    
    InputData --> HashNIK["Hitung Salted Hash NIK:<br/>beneficiaryHash = Keccak256(NIK + Nama + Salt)"]
    HashNIK --> UploadIPFS["Unggah Foto Penyerahan Tersamar & Struk ke IPFS<br/>(Dapatkan ipfsProofCID)"]
    UploadIPFS --> CallPropose["Amil Memanggil Smart Contract:<br/>proposeDisbursement(...)"]
    
    CallPropose --> StatePending["Status Proposal: PENDING<br/>(Approval Count = 1)"]
    
    StatePending --> ReviewPhase{"Tahap Peninjauan Independen"}
    ReviewPhase -->|DPS Meninjau Kesesuaian Syariah| ApproveDPS["DPS Memanggil: approveDisbursement(...)"]
    ReviewPhase -->|Auditor Meninjau Bukti Finansial| ApproveAuditor["Auditor Memanggil: approveDisbursement(...)"]
    
    ApproveDPS & ApproveAuditor --> CheckQuorum{"Apakah Jumlah Approval >= 2?"}
    CheckQuorum -->|Belum| WaitVote["Menunggu Persetujuan Pihak Lain"]
    WaitVote --> ReviewPhase
    
    CheckQuorum -->|Ya| StateApproved["Status Proposal: APPROVED<br/>(Kuorum 2-of-3 Terpenuhi)"]
    
    StateApproved --> CallExecute["Amil / Relayer Memanggil:<br/>executeDisbursement(proposalId)"]
    
    CallExecute --> DoubleClaimCheck{"Cek hasReceivedZakat[beneficiaryHash][periodId]"}
    DoubleClaimCheck -->|Sudah Pernah Cair di Periode Ini| RevertTx["❌ Revert: Double Claim Detected"]
    DoubleClaimCheck -->|Belum Pernah Cair| ExecuteTransfer{"Jenis Mata Uang?"}
    
    ExecuteTransfer -->|Fiat IDR| ExecuteFiat["[IDR] Potong mustahikVaultIDR & Catat Mutasi Resmi"]
    ExecuteTransfer -->|Web3 USDC| ExecuteUSDC["[USDC] Potong mustahikVaultUSDC & Transfer USDC on-chain"]
    
    ExecuteFiat & ExecuteUSDC --> Finalize["Kunci hasReceivedZakat = true & Terbitkan Log Event L1"]
    Finalize --> Done(["Selesai: Dana Sah Tersalurkan"])
```

---

## 5. Diagram Alir Verifikasi Muzakki Tanpa Gas Fee (Client-Side Merkle Verification)

Menjelaskan bagaimana browser Muzakki memvalidasi bukti kriptografis secara mandiri tanpa biaya gas blockchain.

```mermaid
sequenceDiagram
    autonumber
    actor Muzakki as 👤 Muzakki (Donatur)
    participant Browser as 🌐 Web Browser (Client)
    participant Backend as ⚡ Bun Hono API
    participant Blockchain as ⛓️ Ethereum Sepolia L1

    Muzakki->>Browser: Masukkan Transaction ID & Secret Salt
    Note over Browser: Browser Menghitung Daun Lokal:<br/>Leaf = Keccak256(TrxID + Salt + Amount)

    Browser->>Backend: POST /api/verify-receipt (trxId, salt, amount)
    Backend->>Backend: Ambil Merkle Tree Batch Terkait
    Backend->>Backend: Generate Sibling Proof Path
    Backend-->>Browser: Return (merkleRoot, proof, batchId)

    Browser->>Blockchain: Baca State Root: fiatBatchRoots[batchId] (RPC Bebas Gas)
    Blockchain-->>Browser: Return On-Chain Root

    Note over Browser: Rekonstruksi Akar Kriptografis:<br/>ComputedRoot = HashPair(Leaf, Proof)<br/>Validasi: ComputedRoot == On-Chain Root

    alt Bukti Valid & Cocok
        Browser-->>Muzakki: 🟢 Status: Terverifikasi 100% Tercatat di L1 (Hijau)
    else Bukti Tidak Cocok / Data Dimanipulasi
        Browser-->>Muzakki: 🔴 Status: Bukti Tidak Valid / Ditolak (Merah)
    end
```

---

## 6. Diagram Struktur Entitas & Relasi Data Smart Contract

```mermaid
erDiagram
    ZAKAT_PROTOCOL_L1 ||--o{ FIAT_BATCH : records
    ZAKAT_PROTOCOL_L1 ||--o{ DISBURSEMENT_PROPOSAL : manages
    ZAKAT_PROTOCOL_L1 ||--o{ DOUBLE_CLAIM_REGISTRY : enforces

    ZAKAT_PROTOCOL_L1 {
        uint256 MAX_AMIL_BPS "1250 (12.5%)"
        uint256 REQUIRED_APPROVALS "2 (Kuorum 2-of-3)"
        uint256 totalCollectedIDR "Total Akumulasi Masuk IDR"
        uint256 mustahikVaultIDR "Saldo Brankas Mustahik IDR"
        uint256 amilTreasuryIDR "Saldo Hak Amil IDR"
        uint256 totalDisbursedIDR "Total Penyaluran IDR"
        uint256 totalCollectedUSDC "Total Deposit USDC"
        uint256 mustahikVaultUSDC "Saldo Brankas Mustahik USDC"
        uint256 amilTreasuryUSDC "Saldo Hak Amil USDC"
        uint256 totalDisbursedUSDC "Total Penyaluran USDC"
    }

    FIAT_BATCH {
        uint256 batchId PK
        bytes32 merkleRoot "Root Bukti Inklusi"
        uint256 totalBatchAmountIDR "Total Donasi Fiat"
    }

    DISBURSEMENT_PROPOSAL {
        uint256 proposalId PK
        uint8 currencyType "0: IDR, 1: USDC"
        uint256 amount "Nominal Bantuan"
        uint8 asnafCategory "0: Fakir, 1: Miskin, dll"
        bytes32 beneficiaryHash "Keccak256(NIK + Nama + Salt)"
        string ipfsProofCID "Bukti Penyaluran IPFS"
        uint256 periodId "Contoh: 202608"
        address usdcRecipient "Alamat Wallet USDC"
        uint256 approvalCount "Jumlah Persetujuan"
        enum status "Pending / Approved / Executed"
    }

    DOUBLE_CLAIM_REGISTRY {
        bytes32 beneficiaryHash PK
        uint256 periodId PK
        bool isClaimed "Proteksi Ganda"
    }
```
