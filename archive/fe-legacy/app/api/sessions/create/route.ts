import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/relayer";

export async function POST(req: NextRequest) {
  const { adminAddress, bundleId } = await req.json();
  if (!adminAddress || !bundleId) {
    return NextResponse.json({ error: "Missing adminAddress or bundleId" }, { status: 400 });
  }
  const code = await createSession(adminAddress, bundleId);
  return NextResponse.json({ code, expiresIn: "24h" });
}
