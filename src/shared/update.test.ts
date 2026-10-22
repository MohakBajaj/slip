import { describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
  noticeForManifestFailure,
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
    expect(compareVersions("1.0.5", "1.0.6")).toBe(-1);
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

describe("manifest check failure", () => {
  const missing = new Error("status 404");

  test("a 404 for a missing manifest means up to date", () => {
    expect(
      noticeForManifestFailure({
        error: missing,
        manual: true,
        url: manifestUrl(),
      })
    ).toEqual({ kind: "current" });
    expect(
      noticeForManifestFailure({
        error: missing,
        manual: false,
        url: manifestUrl(),
      })
    ).toEqual({ kind: "current" });
  });

  test("a network error during a background check stays silent", () => {
    const detail = `Slip couldn't read ${manifestUrl()} (network error).`;
    expect(
      noticeForManifestFailure({
        error: new Error("getaddrinfo ENOTFOUND github.com"),
        manual: false,
        url: manifestUrl(),
      })
    ).toEqual({ kind: "silent", log: detail });
    expect(
      noticeForManifestFailure({
        error: new Error("timeout"),
        manual: false,
        url: manifestUrl(),
      })
    ).toEqual({ kind: "silent", log: detail });
    expect(
      noticeForManifestFailure({
        error: new Error("status 500"),
        manual: false,
        url: manifestUrl(),
      }).kind
    ).toBe("silent");
  });

  test("a manual check names the manifest url and what failed", () => {
    expect(
      noticeForManifestFailure({
        error: new Error("status 503"),
        manual: true,
        url: manifestUrl(),
      })
    ).toEqual({
      detail: `Slip couldn't read ${manifestUrl()} (HTTP 503).`,
      kind: "dialog",
      message: "Couldn't check for updates",
    });
    expect(
      noticeForManifestFailure({
        error: new Error("connect ECONNREFUSED 140.82.112.3:443"),
        manual: true,
        url: manifestUrl(),
      })
    ).toEqual({
      detail: `Slip couldn't read ${manifestUrl()} (network error).`,
      kind: "dialog",
      message: "Couldn't check for updates",
    });
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

  test("a 1.0.5 install prompts for 1.0.6", () => {
    const next = buildManifest({
      minimumMacOS: "12.0",
      notes: "Slip 1.0.6.",
      sha256: sha256("zip-bytes"),
      size: 128,
      version: "1.0.6",
    });
    expect(next.zip).toBe(releaseZipUrl("1.0.6"));
    expect(
      decideUpdate({
        ...base,
        currentVersion: "1.0.5",
        manifest: next,
      })
    ).toEqual({ kind: "prompt" });
    expect(
      assessDownload({
        actualSha256: next.sha256.toUpperCase(),
        actualSize: next.size,
        expectedSha256: next.sha256,
        expectedSize: next.size,
      })
    ).toEqual({ ok: true });
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

  test("the swap replaces the app and finishes a move that stopped halfway", () => {
    const root = mkdtempSync(path.join(tmpdir(), "slip-update-"));
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    const stub = (name: string, body: string): void => {
      const file = path.join(bin, name);
      writeFileSync(file, body);
      chmodSync(file, 0o755);
    };
    stub("ditto", '#!/bin/sh\ncp -R "$1" "$2"\n');
    stub("xattr", "#!/bin/sh\nexit 0\n");
    stub("open", '#!/bin/sh\ntouch "$1/.opened"\n');
    const app = (dir: string, marker: string): void => {
      const bins = path.join(dir, "Contents", "Resources", "bin");
      mkdirSync(bins, { recursive: true });
      writeFileSync(path.join(bins, "parakeet-cli"), marker);
      writeFileSync(path.join(bins, "slip-cleanup"), marker);
      writeFileSync(path.join(dir, "marker"), marker);
    };
    const work = path.join(root, "work");
    const src = path.join(work, "Slip.app");
    const dest = path.join(root, "Slip.app");
    app(src, "new");
    app(dest, "old");
    const script = path.join(root, "swap.sh");
    writeFileSync(script, applyUpdateScript());
    chmodSync(script, 0o755);
    execFileSync(script, ["999999", src, dest, work], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    expect(readFileSync(path.join(dest, "marker"), "utf8")).toBe("new");
    expect(existsSync(path.join(dest, ".opened"))).toBe(true);
    expect(existsSync(`${dest}.slip-old`)).toBe(false);
    expect(existsSync(work)).toBe(false);

    const stage = `${dest}.slip-new`;
    const aside = `${dest}.slip-old`;
    app(stage, "staged");
    app(aside, "aside");
    rmSync(dest, { force: true, recursive: true });
    const again = path.join(root, "swap-again.sh");
    writeFileSync(again, applyUpdateScript());
    chmodSync(again, 0o755);
    const parked = path.join(root, "slip-update-park");
    mkdirSync(parked);
    execFileSync(again, ["999999", src, dest, parked], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    expect(readFileSync(path.join(dest, "marker"), "utf8")).toBe("staged");
    expect(existsSync(stage)).toBe(false);
    expect(existsSync(aside)).toBe(false);
    expect(existsSync(path.join(dest, ".opened"))).toBe(true);
    rmSync(root, { force: true, recursive: true });
  });

  test("a failed swap reopens the old app", () => {
    const root = mkdtempSync(path.join(tmpdir(), "slip-update-fail-"));
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    const stub = (name: string, body: string): void => {
      const file = path.join(bin, name);
      writeFileSync(file, body);
      chmodSync(file, 0o755);
    };
    stub("xattr", "#!/bin/sh\nexit 0\n");
    stub("open", '#!/bin/sh\ntouch "$1/.opened"\n');
    const realMv = '#!/bin/sh\nexec /bin/mv "$@"\n';
    const app = (dir: string, marker: string, bins = true): void => {
      mkdirSync(dir, { recursive: true });
      if (bins) {
        const tools = path.join(dir, "Contents", "Resources", "bin");
        mkdirSync(tools, { recursive: true });
        writeFileSync(path.join(tools, "parakeet-cli"), marker);
        writeFileSync(path.join(tools, "slip-cleanup"), marker);
      }
      writeFileSync(path.join(dir, "marker"), marker);
    };
    const run = (name: string): { dest: string; stage: string } => {
      const dir = path.join(root, name);
      mkdirSync(dir);
      const work = path.join(dir, "slip-update-work");
      const src = path.join(work, "Slip.app");
      const dest = path.join(dir, "Slip.app");
      app(src, "new");
      app(dest, "old");
      const script = path.join(dir, "swap.sh");
      writeFileSync(script, applyUpdateScript());
      chmodSync(script, 0o755);
      let status = 0;
      try {
        execFileSync(script, ["999999", src, dest, work], {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        });
      } catch (error) {
        status = (error as { status?: number }).status ?? 0;
      }
      expect(status).toBe(1);
      expect(readFileSync(path.join(dest, "marker"), "utf8")).toBe("old");
      expect(existsSync(path.join(dest, ".opened"))).toBe(true);
      expect(existsSync(path.join(dest, "partial"))).toBe(false);
      return { dest, stage: `${dest}.slip-new` };
    };

    stub("ditto", "#!/bin/sh\nexit 1\n");
    stub("mv", realMv);
    const copied = run("copy");
    expect(existsSync(copied.stage)).toBe(false);

    stub("ditto", '#!/bin/sh\nmkdir -p "$2"\nprintf "%s" new > "$2/marker"\n');
    const staged = run("tools");
    expect(existsSync(staged.stage)).toBe(false);

    stub("ditto", '#!/bin/sh\ncp -R "$1" "$2"\n');
    stub(
      "mv",
      '#!/bin/sh\ncase "$2" in *.slip-old) exit 1 ;; esac\nexec /bin/mv "$@"\n'
    );
    const moved = run("aside");
    expect(existsSync(moved.stage)).toBe(false);

    stub(
      "ditto",
      '#!/bin/sh\ncase "$2" in *.slip-new) cp -R "$1" "$2" ;; *) mkdir -p "$2"; echo partial > "$2/partial"; exit 1 ;; esac\n'
    );
    stub(
      "mv",
      '#!/bin/sh\ncase "$1" in *.slip-new) case "$2" in *.slip-new) ;; *) exit 1 ;; esac ;; esac\nexec /bin/mv "$@"\n'
    );
    const both = run("both");
    expect(existsSync(both.stage)).toBe(false);
    rmSync(root, { force: true, recursive: true });
  });

  test("the swap gives up when Slip is still running", () => {
    const root = mkdtempSync(path.join(tmpdir(), "slip-update-wait-"));
    const log = path.join(root, "update.log");
    const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
    const app = (dir: string, marker: string): void => {
      const bins = path.join(dir, "Contents", "Resources", "bin");
      mkdirSync(bins, { recursive: true });
      writeFileSync(path.join(bins, "parakeet-cli"), marker);
      writeFileSync(path.join(bins, "slip-cleanup"), marker);
      writeFileSync(path.join(dir, "marker"), marker);
    };
    const work = path.join(root, "slip-update-work");
    const src = path.join(work, "Slip.app");
    const dest = path.join(root, "Slip.app");
    app(src, "new");
    app(dest, "old");
    const script = path.join(root, "swap.sh");
    writeFileSync(script, applyUpdateScript());
    chmodSync(script, 0o755);
    let status = 0;
    try {
      execFileSync(script, [String(sleeper.pid), src, dest, work], {
        env: {
          ...process.env,
          SLIP_APPLY_LOG: log,
          SLIP_APPLY_WAIT_SECONDS: "0",
        },
      });
    } catch (error) {
      status = (error as { status?: number }).status ?? 0;
    } finally {
      sleeper.kill();
    }
    expect(status).toBe(1);
    expect(readFileSync(path.join(dest, "marker"), "utf8")).toBe("old");
    expect(existsSync(script)).toBe(false);
    expect(existsSync(work)).toBe(false);
    expect(readFileSync(log, "utf8")).toContain(
      `giving up after 0s waiting for pid ${sleeper.pid}`
    );
    rmSync(root, { force: true, recursive: true });
  });

  test("stopping the swap midway puts the app back and removes the workdir", () => {
    const root = mkdtempSync(path.join(tmpdir(), "slip-update-term-"));
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    const stub = (name: string, body: string): void => {
      const file = path.join(bin, name);
      writeFileSync(file, body);
      chmodSync(file, 0o755);
    };
    stub("ditto", '#!/bin/sh\ncp -R "$1" "$2"\n');
    stub("xattr", "#!/bin/sh\nexit 0\n");
    stub("open", "#!/bin/sh\nexit 0\n");
    stub(
      "mv",
      '#!/bin/sh\ncase "$2" in *.slip-old) /bin/mv "$@"; kill -TERM "$PPID"; exit 0 ;; esac\nexec /bin/mv "$@"\n'
    );
    const app = (dir: string, marker: string): void => {
      const bins = path.join(dir, "Contents", "Resources", "bin");
      mkdirSync(bins, { recursive: true });
      writeFileSync(path.join(bins, "parakeet-cli"), marker);
      writeFileSync(path.join(bins, "slip-cleanup"), marker);
      writeFileSync(path.join(dir, "marker"), marker);
    };
    const work = path.join(root, "slip-update-work");
    const src = path.join(work, "Slip.app");
    const dest = path.join(root, "Slip.app");
    app(src, "new");
    app(dest, "old");
    const script = path.join(root, "swap.sh");
    writeFileSync(script, applyUpdateScript());
    chmodSync(script, 0o755);
    let status = 0;
    try {
      execFileSync(script, ["999999", src, dest, work], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      });
    } catch (error) {
      status = (error as { status?: number }).status ?? 0;
    }
    expect(status).toBe(1);
    expect(readFileSync(path.join(dest, "marker"), "utf8")).toBe("old");
    expect(existsSync(work)).toBe(false);
    expect(existsSync(script)).toBe(false);
    expect(existsSync(`${dest}.slip-old`)).toBe(false);
    rmSync(root, { force: true, recursive: true });
  });

  test("aborting while Slip is running removes the workdir", () => {
    const root = mkdtempSync(path.join(tmpdir(), "slip-update-abort-"));
    const log = path.join(root, "update.log");
    const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
    const work = path.join(root, "slip-update-work");
    const dest = path.join(root, "Slip.app");
    mkdirSync(path.join(dest, "Contents"), { recursive: true });
    writeFileSync(path.join(dest, "marker"), "old");
    mkdirSync(work);
    const script = path.join(root, "swap.sh");
    writeFileSync(script, applyUpdateScript());
    chmodSync(script, 0o755);
    let status = 0;
    try {
      execFileSync(
        script,
        [String(sleeper.pid), path.join(work, "Slip.app"), dest, work],
        {
          env: {
            ...process.env,
            SLIP_APPLY_LOG: log,
            SLIP_APPLY_WAIT_SECONDS: "0",
          },
        }
      );
    } catch (error) {
      status = (error as { status?: number }).status ?? 0;
    } finally {
      sleeper.kill();
    }
    expect(status).toBe(1);
    expect(readFileSync(path.join(dest, "marker"), "utf8")).toBe("old");
    expect(existsSync(work)).toBe(false);
    expect(existsSync(script)).toBe(false);
    expect(readFileSync(log, "utf8")).toContain("did not relaunch");
    rmSync(root, { force: true, recursive: true });
  });
});

describe("check for updates setting", () => {
  test("defaults on and keeps an explicit off", () => {
    expect(sanitizeSettings({}).checkUpdates).toBe(true);
    expect(sanitizeSettings({ checkUpdates: false }).checkUpdates).toBe(false);
    expect(sanitizeSettings({ checkUpdates: "yes" }).checkUpdates).toBe(true);
  });
});
