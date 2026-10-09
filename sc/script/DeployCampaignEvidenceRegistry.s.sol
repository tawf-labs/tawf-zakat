// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script} from "forge-std/Script.sol";
import {CampaignEvidenceRegistry} from "../src/CampaignEvidenceRegistry.sol";

/// @notice Local Anvil only. No private key is read from the environment.
/// @dev Dry run: forge script script/DeployCampaignEvidenceRegistry.s.sol --rpc-url http://127.0.0.1:8545
/// Set CAMPAIGN_REGISTRY_ADMIN and CAMPAIGN_RECORDER_ADDRESS to distinct local accounts.
contract DeployCampaignEvidenceRegistry is Script {
    function run() external returns (CampaignEvidenceRegistry registry) {
        require(block.chainid == 31337, "Local chain only");
        address administrator = vm.envAddress("CAMPAIGN_REGISTRY_ADMIN");
        address recorder = vm.envAddress("CAMPAIGN_RECORDER_ADDRESS");
        vm.startBroadcast();
        registry = new CampaignEvidenceRegistry(administrator, recorder);
        vm.stopBroadcast();
    }
}
