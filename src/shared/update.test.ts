import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { sanitizeSettings } from "./types";
import {
  applyUpdateScript,
  assessDownload,
  BUNDLE_ID,
  buildManifest,
  bundleAccepted,
  bundleFromExecutable,
  classifyReleaseUrl,
  clipNotes,
  compareVersions,
  decideUpdate,
  describeInstallTarget,
  manifestUrl,
  parseManifest,
  releaseZipUrl,
  signingMode,
  zipEntryAllowed,
} from "./update";

const sha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

const manifest = buildManifest({
  minimumMacOS: "12.0",
  notes: "### Fixed\n\n- Menu bar.",
  sha256: sha256("zip-bytes"),
  size: 128,
  version: "1.0.5",
});

describe("compareVersions", () => {
  test("compares numeric segments", () => {
    expect(compareVersions("1.0.4", "1.0.5")).toBe(-1);
    expect(compareVersions("1.0.9", "1.0.10")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.2.0", "1.2")).toBe(0);
    expect(compareVersions("12.0", "12.0.0")).toBe(0);
    expect(compareVersions("1.0.4", "1.0.4")).toBe(0);
  });

  test("rejects anything that is not a version", () => {
    expect(compareVersions("1.0.4-beta", "1.0.5")).toBeNull();
    expect(compareVersions("v1.0.4", "1.0.4")).toBeNull();
  });
});

describe("manifest", () => {
  test("accepts a manifest for this repo's arm64 zip", () => {
    const parsed = parseManifest(manifest);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manifest.zip).toBe(releaseZipUrl("1.0.5"));
      expect(parsed.manifest.sha256).toBe(manifest.sha256);
    }
  });

  test("normalizes checksum case and rejects other hosts", () => {
    const parsed = parseManifest({
      ...manifest,
      sha256: manifest.sha256.toUpperCase(),
    });
    expect(parsed.ok).toBe(true);
    expect(
      parseManifest({
        ...manifest,
        zip: "https://example.com/Slip-1.0.5-arm64-mac.zip",
      }).ok
    ).toBe(false);
    expect(
      parseManifest({
        ...manifest,
        zip: releaseZipUrl("1.0.4"),
      }).ok
    ).toBe(false);
    expect(
      parseManifest({
        ...manifest,
        zip: `http://github.com/MohakBajaj/slip/releases/download/v1.0.5/Slip-1.0.5-arm64-mac.zip`,
      }).ok
    ).toBe(false);
  });

  test("rejects a short checksum, a huge size, and a non-object", () => {
    expect(parseManifest({ ...manifest, sha256: "abc" }).ok).toBe(false);
    expect(parseManifest({ ...manifest, size: 0 }).ok).toBe(false);
    expect(parseManifest({ ...manifest, size: 900_000_000 }).ok).toBe(false);
    expect(parseManifest(null).ok).toBe(false);
    expect(parseManifest([]).ok).toBe(false);
  });

  test("only fetches the repo release over https", () => {
    expect(classifyReleaseUrl(manifestUrl(), "manifest")).toBe(true);
    expect(classifyReleaseUrl(releaseZipUrl("1.0.5"), "zip")).toBe(true);
    expect(
      classifyReleaseUrl(
        "https://release-assets.githubusercontent.com/asset/1",
        "redirect"
      )
    ).toBe(true);
    expect(
      classifyReleaseUrl(
        "https://release-assets.githubusercontent.com/asset/1",
        "manifest"
      )
    ).toBe(false);
    expect(
      classifyReleaseUrl("https://evil.example/latest.json", "redirect")
    ).toBe(false);
    expect(
      classifyReleaseUrl(
        "https://github.com/other/slip/releases/latest/download/latest.json",
        "manifest"
      )
    ).toBe(false);
    expect(
      classifyReleaseUrl(
        "https://user:pass@github.com/MohakBajaj/slip/releases/latest/download/latest.json",
        "manifest"
      )
    ).toBe(false);
    expect(classifyReleaseUrl("http://127.0.0.1/latest.json", "manifest")).toBe(
      false
    );
  });
});

