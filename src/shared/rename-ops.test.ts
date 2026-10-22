import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { BUNDLE_ID, PRODUCT_APP, PRODUCT_NAME } from "./product";
import { releaseDmgName, releaseZipName } from "./update";

const text = (file: string): string => readFileSync(file, "utf8");

test("release names, the bundle id, and the app name agree", () => {
  const version = "1.2.3";
  const zip = releaseZipName(version);
  const dmg = releaseDmgName(version);
  const builder = text("electron-builder.yml");
  const pack = text("scripts/package-mac.sh");
  const publish = text("scripts/publish-release.sh");
  const workflow = text(".github/workflows/release.yml");
  expect(BUNDLE_ID).toBe("dev.mohak.jot");
  expect(builder).toContain(`appId: ${BUNDLE_ID}`);
  expect(builder).toContain(`productName: ${PRODUCT_NAME}`);
  expect(builder).toContain("artifactName: Jot-${version}-${arch}-mac.${ext}");
  expect(builder).toContain("artifactName: Jot-${version}.${ext}");
  expect(builder).not.toContain("dev.mohak.slip");
  expect(pack).toContain(`dist/mac-arm64/${PRODUCT_APP}`);
  expect(pack).toContain(`CFBundleIdentifier`);
  expect(pack).toContain(BUNDLE_ID);
  expect(pack).toContain(zip.replace(version, "*").replace("1.2.3", "*"));
  expect(publish).toContain("dist/Jot-${version}.dmg");
  expect(publish).toContain("dist/Jot-${version}-arm64-mac.zip");
  expect(publish).toContain("dist/latest.json");
  expect(publish).toContain("dist/SHA256SUMS");
  expect(workflow).toContain("dist/*.dmg");
  expect(workflow).toContain("dist/*.zip");
  expect(workflow).toContain("dist/latest.json");
  expect(workflow).toContain("dist/SHA256SUMS");
  expect(zip).toBe(`Jot-${version}-arm64-mac.zip`);
  expect(dmg).toBe(`Jot-${version}.dmg`);
});

test("single instance and quit follow the Jot app name", () => {
  const index = text("src/main/index.ts");
  expect(index).toContain("app.setName(PRODUCT_NAME)");
  expect(index).not.toContain('app.setName("Slip")');
  expect(index).toContain('app.on("before-quit"');
  expect(index).not.toContain('requestSingleInstanceLock("slip")');
});
