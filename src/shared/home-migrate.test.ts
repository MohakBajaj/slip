import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { migrateHome, relocate } from "./home-migrate";
import type { MigrateStep } from "./home-migrate";
import { defaultVaultPath, settingsFile } from "./types";

const home = (): string => mkdtempSync(path.join(tmpdir(), "jot-home-"));

const write = (file: string, body: string): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
};

describe("migrate Application Support from Slip to Jot", () => {
  test("moves notes settings, shortcuts, cleanup toggle, and the key file", () => {
    const root = home();
    const slip = path.join(root, "Library", "Application Support", "Slip");
    const jot = path.join(root, "Library", "Application Support", "Jot");
    const notes = path.join(root, "Documents", "Slip", "hello.md");
    const settings = {
      cleanTranscripts: true,
      shortcuts: { compose: "Mod+N" },
      vaultPath: path.dirname(notes),
    };
    write(path.join(slip, "settings.json"), JSON.stringify(settings));
    write(path.join(slip, "cleanup-key"), "ciphertext-v1");
    write(path.join(slip, "models", "redux.bin"), "model-bytes");
    write(notes, "# hello\n");
    write(
      path.join(root, "Library", "Preferences", "dev.mohak.slip.plist"),
      "<plist>slip</plist>"
    );
    write(
      path.join(root, "Library", "Caches", "dev.mohak.slip", "Cache.db"),
      "cache"
    );
    write(
      path.join(
        root,
        "Library",
        "Saved Application State",
        "dev.mohak.slip.savedState",
        "windows.plist"
      ),
      "state"
    );
    write(
      path.join(
        root,
        "Library",
        "HTTPStorages",
        "dev.mohak.slip",
        "http.plist"
      ),
      "http"
    );

    const first = migrateHome(root);
    expect(first.userData).toBe(jot);
    expect(readFileSync(path.join(jot, "settings.json"), "utf8")).toBe(
      JSON.stringify(settings)
    );
    expect(readFileSync(path.join(jot, "cleanup-key"), "utf8")).toBe(
      "ciphertext-v1"
    );
    expect(readFileSync(path.join(jot, "models", "redux.bin"), "utf8")).toBe(
      "model-bytes"
    );
    expect(existsSync(slip)).toBe(false);
    expect(readFileSync(notes, "utf8")).toBe("# hello\n");
    expect(
      readFileSync(
        path.join(root, "Library", "Preferences", "dev.mohak.jot.plist"),
        "utf8"
      )
    ).toBe("<plist>slip</plist>");
    expect(
      existsSync(
        path.join(root, "Library", "Preferences", "dev.mohak.slip.plist")
      )
    ).toBe(false);
    expect(
      readFileSync(
        path.join(root, "Library", "Caches", "dev.mohak.jot", "Cache.db"),
        "utf8"
      )
    ).toBe("cache");
    expect(
      readFileSync(
        path.join(
          root,
          "Library",
          "Saved Application State",
          "dev.mohak.jot.savedState",
          "windows.plist"
        ),
        "utf8"
      )
    ).toBe("state");
    expect(
      readFileSync(
        path.join(
          root,
          "Library",
          "HTTPStorages",
          "dev.mohak.jot",
          "http.plist"
        ),
        "utf8"
      )
    ).toBe("http");

    const before = readFileSync(path.join(jot, "settings.json"));
    const second = migrateHome(root);
    expect(second.results.every((item) => item.action !== "moved")).toBe(true);
    expect(readFileSync(path.join(jot, "settings.json")).equals(before)).toBe(
      true
    );
    expect(existsSync(slip)).toBe(false);
    expect(existsSync(`${jot}.migrating`)).toBe(false);
    rmSync(root, { force: true, recursive: true });
  });

  test("a crash after the copy keeps the Slip folder and a retry finishes once", () => {
    const root = home();
    const slip = path.join(root, "Library", "Application Support", "Slip");
    const jot = path.join(root, "Library", "Application Support", "Jot");
    write(path.join(slip, "settings.json"), '{"vaultPath":"/notes"}');
    write(path.join(slip, "cleanup-key"), "secret");
    let crash: MigrateStep | null = "copied";
    expect(() =>
      migrateHome(root, {
        after: (step) => {
          if (step === crash) {
            throw new Error("crash");
          }
        },
      })
    ).toThrow("crash");
    expect(readFileSync(path.join(slip, "settings.json"), "utf8")).toBe(
      '{"vaultPath":"/notes"}'
    );
    expect(readFileSync(path.join(slip, "cleanup-key"), "utf8")).toBe("secret");
    expect(existsSync(jot)).toBe(false);
    crash = null;
    migrateHome(root);
    expect(readFileSync(path.join(jot, "cleanup-key"), "utf8")).toBe("secret");
    expect(existsSync(slip)).toBe(false);
    expect(existsSync(`${jot}.migrating`)).toBe(false);
    rmSync(root, { force: true, recursive: true });
  });

  test("a crash after the folder is in place does not duplicate on retry", () => {
    const root = home();
    const slip = path.join(root, "Library", "Application Support", "Slip");
    const jot = path.join(root, "Library", "Application Support", "Jot");
    write(path.join(slip, "settings.json"), "original");
    let crash: MigrateStep | null = "renamed";
    expect(() =>
      migrateHome(root, {
        after: (step) => {
          if (step === crash) {
            throw new Error("crash");
          }
        },
      })
    ).toThrow("crash");
    expect(readFileSync(path.join(jot, "settings.json"), "utf8")).toBe(
      "original"
    );
    expect(readFileSync(path.join(slip, "settings.json"), "utf8")).toBe(
      "original"
    );
    crash = null;
    const again = migrateHome(root);
    const support = again.results.find((item) => item.dest === jot);
    expect(support?.action).toBe("already");
    expect(existsSync(slip)).toBe(false);
    expect(readFileSync(path.join(jot, "settings.json"), "utf8")).toBe(
      "original"
    );
    rmSync(root, { force: true, recursive: true });
  });

  test("a fresh home creates nothing and a later Jot folder is left alone", () => {
    const root = home();
    const jot = path.join(root, "Library", "Application Support", "Jot");
    const first = migrateHome(root);
    expect(first.userData).toBe(jot);
    expect(existsSync(jot)).toBe(false);
    expect(
      first.results.every(
        (item) => item.action === "absent" || item.action === "already"
      )
    ).toBe(true);
    write(path.join(jot, "settings.json"), "fresh");
    migrateHome(root);
    expect(readFileSync(path.join(jot, "settings.json"), "utf8")).toBe("fresh");
    expect(
      existsSync(path.join(root, "Library", "Application Support", "Slip"))
    ).toBe(false);
    rmSync(root, { force: true, recursive: true });
  });

  test("keeps both folders when Jot already has different data", () => {
    const root = home();
    const parent = path.join(root, "pair");
    const source = path.join(parent, "Slip");
    const dest = path.join(parent, "Jot");
    write(path.join(source, "settings.json"), "old");
    write(path.join(dest, "settings.json"), "new");
    expect(relocate(source, dest).action).toBe("kept-both");
    expect(readFileSync(path.join(source, "settings.json"), "utf8")).toBe(
      "old"
    );
    expect(readFileSync(path.join(dest, "settings.json"), "utf8")).toBe("new");
    rmSync(root, { force: true, recursive: true });
  });

  test("a lowercase slip folder is moved when it is a different path", () => {
    const root = home();
    const slip = path.join(root, "Library", "Application Support", "slip");
    const jot = path.join(root, "Library", "Application Support", "Jot");
    write(path.join(slip, "settings.json"), "lower");
    const moved = migrateHome(root).results.find(
      (item) => item.source === slip
    );
    expect(moved?.action).toBe("moved");
    expect(readFileSync(path.join(jot, "settings.json"), "utf8")).toBe("lower");
    expect(existsSync(slip)).toBe(false);
    rmSync(root, { force: true, recursive: true });
  });

  test("new installs default to Documents/Jot and Application Support/Jot", () => {
    const prev = process.env.HOME;
    process.env.HOME = "/Users/me";
    expect(defaultVaultPath()).toBe("/Users/me/Documents/Jot");
    expect(settingsFile()).toBe(
      "/Users/me/Library/Application Support/Jot/settings.json"
    );
    if (prev === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prev;
    }
  });
});
