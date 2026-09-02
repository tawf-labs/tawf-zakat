import {
  createPublicClient,
  http,
  parseAbiItem,
  type Hex,
  decodeEventLog,
  keccak256,
  toHex,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { CONTRACT_CONFIG } from "./config";
import { dbService } from "./db/index";
import { dataStore } from "./store";
import { eventBus } from "./ws";

// Known Role Hash Dictionary
export const KNOWN_ROLES: Record<string, string> = {
  "0x0000000000000000000000000000000000000000000000000000000000000000": "DEFAULT_ADMIN_ROLE",
  "0x59a1c48e5837ad7a7f3dcedcbe129bf3249ec4fbf651fd4f5e2600ead39fe2f5": "SHARIA_SUPERVISOR_ROLE",
  "0x3003ae5751e460db709762380ceeb0a0a748c8f2a9e2fe711468f692be74570c": "AUDITOR_ROLE",
  "0xe2b7fb3b832174769106daebcfd6d1970523240dda11281102db9363b83b0dc4": "RELAYER_ROLE",
};

// ABI items for event decoding
export const INDEXED_EVENT_ABIS = [
  parseAbiItem("event USDCDeposited(address indexed donor, uint256 amountUSDC, bool isAnonymous, bytes32 commitmentHash)"),
  parseAbiItem("event FiatBatchSettled(uint256 indexed batchId, bytes32 merkleRoot, uint256 totalAmountIDR)"),
  parseAbiItem("event DisbursementProposed(uint256 indexed proposalId, uint8 currencyType, uint256 amount, bytes32 beneficiaryHash, string ipfsProofCID)"),
  parseAbiItem("event DisbursementApproved(uint256 indexed proposalId, address indexed approver, uint256 currentApprovals)"),
  parseAbiItem("event DisbursementExecuted(uint256 indexed proposalId, uint8 currencyType, uint256 amount, bytes32 beneficiaryHash, string ipfsProofCID)"),
  parseAbiItem("event DisbursementCancelled(uint256 indexed proposalId, address indexed canceller, string reason)"),
  parseAbiItem("event AmilShareWithdrawn(address indexed to, uint256 amount)"),
  parseAbiItem("event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)"),
  parseAbiItem("event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)"),
];

export class IndexerEngine {
  private client: ReturnType<typeof createPublicClient>;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly contractAddress: Hex;
  private readonly startBlock: number = 304590800;
  private readonly chunkSize: number = 2000;
  private readonly pollIntervalMs: number = 10000;

  constructor() {
    this.client = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(CONTRACT_CONFIG.RPC_URL),
    });
    this.contractAddress = CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS as Hex;
  }

  public async syncOnce(): Promise<{
    fromBlock: number;
    toBlock: number;
    eventsProcessed: number;
  }> {
    const state = await dbService.getIndexerState();
    const currentL1Block = Number(await this.client.getBlockNumber());
    const fromBlock = Math.max(state.lastIndexedBlock + 1, this.startBlock);

    if (fromBlock > currentL1Block) {
      await dbService.updateIndexerState(currentL1Block, "SYNCED", 0);
      return { fromBlock, toBlock: currentL1Block, eventsProcessed: 0 };
    }

    const toBlock = Math.min(fromBlock + this.chunkSize, currentL1Block);
    let eventsProcessed = 0;

    try {
      const logs = await this.client.getLogs({
        address: this.contractAddress,
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock),
      });

      for (const log of logs) {
        const decoded = this.tryDecodeLog(log);
        if (decoded) {
          await this.processEvent(decoded, log);
          eventsProcessed++;
        }
      }

      await dbService.updateIndexerState(toBlock, "SYNCED", eventsProcessed);
    } catch (err: any) {
      console.warn(`[Indexer] Batch sync error (${fromBlock}-${toBlock}):`, err.message || err);
      await dbService.updateIndexerState(fromBlock - 1, "ERROR", 0);
    }

    return { fromBlock, toBlock, eventsProcessed };
  }

  public tryDecodeLog(log: any): { eventName: string; args: any } | null {
    for (const abiItem of INDEXED_EVENT_ABIS) {
      try {
        const decoded = decodeEventLog({
          abi: [abiItem],
          data: log.data,
          topics: log.topics,
        });
        return decoded;
      } catch {
        continue;
      }
    }
    return null;
  }

  public async processEvent(decoded: { eventName: string; args: any }, log: any) {
    const { eventName, args } = decoded;
    const txHash = log.transactionHash as string;
    const blockNumber = Number(log.blockNumber);
    const logIndex = Number(log.logIndex || 0);

    // 1. Log to onchain_events immutable audit table
    await dbService.recordOnchainEvent({
      txHash,
      blockNumber,
      logIndex,
      eventName,
      contractAddress: this.contractAddress,
      argsJson: JSON.stringify(args, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
      ),
    });

    console.log(`[Indexer] Processed on-chain event ${eventName} at block #${blockNumber} (tx: ${txHash.slice(0, 10)}...)`);

    // Broadcast generic indexed event
    eventBus.broadcast("ONCHAIN_EVENT_INDEXED", {
      eventName,
      txHash,
      blockNumber,
      logIndex,
    });

    // 2. State-specific domain updates
    switch (eventName) {
      case "USDCDeposited": {
        const donor = args.donor as string;
        const amountUSDC = Number(args.amountUSDC);
        const isAnonymous = Boolean(args.isAnonymous);
        const commitmentHash = args.commitmentHash as string;

        await dbService.recordUSDCDonation({
          txHash,
          donor,
          amountUSDC,
          isAnonymous,
          commitmentHash,
          blockNumber,
        });

        eventBus.broadcast("DONATION_RECEIVED", {
          currency: "USDC",
          donor,
          amountUSDC,
          isAnonymous,
          txHash,
        });
        break;
      }

      case "FiatBatchSettled": {
        const batchId = Number(args.batchId);
        const merkleRoot = args.merkleRoot as string;
        const totalAmountIDR = Number(args.totalAmountIDR);

        eventBus.broadcast("MERKLE_BATCH_SETTLED", {
          batchId,
          merkleRoot,
          totalAmountIDR,
          txHash,
        });
        break;
      }

      case "DisbursementProposed": {
        const proposalId = Number(args.proposalId);
        const memory = dataStore.proposals.get(proposalId);
        if (memory) {
          memory.txHash = txHash;
        }

        eventBus.broadcast("PROPOSAL_CREATED", {
          proposalId,
          txHash,
        });
        break;
      }

      case "DisbursementApproved": {
        const proposalId = Number(args.proposalId);
        const approver = args.approver as string;
        const count = Number(args.currentApprovals);

        const memory = dataStore.proposals.get(proposalId);
        if (memory) {
          memory.approvalCount = count;
          if (!memory.approvedBy.includes(approver)) {
            memory.approvedBy.push(approver);
          }
          if (count >= 2) {
            memory.status = "Approved";
          }
        }

        eventBus.broadcast("PROPOSAL_APPROVED", {
          proposalId,
          approver,
          currentApprovals: count,
          isQuorumMet: count >= 2,
          txHash,
        });
        break;
      }

      case "DisbursementExecuted": {
        const proposalId = Number(args.proposalId);
        const memory = dataStore.proposals.get(proposalId);
        if (memory) {
          memory.status = "Executed";
          memory.executedAt = new Date().toISOString();
        }

        eventBus.broadcast("PROPOSAL_EXECUTED", {
          proposalId,
          txHash,
        });
        break;
      }

      case "DisbursementCancelled": {
        const proposalId = Number(args.proposalId);
        const reason = args.reason as string;
        const memory = dataStore.proposals.get(proposalId);
        if (memory) {
          memory.status = "Cancelled";
          memory.cancelReason = reason;
        }

        eventBus.broadcast("PROPOSAL_CANCELLED", {
          proposalId,
          reason,
          txHash,
        });
        break;
      }

      case "RoleGranted": {
        const roleHash = (args.role as string).toLowerCase();
        const account = (args.account as string).toLowerCase();
        const roleName = KNOWN_ROLES[roleHash] || `CUSTOM_ROLE_${roleHash.slice(0, 8)}`;

        await dbService.grantRoleMember(roleHash, roleName, account, blockNumber, txHash);

        eventBus.broadcast("ROLE_MEMBERS_CHANGED", {
          action: "GRANTED",
          roleHash,
          roleName,
          account,
          txHash,
        });
        break;
      }

      case "RoleRevoked": {
        const roleHash = (args.role as string).toLowerCase();
        const account = (args.account as string).toLowerCase();

        await dbService.revokeRoleMember(roleHash, account, blockNumber, txHash);

        eventBus.broadcast("ROLE_MEMBERS_CHANGED", {
          action: "REVOKED",
          roleHash,
          account,
          txHash,
        });
        break;
      }
    }
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[Indexer] Background poller started for contract ${this.contractAddress} on Sepolia`);

    const poll = async () => {
      if (!this.isRunning) return;
      try {
        await this.syncOnce();
      } catch (err: any) {
        console.error("[Indexer] Polling cycle caught error:", err.message || err);
      }
      if (this.isRunning) {
        this.timer = setTimeout(poll, this.pollIntervalMs);
      }
    };

    poll();
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[Indexer] Background poller stopped");
  }
}

export const indexerEngine = new IndexerEngine();

// Allow running as a standalone worker process: `bun src/indexer.ts`
if (import.meta.main) {
  console.log("⚡ Starting Standalone Sepolia Indexer Worker Daemon (Production Mode)...");
  indexerEngine.start();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("Shutting down indexer worker...");
    indexerEngine.stop();
    process.exit(0);
  });
}
