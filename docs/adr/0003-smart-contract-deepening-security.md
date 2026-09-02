# ADR 0003: Smart Contract Deepening, SafeERC20, Custom Errors, and Lifecycle Management

## Status
Accepted

## Context
Pada implementasi awal `ZakatProtocolL1.sol`, smart contract telah berhasil memvalidasi invariant matematika 12.5% dan kuorum otorisasi 2-of-3. Namun, melalui tinjauan arsitektur (`/improve-codebase-architecture`) dan best practice smart contract EVM 2026, ditemukan beberapa celah friction operasional:
1. Variabel `amilTreasuryUSDC` menampung hak operasional amil 12.5%, tetapi tidak ada fungsi penarikan resmi (`withdrawAmilShareUSDC`).
2. Terdapat enum status `ProposalStatus.Cancelled`, tetapi belum ada fungsi `cancelProposal` bagi DPS/Admin untuk membatalkan proposal bermasalah.
3. Kontrak masih menggunakan string revert panjang dan transfer token tanpa wrapper `SafeERC20`, serta belum dilengkapi `ReentrancyGuard`.

## Decision
Kami memutuskan untuk memperdalam (*deepen*) dan memperkuat modul smart contract `ZakatProtocolL1.sol` dengan spesifikasi:
1. **Penarikan Hak Amil**: Menyediakan fungsi `withdrawAmilShareUSDC(address to, uint256 amount)` yang hanya bisa dieksekusi oleh `DEFAULT_ADMIN_ROLE` dengan batasan `amount <= amilTreasuryUSDC` dan event `AmilShareWithdrawn`.
2. **Pembatalan Proposal**: Menyediakan fungsi `cancelProposal(uint256 proposalId, string calldata reason)` yang dapat dipanggil oleh `DEFAULT_ADMIN_ROLE` atau `SHARIA_SUPERVISOR_ROLE` (DPS) untuk proposal berstatus `Pending`.
3. **Security & Gas Optimization**:
   - Mengadopsi OpenZeppelin `SafeERC20` (`using SafeERC20 for IERC20`).
   - Memasang modifier `nonReentrant` (`ReentrancyGuard`) pada seluruh fungsi mutasi keluar dana (`executeDisbursement` dan `withdrawAmilShareUSDC`).
   - Mengganti seluruh `require(..., "string")` dengan **Solidity 0.8+ Custom Errors** (`InvalidAddress()`, `InsufficientVaultBalance()`, `InsufficientAmilTreasury()`, `QuorumNotMet()`, `DoubleClaimDetected()`, dll).

## Consequences
### Positif:
- Siklus hidup dana operasional amil menjadi lengkap dan dapat ditarik secara legal tanpa mencemari jalur mustahik.
- Dewan Pengawas Syariah (DPS) memiliki hak veto untuk menggugurkan proposal cacat syariah.
- Konsumsi gas deployment dan eksekusi terpangkas signifikan melalui custom errors.
- Perlindungan reentrancy dan transfer token standar maupun non-standar terjamin melalui OpenZeppelin `SafeERC20` & `ReentrancyGuard`.

### Negatif:
- Test suite di `sc/test/` perlu disesuaikan untuk menguji custom error selector dan fungsi baru.
