// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {Script} from "forge-std/Script.sol";
import {ReportEvidenceRegistry} from "../src/ReportEvidenceRegistry.sol";

/// Explicit admission authority only. Enrollment is a separately inspectable administration action.
contract DeployReportEvidenceRegistry is Script {
    function run() external returns (ReportEvidenceRegistry registry) {
        require(block.chainid == vm.envUint("REPORT_REGISTRY_CHAIN_ID"), "Wrong registry chain");
        address admission = vm.envAddress("REPORT_REGISTRY_ADMISSION_AUTHORITY");
        vm.startBroadcast();
        registry = new ReportEvidenceRegistry(admission);
        vm.stopBroadcast();
    }
}
