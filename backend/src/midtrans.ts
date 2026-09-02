import crypto from "crypto";

export interface QRISChargeResult {
  trxId: string;
  amountIDR: number;
  qrString: string;
  qrUrl: string;
  isMock: boolean;
  expiresAt: string;
}

export function verifyMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
  signatureKey: string
): boolean {
  if (!orderId || !statusCode || !grossAmount || !serverKey || !signatureKey) {
    return false;
  }

  // Midtrans format: SHA512(order_id + status_code + gross_amount + ServerKey)
  const raw = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const computed = crypto.createHash("sha512").update(raw).digest("hex");
  return computed.toLowerCase() === signatureKey.toLowerCase();
}

export async function chargeQRIS(
  trxId: string,
  amountIDR: number,
  donorName: string
): Promise<QRISChargeResult> {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
  const baseUrl = isProduction
    ? "https://api.midtrans.com/v2/charge"
    : "https://api.sandbox.midtrans.com/v2/charge";

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins expiry

  if (serverKey && serverKey.trim() !== "" && !serverKey.includes("TESTKEY")) {
    try {
      const authHeader = `Basic ${Buffer.from(`${serverKey.trim()}:`).toString("base64")}`;
      const payload = {
        payment_type: "qris",
        transaction_details: {
          order_id: trxId,
          gross_amount: Math.round(amountIDR),
        },
        customer_details: {
          first_name: donorName || "Muzakki",
        },
        qris: {
          acquirer: "gopay",
        },
      };

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        const qrString = data.qr_string || `00020101021226500016ID.CO.MIDTRANS.WWW01189360099900000000000215${trxId}520453995303360540${amountIDR}5802ID5910TAWF ZAKAT6007JAKARTA6304`;
        const qrUrl =
          data.actions?.find((a: any) => a.name === "generate-qr-code")?.url ||
          `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrString)}`;

        return {
          trxId,
          amountIDR,
          qrString,
          qrUrl,
          isMock: false,
          expiresAt: data.expiry_time || expiresAt,
        };
      } else {
        const errText = await response.text();
        console.warn(`Midtrans API returned status ${response.status}: ${errText}. Falling back to sandbox generator.`);
      }
    } catch (err) {
      console.warn("Failed to reach Midtrans Sandbox API, using resilient mock generator:", err);
    }
  }

  // Resilient Sandbox Generator (Deterministic Mock for Tests / Offline Mode)
  const mockQrString = `00020101021226500016ID.CO.MIDTRANS.WWW01189360099900000000000215${trxId}520453995303360540${amountIDR}5802ID5910TAWF ZAKAT6007JAKARTA6304`;
  const mockQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(mockQrString)}`;

  return {
    trxId,
    amountIDR,
    qrString: mockQrString,
    qrUrl: mockQrUrl,
    isMock: true,
    expiresAt,
  };
}

export interface SnapTransactionResult {
  token: string;
  redirectUrl: string;
  trxId: string;
  amountIDR: number;
  isMock: boolean;
}

export async function createSnapTransaction(
  trxId: string,
  amountIDR: number,
  donorName: string
): Promise<SnapTransactionResult> {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
  const snapUrl = isProduction
    ? "https://app.midtrans.com/snap/v1/transactions"
    : "https://app.sandbox.midtrans.com/snap/v1/transactions";

  if (serverKey && serverKey.trim() !== "" && !serverKey.includes("TESTKEY")) {
    try {
      const authHeader = `Basic ${Buffer.from(`${serverKey.trim()}:`).toString("base64")}`;
      const payload = {
        transaction_details: {
          order_id: trxId,
          gross_amount: Math.round(amountIDR),
        },
        customer_details: {
          first_name: donorName || "Muzakki",
        },
      };

      const response = await fetch(snapUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        return {
          token: data.token,
          redirectUrl: data.redirect_url,
          trxId,
          amountIDR,
          isMock: false,
        };
      }
    } catch (err) {
      console.warn("Failed to create Midtrans Snap transaction, using mock:", err);
    }
  }

  // Fallback mock
  return {
    token: `mock-snap-token-${trxId}`,
    redirectUrl: `https://app.sandbox.midtrans.com/snap/v4/redirection/mock-${trxId}`,
    trxId,
    amountIDR,
    isMock: true,
  };
}

export async function checkMidtransStatus(orderId: string): Promise<{
  isSettled: boolean;
  status: string;
  grossAmount?: string;
  settlementTime?: string;
} | null> {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey || serverKey.trim() === "" || serverKey.includes("TESTKEY")) {
    return null;
  }

  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
  const baseUrl = isProduction
    ? `https://api.midtrans.com/v2/${orderId}/status`
    : `https://api.sandbox.midtrans.com/v2/${orderId}/status`;

  try {
    const authHeader = `Basic ${Buffer.from(`${serverKey.trim()}:`).toString("base64")}`;
    const response = await fetch(baseUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (response.ok) {
      const data = (await response.json()) as any;
      const status = data.transaction_status || "unknown";
      const isSettled = status === "settlement" || status === "capture";
      return {
        isSettled,
        status,
        grossAmount: data.gross_amount,
        settlementTime: data.settlement_time || data.transaction_time,
      };
    }
  } catch (err) {
    console.warn(`Failed to query Midtrans status for ${orderId}:`, err);
  }

  return null;
}
