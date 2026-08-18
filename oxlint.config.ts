import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

const electronFfi = {
  "eslint/no-bitwise": "off",
  "eslint/no-empty-function": "off",
  "eslint/no-use-before-define": "off",
  "promise/avoid-new": "off",
  "promise/no-callback-in-promise": "off",
  "promise/prefer-await-to-callbacks": "off",
  "promise/prefer-await-to-then": "off",
  "typescript/no-confusing-void-expression": "off",
  "typescript/no-floating-promises": "off",
  "typescript/no-unsafe-assignment": "off",
  "typescript/no-unsafe-return": "off",
  "typescript/no-unsafe-type-assertion": "off",
  "typescript/promise-function-async": "off",
  "typescript/strict-boolean-expressions": "off",
  "unicorn/consistent-function-scoping": "off",
  "unicorn/no-useless-undefined": "off",
  "unicorn/prefer-module": "off",
} as const;

export default defineConfig({
  extends: [core, react],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "**/release",
    "**/*.test.ts",
  ],
  overrides: [
    {
      files: ["src/renderer/src/components/ui/**/*.{ts,tsx}"],
      rules: {
        "eslint/func-style": "off",
        "eslint/no-use-before-define": "off",
        "eslint/sort-keys": "off",
        "jsx-a11y/click-events-have-key-events": "off",
        "jsx-a11y/no-noninteractive-element-interactions": "off",
        "jsx-a11y/prefer-tag-over-role": "off",
        "react/function-component-definition": "off",
        "typescript/no-unsafe-type-assertion": "off",
      },
    },
    {
      files: [
        "src/main/capture.ts",
        "src/shared/capture-match.ts",
        "src/main/dock-icon.ts",
        "src/main/index.ts",
        "src/preload/index.ts",
      ],
      rules: electronFfi,
    },
    {
      files: [
        "src/renderer/src/app.tsx",
        "src/renderer/src/components/detail-well.tsx",
        "src/renderer/src/components/settings-panel.tsx",
        "src/renderer/src/components/settings-keys.tsx",
        "src/renderer/src/components/dock-look.tsx",
        "src/renderer/src/components/capture-bind.tsx",
        "src/renderer/src/lib/use-slip-hotkeys.ts",
        "src/renderer/src/lib/section-menu.ts",
        "src/renderer/src/lib/slip-menu.ts",
        "src/renderer/src/components/section-picker.tsx",
        "src/renderer/src/components/inbox-pane.tsx",
      ],
      rules: {
        "eslint/complexity": "off",
        "promise/prefer-await-to-then": "off",
        "react/react-compiler": "off",
        "typescript/no-confusing-void-expression": "off",
        "typescript/no-floating-promises": "off",
        "typescript/promise-function-async": "off",
        "unicorn/no-useless-undefined": "off",
      },
    },
  ],
});
