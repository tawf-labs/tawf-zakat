export const CONTRACT_CONFIG = {
  ZAKAT_PROTOCOL_L1_ADDRESS:
    (process.env.ZAKAT_PROTOCOL_L1_ADDRESS as `0x${string}`) ||
    "0x0d6cec28a574aca41b879767b081f6f2b4e9a849",
  SEPOLIA_USDC_ADDRESS:
    (process.env.SEPOLIA_USDC_ADDRESS as `0x${string}`) ||
    "0x1f439a83354ae624a4e8acbc4e9873eaa2e1f852",
  CHAIN_ID: 421614,
  INDEXER_START_BLOCK: Number(process.env.INDEXER_START_BLOCK ?? 0),
  NETWORK_NAME: "Arbitrum Sepolia",
  RPC_URL: process.env.SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
  EXPLORER_URL: "https://sepolia.arbiscan.io",
};
