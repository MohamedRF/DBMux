import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const secret = (prefix: string) =>
  prefix + randomBytes(32).toString("base64url");
export class Vault {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("Master key must be 32 bytes");
  }
  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }
  open<T>(value: string): T {
    const data = Buffer.from(value, "base64");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12),
    );
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(data.subarray(28)),
        cipher.final(),
      ]).toString(),
    ) as T;
  }
}
export function passwordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function passwordMatches(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(digest, "hex"),
  );
}
