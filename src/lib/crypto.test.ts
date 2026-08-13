import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  // Satisfy env validation for the module import chain.
  process.env.DATABASE_URL ??= "postgres://localhost:5432/test";
  process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-xx";
  process.env.APP_BASE_URL ??= "http://localhost:3000";
  process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("crypto envelope", () => {
  it("round-trips and produces distinct ciphertexts", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const a = encryptSecret("hunter2");
    const b = encryptSecret("hunter2");
    expect(a).not.toBe(b); // fresh IV each time
    expect(a.startsWith("v1:")).toBe(true);
    expect(decryptSecret(a)).toBe("hunter2");
    expect(decryptSecret(b)).toBe("hunter2");
  });

  it("rejects tampered ciphertext", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const c = encryptSecret("secret");
    const parts = c.split(":");
    parts[3] = Buffer.from("tampered!").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});
