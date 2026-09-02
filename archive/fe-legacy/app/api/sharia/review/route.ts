import { NextRequest, NextResponse } from "next/server";
import { verifyJWT, getRelayerClient } from "@/lib/relayer";
import { CONTRACT_ADDRESSES, ZKTCoreABI } from "@/lib/abi";
import { encodeFunctionData } from "viem";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
  }
  const payload = verifyJWT(auth.slice(7));
  if (!payload || Number(payload.exp) < Date.now()) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const { bundleId, proposalId, approved, campaignType, proofHash } = await req.json();
  if (!bundleId || !proposalId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const { walletClient, account, publicClient } = getRelayerClient();

    const data = encodeFunctionData({
      abi: ZKTCoreABI,
      functionName: "reviewProposal",
      args: [BigInt(bundleId), BigInt(proposalId), Boolean(approved), Number(campaignType || 0), proofHash || "0x0000000000000000000000000000000000000000000000000000000000000000"],
    });

    const hash = await walletClient.sendTransaction({
      to: CONTRACT_ADDRESSES.ZKTCore,
      data,
      account,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return NextResponse.json({ success: true, txHash: hash });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
