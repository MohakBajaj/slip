import { expect, test } from "bun:test";

import { interpretStoredKey, KEY_REENTER } from "./key-status";

test("a decrypt failure keeps the ciphertext and asks for the key again", () => {
  const stored = Buffer.from("slip-keychain-ciphertext");
  const read = interpretStoredKey({
    bytes: stored,
    decrypt: () => {
      throw new Error("keychain ACL");
    },
  });
  expect(read.status).toBe("reenter");
  expect(read.value).toBe("");
  expect(stored.equals(Buffer.from("slip-keychain-ciphertext"))).toBe(true);
  expect(KEY_REENTER).toContain("still on disk");
  expect(
    interpretStoredKey({
      bytes: null,
      decrypt: () => "unused",
    }).status
  ).toBe("absent");
  expect(
    interpretStoredKey({
      bytes: Buffer.from("ok"),
      decrypt: () => "gateway-key",
    })
  ).toEqual({ status: "saved", value: "gateway-key" });
});
