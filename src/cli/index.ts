#!/usr/bin/env bun

import path from "node:path";

import { createCLI, defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { createSlip, listSlips, updateSlip } from "../main/vault";
import { promptFor, titleOf } from "../shared/format";
import { defaultVaultPath } from "../shared/types";

const vaultOption = option(z.string().optional(), {
  description: "Vault folder (or SLIP_VAULT)",
  short: "v",
});

const vaultOf = (flag?: string): string =>
  flag ?? process.env.SLIP_VAULT ?? defaultVaultPath();

const find = (root: string, id: string) => {
  const slip = listSlips(root).find(
    (item) => item.id === id || item.filename.startsWith(id)
  );
  if (!slip) {
    throw new Error(`no slip ${id}`);
  }
  return slip;
};

const list = defineCommand({
  description: "List open slips",
  handler: ({ flags }) => {
    const root = vaultOf(flags.vault);
    for (const slip of listSlips(root).filter((item) => !item.archived)) {
      console.log(
        `${slip.id}\t${slip.done ? "done" : "open"}\t${titleOf(slip.content)}`
      );
    }
  },
  name: "list",
  options: { vault: vaultOption },
});

const search = defineCommand({
  description: "Search slip bodies and tags",
  handler: ({ flags, positional }) => {
    const root = vaultOf(flags.vault);
    const query = positional.join(" ").toLowerCase();
    for (const slip of listSlips(root).filter(
      (item) =>
        !item.archived &&
        (item.content.toLowerCase().includes(query) ||
          item.tags.join(" ").toLowerCase().includes(query))
    )) {
      console.log(`${slip.id}\t${titleOf(slip.content)}`);
    }
  },
  name: "search",
  options: { vault: vaultOption },
});

const add = defineCommand({
  description: "Create a slip from the remaining words",
  handler: ({ flags, positional }) => {
    const slip = createSlip(vaultOf(flags.vault), {
      content: positional.join(" ") || "Untitled",
      source: "cli",
    });
    console.log(slip.id);
  },
  name: "add",
  options: { vault: vaultOption },
});

const done = defineCommand({
  description: "Mark a slip done",
  handler: ({ flags, positional }) => {
    const root = vaultOf(flags.vault);
    const [id] = positional;
    if (!id) {
      throw new Error("usage: slip done <id>");
    }
    updateSlip(root, find(root, id).id, { done: true });
  },
  name: "done",
  options: { vault: vaultOption },
});

const archive = defineCommand({
  description: "Archive a slip (file stays put)",
  handler: ({ flags, positional }) => {
    const root = vaultOf(flags.vault);
    const [id] = positional;
    if (!id) {
      throw new Error("usage: slip archive <id>");
    }
    updateSlip(root, find(root, id).id, { archived: true });
  },
  name: "archive",
  options: { vault: vaultOption },
});

const tag = defineCommand({
  description: "Add tags to a slip",
  handler: ({ flags, positional }) => {
    const root = vaultOf(flags.vault);
    const [id, ...tags] = positional;
    if (!id || tags.length === 0) {
      throw new Error("usage: slip tag <id> <tag> [tag...]");
    }
    const current = find(root, id);
    updateSlip(root, current.id, {
      tags: [...new Set([...current.tags, ...tags])],
    });
  },
  name: "tag",
  options: { vault: vaultOption },
});

const pathCmd = defineCommand({
  description: "Print the absolute path of a slip",
  handler: ({ flags, positional }) => {
    const root = vaultOf(flags.vault);
    const [id] = positional;
    if (!id) {
      throw new Error("usage: slip path <id>");
    }
    console.log(path.join(root, find(root, id).filename));
  },
  name: "path",
  options: { vault: vaultOption },
});

const prompt = defineCommand({
  description: "Print slips as a prompt block",
  handler: ({ flags, positional }) => {
    const root = vaultOf(flags.vault);
    if (positional.length === 0) {
      throw new Error("usage: slip prompt <id> [id...]");
    }
    console.log(promptFor(positional.map((id) => find(root, id))));
  },
  name: "prompt",
  options: { vault: vaultOption },
});

const vault = defineCommand({
  description: "Print the vault path",
  handler: ({ flags }) => {
    console.log(vaultOf(flags.vault));
  },
  name: "vault",
  options: { vault: vaultOption },
});

const cli = await createCLI({
  description:
    "Manage the Slip markdown vault. The app does not need to be running.",
  name: "slip",
  version: "1.0.0",
});

cli.command(list);
cli.command(search);
cli.command(add);
cli.command(done);
cli.command(archive);
cli.command(tag);
cli.command(pathCmd);
cli.command(prompt);
cli.command(vault);

await cli.run();
