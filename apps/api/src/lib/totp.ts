import { authenticator } from "otplib";
import QRCode from "qrcode";

const ISSUER = "VPS Panel";

// Make verification a bit more forgiving for clock drift (±1 step = ±30s).
authenticator.options = {
  window: 1,
  step: 30,
};

export function generateTotpSecret(): string {
  return authenticator.generateSecret(20); // 20 bytes -> 32 base32 chars
}

export function buildOtpAuthUrl(secret: string, accountEmail: string): string {
  return authenticator.keyuri(accountEmail, ISSUER, secret);
}

export async function buildQrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, {
    margin: 1,
    width: 240,
    color: { dark: "#e2e8f0", light: "#0f172a" },
  });
}

export function verifyTotp(secret: string, token: string): boolean {
  const clean = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  return authenticator.check(clean, secret);
}
