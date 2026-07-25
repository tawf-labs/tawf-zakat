// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.31;
import "forge-std/Script.sol";
import "../src/DAO/ZKTCore.sol";
import "../src/DAO/core/PrivateDonationPool.sol";
import "../src/DAO/core/ShariaReviewManager.sol";
import "../src/DAO/verifiers/HonkVerifier.sol";
import "../src/DAO/verifiers/Groth16Verifier.sol";
import "../src/DAO/NullifierRegistry.sol";

/**
 * @title V10Deploy
 * @notice Deploy ZKTCore and ZK contracts, wired to pre-deployed tawf-gov contracts.
 *         Must run AFTER tawf-gov DeployTawfSystem.s.sol.
 *
 *         Run: export SEPOLIA_RPC_URL=https://sepolia...
 *              export TAWF_PASSPORT=0x... (from tawf-gov deploy)
 *              forge script script/V10Deploy.s.sol --rpc-url sepolia --account tawf-deployer --broadcast
 */
contract V10Deploy is Script {
    function run() external {
        // ── Read tawf-gov addresses from env ──
        address passportAddr   = vm.envAddress("TAWF_PASSPORT");
        address reputationAddr = vm.envAddress("TAWF_REPUTATION");
        address votingNFTAddr  = vm.envAddress("TAWF_VOTING_NFT");
        address receiptNFTAddr = vm.envAddress("TAWF_RECEIPT_NFT");
        address idrxAddr       = vm.envAddress("TAWF_IDRX");
        address pmAddr         = vm.envAddress("TAWF_PROPOSAL_MANAGER");
        address vmgrAddr       = vm.envAddress("TAWF_VOTING_MANAGER");
        address mmAddr         = vm.envAddress("TAWF_MILESTONE_MANAGER");
        address trackerAddr    = vm.envAddress("TAWF_PARTICIPATION_TRACKER");
        address poolMgrAddr    = vm.envAddress("TAWF_POOL_MANAGER");
        address escrowAddr     = vm.envAddress("TAWF_ZAKAT_ESCROW");
        address coreTeam       = vm.envAddress("CORE_TEAM_ADDRESS");

        console.log("=== V10 ZKT Deploy (wired to tawf-gov) ===");
        console.log("TawfPassport:", passportAddr);
        console.log("Core Team:", coreTeam);

        vm.startBroadcast();

        // 1. ZK Infrastructure
        HonkVerifier honk = new HonkVerifier();
        Groth16Verifier groth16 = new Groth16Verifier();
        NullifierRegistry nullifierReg = new NullifierRegistry();
        PrivateDonationPool privatePool = new PrivateDonationPool(idrxAddr);

        // 2. ShariaReviewManager with groth16 verifier
        ShariaReviewManager srm = new ShariaReviewManager(
            payable(pmAddr),
            address(groth16)
        );

        // 3. ZKTCore orchestrator (wired to all tawf-gov contracts)
        ZKTCore dao = new ZKTCore(
            idrxAddr, receiptNFTAddr, votingNFTAddr,
            trackerAddr,
            pmAddr, vmgrAddr, address(srm),
            poolMgrAddr, escrowAddr, mmAddr,
            address(honk), address(nullifierReg),
            address(privatePool)
        );

        // 4. Grant ZKTCore roles on all sub-contracts
        //
        // NOTE: these are raw .call()s because the tawf-gov contracts are
        // consumed as pre-deployed addresses rather than typed instances. Every
        // one MUST be checked — a silently-failed grantRole produces a
        // deployment that looks successful and then reverts at runtime, which
        // is exactly the failure mode that makes a bad deploy hard to diagnose.

        // ProposalManager roles
        _grant(pmAddr, "ORGANIZER_ROLE", address(dao), "ProposalManager.ORGANIZER_ROLE");

        // Receipt NFT minter roles
        _grant(receiptNFTAddr, "MINTER_ROLE", address(dao), "DonationReceiptNFT.MINTER_ROLE");

        // VotingNFT roles
        _grant(votingNFTAddr, "MINTER_ROLE", address(dao), "VotingNFT.MINTER_ROLE");

        // ShariaReviewManager
        srm.grantRole(srm.SHARIA_COUNCIL_ROLE(), address(dao));
        srm.grantRole(srm.ADMIN_ROLE(), address(dao));

        // PoolManager
        _grant(poolMgrAddr, "ADMIN_ROLE", address(dao), "PoolManager.ADMIN_ROLE");

        // ZakatEscrowManager
        _grant(escrowAddr, "ADMIN_ROLE", address(dao), "ZakatEscrowManager.ADMIN_ROLE");

        // PrivateDonationPool
        privatePool.grantRole(privatePool.CORE_ROLE(), address(dao));

        // MilestoneManager
        _grant(mmAddr, "ORGANIZER_ROLE", address(dao), "MilestoneManager.ORGANIZER_ROLE");

        // ParticipationTracker
        _grant(trackerAddr, "TRACKER_ROLE", address(dao), "ParticipationTracker.TRACKER_ROLE");

        // Grant core team roles on ZKTCore
        dao.grantOrganizerRole(coreTeam);
        dao.grantShariaCouncilRole(coreTeam);
        dao.grantKYCOracleRole(coreTeam);

        // Cross-module permissions
        _grant(pmAddr, "VOTING_MANAGER_ROLE", vmgrAddr, "ProposalManager.VOTING_MANAGER_ROLE(VotingManager)");
        _grant(pmAddr, "VOTING_MANAGER_ROLE", address(srm), "ProposalManager.VOTING_MANAGER_ROLE(ShariaReviewManager)");
        _grant(pmAddr, "VOTING_MANAGER_ROLE", poolMgrAddr, "ProposalManager.VOTING_MANAGER_ROLE(PoolManager)");
        _grant(pmAddr, "VOTING_MANAGER_ROLE", escrowAddr, "ProposalManager.VOTING_MANAGER_ROLE(ZakatEscrowManager)");
        _grant(pmAddr, "MILESTONE_MANAGER_ROLE", mmAddr, "ProposalManager.MILESTONE_MANAGER_ROLE(MilestoneManager)");

        vm.stopBroadcast();

        console.log("\n=== V10 Deployed Addresses ===");
        console.log("ZKTCore:", address(dao));
        console.log("ShariaReviewManager:", address(srm));
        console.log("PrivateDonationPool:", address(privatePool));
        console.log("HonkVerifier:", address(honk));
        console.log("Groth16Verifier:", address(groth16));
        console.log("NullifierRegistry:", address(nullifierReg));

        // Fail loudly if the ZK layer ever silently becomes "operational"
        // without a real pairing check being generated. See the headers in
        // HonkVerifier.sol / Groth16Verifier.sol.
        console.log("");
        console.log("ZK STATUS: verifiers are fail-closed placeholders.");
        console.log("  HonkVerifier.isOperational()   =", honk.isOperational());
        console.log("  Groth16Verifier.isOperational() =", groth16.isOperational());
        console.log("  donateZK / donateZKPrivate WILL revert. This is expected.");
    }

    /**
     * @dev Grant `role` on `target` to `grantee`, reverting with a readable
     *      label if the call fails. Replaces fire-and-forget .call()s whose
     *      success bool was captured and then ignored.
     */
    function _grant(address target, string memory role, address grantee, string memory label) internal {
        (bool ok, bytes memory ret) = target.call(
            abi.encodeWithSignature("grantRole(bytes32,address)", keccak256(bytes(role)), grantee)
        );
        if (!ok) {
            console.log("FAILED grantRole:", label);
            if (ret.length > 0) {
                assembly { revert(add(ret, 0x20), mload(ret)) }
            }
            revert(string.concat("grantRole failed: ", label));
        }
    }
}
