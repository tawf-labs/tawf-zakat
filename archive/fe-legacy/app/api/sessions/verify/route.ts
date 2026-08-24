import { NextRequest, NextResponse } from "next/server";
import { verifySessionCode } from "@/lib/relayer";

export async function POST(req: NextRequest) {
  const { code } = await req.json();
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }
  const token = await verifySessionCode(code);
  if (!token) {
    return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
  }
  return NextResponse.json({ token });
}
