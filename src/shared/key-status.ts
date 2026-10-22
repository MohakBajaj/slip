export type KeyStatus = "absent" | "reenter" | "saved";

export const KEY_REENTER =
  "Jot can't read the saved AI Gateway key. Enter it again.";

export const interpretStoredKey = (input: {
  bytes: Buffer | null;
  decrypt: (bytes: Buffer) => string;
}): { status: KeyStatus; value: string } => {
  if (input.bytes === null) {
    return { status: "absent", value: "" };
  }
  try {
    const value = input.decrypt(input.bytes);
    if (value.length === 0) {
      return { status: "reenter", value: "" };
    }
    return { status: "saved", value };
  } catch {
    return { status: "reenter", value: "" };
  }
};
