import { customAlphabet } from "nanoid";

export const shortId = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  6
);