describe("decideUpdate", () => {
  const base = {
    autoCheck: true,
    busy: false,
    currentVersion: "1.0.4",
    macOSVersion: "15.1",
    manual: false,
    manifest,
  };

  test("prompts only when the manifest is newer and the Mac is new enough", () => {
    expect(decideUpdate(base)).toEqual({ kind: "prompt" });
    expect(decideUpdate({ ...base, macOSVersion: "12.0" })).toEqual({
      kind: "prompt",
    });
    expect(decideUpdate({ ...base, macOSVersion: "11.7" })).toEqual({
      kind: "skip",
      reason: "os",
    });
  });

  test("stays quiet when automatic checks are off, unless asked", () => {
    expect(decideUpdate({ ...base, autoCheck: false })).toEqual({
      kind: "skip",
      reason: "auto-off",
    });
    expect(decideUpdate({ ...base, autoCheck: false, manual: true })).toEqual({
      kind: "prompt",
    });
  });

  test("does not downgrade or interrupt a capture", () => {
    expect(decideUpdate({ ...base, currentVersion: "1.0.5" })).toEqual({
      kind: "current",
    });
    expect(decideUpdate({ ...base, currentVersion: "1.0.6" })).toEqual({
      kind: "current",
    });
    expect(decideUpdate({ ...base, busy: true })).toEqual({
      kind: "skip",
      reason: "busy",
    });
    expect(decideUpdate({ ...base, busy: true, manual: true })).toEqual({
      kind: "prompt",
    });
  });

  test("skips a current version that is not a version", () => {
    expect(decideUpdate({ ...base, currentVersion: "dev" })).toEqual({
      kind: "skip",
      reason: "invalid-version",
    });
  });
});

describe("assessDownload", () => {
  test("accepts a matching checksum and size", () => {
    expect(
      assessDownload({
        actualSha256: manifest.sha256.toUpperCase(),
        actualSize: manifest.size,
        expectedSha256: manifest.sha256,
        expectedSize: manifest.size,
      })
    ).toEqual({ ok: true });
  });

  test("aborts when the checksum does not match", () => {
    const flipped = manifest.sha256.replace(/^./u, "0");
    expect(
      assessDownload({
        actualSha256: flipped,
        actualSize: manifest.size,
        expectedSha256: manifest.sha256,
        expectedSize: manifest.size,
      })
    ).toEqual({ ok: false, reason: "checksum" });
  });

  test("aborts when the size does not match", () => {
    expect(
      assessDownload({
        actualSha256: manifest.sha256,
        actualSize: manifest.size + 1,
        expectedSha256: manifest.sha256,
        expectedSize: manifest.size,
      })
    ).toEqual({ ok: false, reason: "size" });
  });
});

