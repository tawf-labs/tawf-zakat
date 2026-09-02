export const CONTRACT_CONFIG = {
  ZAKAT_PROTOCOL_L1_ADDRESS:
    (process.env.ZAKAT_PROTOCOL_L1_ADDRESS as `0x${string}`) ||
    "0x5f2394e6bc3dd842831c66253d4433f4f72b4e7b",
  SEPOLIA_USDC_ADDRESS:
    (process.env.SEPOLIA_USDC_ADDRESS as `0x${string}`) ||
    "0xdb10a1ee7a3a628353d0d29db60f99d46d41e30d",
  CHAIN_ID: 421614,
  NETWORK_NAME: "Arbitrum Sepolia",
  RPC_URL: process.env.SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
  EXPLORER_URL: "https://sepolia.arbiscan.io",
};
