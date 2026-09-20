import { describe, expect, it } from "vitest";
import { PHONE_MESSAGE, emailChangeSchema, profileSchema } from "./contracts";

describe("profileSchema", () => {
  it("normalises a US number and trims names", () => {
    const r = profileSchema.safeParse({ firstName: " Ada ", lastName: "Lovelace ", phone: "(555) 123-4567" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ firstName: "Ada", lastName: "Lovelace", phone: "+15551234567" });
  });
  it("rejects the placeholder, junk and empty phones with one message", () => {
    for (const phone of ["000", "+10000000000", "call me", ""]) {
      const r = profileSchema.safeParse({ firstName: "A", lastName: "B", phone });
      expect(r.success, phone).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toBe(PHONE_MESSAGE);
    }
  });
  it("requires both names", () => {
    expect(profileSchema.safeParse({ firstName: "  ", lastName: "B", phone: "+15551234567" }).success).toBe(false);
  });
});

describe("emailChangeSchema", () => {
  it("lowercases and rejects junk", () => {
    const r = emailChangeSchema.safeParse({ newEmail: " Ada@Example.COM " });
    expect(r.success && r.data.newEmail).toBe("ada@example.com");
    expect(emailChangeSchema.safeParse({ newEmail: "nope" }).success).toBe(false);
  });
});
