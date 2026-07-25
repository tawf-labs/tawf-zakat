import { NextRequest, NextResponse } from "next/server";
import { verifyJWT, getRelayerClient } from "@/lib/relayer";
import { CONTRACT_ADDRESSES, ShariaReviewManagerABI } from "@/lib/abi";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
  }
  const payload = verifyJWT(auth.slice(7));
  if (!payload || Number(payload.exp) < Date.now()) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    const { publicClient } = getRelayerClient();
    const bundleCount = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.ShariaReviewManager,
      abi: ShariaReviewManagerABI,
      functionName: "bundleCount",
    }) as bigint;

    const bundles = [];
    for (let i = 1n; i <= bundleCount; i++) {
      const bundle = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.ShariaReviewManager,
        abi: ShariaReviewManagerABI,
        functionName: "shariaBundles",
        args: [i],
      });
      bundles.push(bundle);
    }

    return NextResponse.json({ bundles });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
