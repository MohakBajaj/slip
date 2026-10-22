import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

const inheritedIgnores = Array.isArray(ultracite.ignorePatterns)
  ? ultracite.ignorePatterns
  : [];

export default defineConfig({
  ...ultracite,
  ignorePatterns: [...inheritedIgnores, "site/**"],
});
