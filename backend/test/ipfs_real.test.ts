import { describe, it, expect } from "bun:test";
import app from "../src/index";
import { PINATA_DEDICATED_GATEWAY, getIpfsGatewayUrl } from "../src/ipfs";

describe("Real Pinata IPFS Storage & Multipart Uploads (ADR-0010)", () => {
  it("should return the dedicated pinata gateway info via GET /api/ipfs/gateway", async () => {
    const res = await app.fetch(new Request("http://localhost:3001/api/ipfs/gateway"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.dedicatedGateway).toBe("https://white-lazy-marten-351.mypinata.cloud/ipfs");
  });

  it("should format gateway URL with getIpfsGatewayUrl correctly", () => {
    const url = getIpfsGatewayUrl("QmTestHash1234567890");
    expect(url).toBe("https://white-lazy-marten-351.mypinata.cloud/ipfs/QmTestHash1234567890");

    const urlWithIpfsPrefix = getIpfsGatewayUrl("ipfs://QmTestHash1234567890");
    expect(urlWithIpfsPrefix).toBe("https://white-lazy-marten-351.mypinata.cloud/ipfs/QmTestHash1234567890");
  });

  it("should accept binary file upload via POST /api/ipfs/upload-file and return real CID", async () => {
    const formData = new FormData();
    const sampleBlob = new Blob(["BERITA ACARA SERAH TERIMA DANA ZAKAT 2026"], { type: "text/plain" });
    formData.append("file", sampleBlob, "bast_official_sign.txt");
    formData.append("name", "bast_official_sign.txt");

    const res = await app.fetch(
      new Request("http://localhost:3001/api/ipfs/upload-file", {
        method: "POST",
        body: formData,
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.cid).toBeDefined();
    expect(data.gatewayUrl).toContain("white-lazy-marten-351.mypinata.cloud/ipfs");
    expect(data.fileName).toBe("bast_official_sign.txt");
  }, 15000);
});
