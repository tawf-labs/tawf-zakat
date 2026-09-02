// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ZakatProtocolL1.sol";
import "../test/mocks/MockUSDC.sol";

contract DeployZakatProtocolL1 is Script {
    // Official Circle USDC on Ethereum Sepolia
    address public constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external returns (address protocolAddress, address usdcAddress) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("==================================================");
        console.log("Deploying ZakatProtocolL1 to Ethereum Sepolia");
        console.log("Deployer Address:", deployer);
        console.log("Deployer Balance:", deployer.balance);
        console.log("==================================================");

        vm.startBroadcast(deployerPrivateKey);

        // Check if we use official Sepolia USDC or deploy dedicated protocol USDC for free minting
        address targetUSDC = SEPOLIA_USDC;
        if (targetUSDC.code.length == 0) {
            console.log("Deploying MockUSDC on Sepolia for protocol testing...");
            MockUSDC mock = new MockUSDC();
            mock.mint(deployer, 1_000_000 * 1e6); // 1,000,000 USDC
            targetUSDC = address(mock);
            console.log("MockUSDC Deployed at:", targetUSDC);
        } else {
            console.log("Using existing Sepolia USDC at:", targetUSDC);
        }

        ZakatProtocolL1 protocol = new ZakatProtocolL1(
            targetUSDC,
            deployer, // Admin
            deployer, // Relayer
            deployer, // DPS
            deployer  // Auditor
        );

        vm.stopBroadcast();

        protocolAddress = address(protocol);
        usdcAddress = targetUSDC;

        console.log("==================================================");
        console.log("ZakatProtocolL1 Deployed Successfully!");
        console.log("Protocol Contract Address:", protocolAddress);
        console.log("USDC Contract Address:    ", usdcAddress);
        console.log("==================================================");
    }
}
