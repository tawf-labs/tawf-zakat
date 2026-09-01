export const CONTRACT_CONFIG = {
  ZAKAT_PROTOCOL_L1_ADDRESS:
    (process.env.ZAKAT_PROTOCOL_L1_ADDRESS as `0x${string}`) ||
    "0x2d6fe1e81b633e8a310d1365524f4fb47024f7d7",
  SEPOLIA_USDC_ADDRESS: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  CHAIN_ID: 11155111,
  RPC_URL: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
};
