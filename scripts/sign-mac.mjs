#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const entitlements = path.join(root, "build", "entitlements.mac.plist");

const modeOf = () => {
  const link = (process.env.CSC_LINK ?? "").replaceAll(/\s/gu, "");
  const password = process.env.CSC_KEY_PASSWORD ?? "";
  const hasLink = link.length > 0;
  const hasPassword = password.length > 0;
  if (!hasLink && !hasPassword) {
    return "adhoc";
  }
  if (hasLink && hasPassword) {
    return "stable";
  }
  return "incomplete";
};

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf-8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`${command} ${args[0] ?? ""} failed\n${detail}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
};

const tryRun = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf-8" });
  return result.status === 0;
};

const signApp = async (app, identity, keychain) => {
  const { signAsync } = require("@electron/osx-sign");
  await signAsync({
    app,
    identity,
    identityValidation: false,
    keychain,
    optionsForFile() {
      return {
        entitlements,
        hardenedRuntime: false,
        timestamp: "none",
      };
    },
    platform: "darwin",
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
  });
  const shown = spawnSync("codesign", ["-d", "-r-", app], {
    encoding: "utf-8",
  });
  const output = `${shown.stdout ?? ""}${shown.stderr ?? ""}`;
  process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  if (shown.status !== 0) {
    process.exit(shown.status ?? 1);
  }
};

const importIdentity = () => {
  const work = mkdtempSync(path.join(tmpdir(), "slip-sign-"));
  const keychain = path.join(work, "slip.keychain-db");
  const p12 = path.join(work, "cert.p12");
  const cert = path.join(work, "cert.pem");
  const keychainPassword = randomBytes(24).toString("hex");
  const password = process.env.CSC_KEY_PASSWORD ?? "";
  let trustedSystem = false;
  let previous = [];
  const cleanup = () => {
    if (trustedSystem) {
      tryRun("sudo", ["security", "remove-trusted-cert", "-d", cert]);
    }
    tryRun("security", ["delete-keychain", keychain]);
    if (previous.length > 0) {
      tryRun("security", ["list-keychains", "-d", "user", "-s", ...previous]);
    }
    rmSync(work, { force: true, recursive: true });
  };
  try {
    writeFileSync(
      p12,
      Buffer.from((process.env.CSC_LINK ?? "").replaceAll(/\s/gu, ""), "base64")
    );
    run("security", ["create-keychain", "-p", keychainPassword, keychain]);
    run("security", ["set-keychain-settings", "-t", "21600", keychain]);
    run("security", ["unlock-keychain", "-p", keychainPassword, keychain]);
    previous = run("security", ["list-keychains", "-d", "user"])
      .split("\n")
      .map((line) => line.trim().replaceAll(/^"|"$/gu, ""))
      .filter((line) => line.length > 0);
    run("security", [
      "list-keychains",
      "-d",
      "user",
      "-s",
      keychain,
      ...previous,
    ]);
    run("security", [
      "import",
      p12,
      "-k",
      keychain,
      "-P",
      password,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    ]);
    run("security", [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychain,
    ]);
    run("openssl", [
      "pkcs12",
      "-in",
      p12,
      "-clcerts",
      "-nokeys",
      "-passin",
      `pass:${password}`,
      "-out",
      cert,
    ]);
    tryRun("security", [
      "add-trusted-cert",
      "-d",
      "-r",
      "trustRoot",
      "-p",
      "codeSign",
      "-k",
      keychain,
      cert,
    ]);
    const identity = () => {
      const found = run("security", [
        "find-identity",
        "-v",
        "-p",
        "codesigning",
        keychain,
      ]);
      return /"(?<name>[^"]+)"/u.exec(found)?.groups?.name ?? "";
    };
    let name = identity();
    if (name.length === 0) {
      trustedSystem = tryRun("sudo", [
        "security",
        "add-trusted-cert",
        "-d",
        "-r",
        "trustRoot",
        "-p",
        "codeSign",
        "-k",
        "/Library/Keychains/System.keychain",
        cert,
      ]);
      name = identity();
    }
    if (name.length === 0) {
      throw new Error(
        "CSC_LINK has no code signing identity. Create a Code Signing certificate and export it as a .p12."
      );
    }
    return { cleanup, keychain, name };
  } catch (error) {
    cleanup();
    throw error;
  }
};

const main = async () => {
  const mode = modeOf();
  if (mode === "incomplete") {
    console.error(
      "CSC_LINK and CSC_KEY_PASSWORD must both be set, or both be empty."
    );
    process.exit(1);
  }
  const argument = process.argv.at(2);
  if (argument === "--mode") {
    process.stdout.write(`${mode}\n`);
    return;
  }
  if (argument === undefined || !argument.endsWith(".app")) {
    console.error("usage: sign-mac.mjs [--mode] Jot.app");
    process.exit(1);
  }
  if (mode === "adhoc") {
    console.log("signing: adhoc");
    await signApp(argument, "-");
    return;
  }
  const imported = importIdentity();
  try {
    console.log(`signing: stable ${imported.name}`);
    await signApp(argument, imported.name, imported.keychain);
  } finally {
    imported.cleanup();
  }
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
