import { describe, expect, it } from "bun:test";
import app from "../src/index";
import { dbService } from "../src/db/index";
import { IndexerEngine, KNOWN_ROLES } from "../src/indexer";
import { encodeEventTopics, parseAbiItem, toHex } from "viem";

describe("Ticket 01 — Embedded Viem Event Indexer & Database Persistence", () => {
  it("should return indexer health status via GET /api/indexer/status", async () => {
    const res = await app.fetch(new Request("http://localhost/api/indexer/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.indexer).toBeDefined();
    expect(typeof body.indexer.lastIndexedBlock).toBe("number");
  });

  it("should record and query on-chain events via GET /api/events", async () => {
    const mockTxHash = `0xmocktx_${Date.now()}`;
    await dbService.recordOnchainEvent({
      txHash: mockTxHash,
      blockNumber: 11569001,
      logIndex: 0,
      eventName: "USDCDeposited",
      contractAddress: "0x6014542ce8f759946aa6f3f9af54fb91685065a5",
      argsJson: JSON.stringify({
        donor: "0x5e9b652c4e8a013f6fab69f0b55377c408b59968",
        amountUSDC: "50000000",
        isAnonymous: false,
      }),
    });

    const res = await app.fetch(new Request("http://localhost/api/events?limit=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("should auto-record direct USDC donation via POST /api/donations/usdc", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/donations/usdc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: `0xusdc_deposit_${Date.now()}`,
          donor: "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968",
          amountUSDC: 100_000_000, // 100 USDC (6 decimals)
          isAnonymous: false,
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.trxId).toBeDefined();
    expect(body.trxId.startsWith("USDC-")).toBe(true);
  });

  it("should grant, persist, and query governance role members via GET /api/governance/roles", async () => {
    const testAuditorAddr = "0x1234567890123456789012345678901234567890";
    const auditorRoleHash = "0x3003ae5751e460db709762380ceeb0a0a748c8f2a9e2fe711468f692be74570c";

    await dbService.grantRoleMember(
      auditorRoleHash,
      "AUDITOR_ROLE",
      testAuditorAddr,
      11569100,
      `0xgrant_tx_${Date.now()}`
    );

    const res = await app.fetch(new Request("http://localhost/api/governance/roles"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.roles)).toBe(true);

    const found = body.roles.find(
      (r: any) => r.accountAddress.toLowerCase() === testAuditorAddr.toLowerCase()
    );
    expect(found).toBeDefined();
    expect(found.roleName).toBe("AUDITOR_ROLE");
    expect(found.isActive).toBe(true);
  });

  it("should correctly decode event log using IndexerEngine helper", () => {
    const engine = new IndexerEngine();
    const eventAbi = parseAbiItem(
      "event USDCDeposited(address indexed donor, uint256 amountUSDC, bool isAnonymous, bytes32 commitmentHash)"
    );

    const donorAddr = "0x5e9b652c4e8a013f6fab69f0b55377c408b59968";
    const topics = encodeEventTopics({
      abi: [eventAbi],
      eventName: "USDCDeposited",
      args: {
        donor: donorAddr as `0x${string}`,
      },
    });

    // Mock log structure
    const mockLog = {
      data: "0x0000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000",
      topics,
      blockNumber: 11569050n,
      transactionHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    };

    const decoded = engine.tryDecodeLog(mockLog);
    expect(decoded).toBeDefined();
    expect(decoded?.eventName).toBe("USDCDeposited");
  });
});