describe("bundle and install target", () => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.5</string>
</dict></plist>`;

  test("reads the bundle id and version", () => {
    expect(bundleAccepted(plist, { id: BUNDLE_ID, version: "1.0.5" })).toBe(
      true
    );
    expect(bundleAccepted(plist, { id: BUNDLE_ID, version: "1.0.4" })).toBe(
      false
    );
    expect(bundleAccepted(plist, { id: "other.app", version: "1.0.5" })).toBe(
      false
    );
  });

  test("finds Slip.app from the executable path", () => {
    expect(
      bundleFromExecutable("/Applications/Slip.app/Contents/MacOS/Slip")
    ).toBe("/Applications/Slip.app");
    expect(
      bundleFromExecutable("/Users/me/Desktop/Slip.app/Contents/MacOS/Slip")
    ).toBe("/Users/me/Desktop/Slip.app");
    expect(
      bundleFromExecutable("/Applications/Other.app/Contents/MacOS/Other")
    ).toBeNull();
  });

  test("allows a writable copy and explains the ones it cannot replace", () => {
    expect(describeInstallTarget("/Applications/Slip.app", true).ok).toBe(true);
    expect(describeInstallTarget("/Users/me/Slip.app", true).ok).toBe(true);
    const locked = describeInstallTarget("/Applications/Slip.app", false);
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.message).toContain("isn't writable");
    }
    const image = describeInstallTarget("/Volumes/Slip/Slip.app", false);
    expect(image.ok).toBe(false);
    if (!image.ok) {
      expect(image.message).toContain("disk image");
    }
    const translocated = describeInstallTarget(
      "/private/var/folders/ab/AppTranslocation/CD/d/Slip.app",
      true
    );
    expect(translocated.ok).toBe(false);
    if (!translocated.ok) {
      expect(translocated.message).toContain("temporary copy");
    }
  });

  test("keeps zip entries inside Slip.app", () => {
    expect(zipEntryAllowed("Slip.app/Contents/Info.plist")).toBe(true);
    expect(zipEntryAllowed("Slip.app/")).toBe(true);
    expect(zipEntryAllowed("../Slip.app/Contents/Info.plist")).toBe(false);
    expect(zipEntryAllowed("/Slip.app/Contents/Info.plist")).toBe(false);
    expect(zipEntryAllowed("__MACOSX/Slip.app")).toBe(false);
    expect(zipEntryAllowed("Slip.app/../../etc/passwd")).toBe(false);
  });
});

describe("notes and signing mode", () => {
  test("clips long notes", () => {
    expect(clipNotes("  hello  ")).toBe("hello");
    expect(clipNotes("")).toBe("No release notes.");
    expect(clipNotes("abcdef", 4)).toBe("abcd…");
  });

  test("signing mode follows the two secrets together", () => {
    expect(signingMode(undefined, undefined)).toBe("adhoc");
    expect(signingMode("  \n", "")).toBe("adhoc");
    expect(signingMode("Y2VydA==", "secret")).toBe("stable");
    expect(signingMode("Y2VydA==", "")).toBe("incomplete");
    expect(signingMode("", "secret")).toBe("incomplete");
  });

  test("the sign script reports the same mode", () => {
    const report = (env: Record<string, string>): string =>
      execFileSync("node", ["scripts/sign-mac.mjs", "--mode"], {
        encoding: "utf8",
        env: { ...process.env, CSC_KEY_PASSWORD: "", CSC_LINK: "", ...env },
      }).trim();
    expect(report({})).toBe("adhoc");
    expect(report({ CSC_KEY_PASSWORD: "secret", CSC_LINK: "Y2VydA==" })).toBe(
      "stable"
    );
    expect(() => report({ CSC_LINK: "Y2VydA==" })).toThrow();
  });

  test("the swap script waits, checks the checksum location, and strips quarantine", () => {
    const script = applyUpdateScript();
    const quarantine = script.lastIndexOf("xattr -dr com.apple.quarantine");
    const open = script.lastIndexOf('open "$dest"');
    const refuse = script.indexOf("refusing to replace");
    const remove = script.indexOf('rm -rf "$dest"');
    expect(script).toContain('kill -0 "$pid"');
    expect(script).toContain("slip-update-");
    expect(script).toContain("Contents/Resources/bin/$bin");
    expect(script).toContain("parakeet-cli slip-cleanup");
    expect(refuse).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(refuse);
    expect(quarantine).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(quarantine);
  });
});

describe("check for updates setting", () => {
  test("defaults on and keeps an explicit off", () => {
    expect(sanitizeSettings({}).checkUpdates).toBe(true);
    expect(sanitizeSettings({ checkUpdates: false }).checkUpdates).toBe(false);
    expect(sanitizeSettings({ checkUpdates: "yes" }).checkUpdates).toBe(true);
  });
});
