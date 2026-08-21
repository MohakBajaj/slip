import { execFile } from "node:child_process";

import { emptyContext, parseLsapp } from "../shared/source";
import type { FrontContext } from "../shared/source";
import { readAxContext } from "./ax-context";

const run = (file: string, args: string[], timeout: number): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (error, stdout) => {
      if (error) {
        reject(error instanceof Error ? error : new Error("exec failed"));
        return;
      }
      resolve(stdout.trim());
    });
  });

const readLsapp = async (): Promise<{
  bundle: string;
  name: string;
  pid: number;
}> => {
  const asn = await run("/usr/bin/lsappinfo", ["front"], 200);
  if (!asn) {
    return { bundle: "", name: "", pid: 0 };
  }
  const raw = await run(
    "/usr/bin/lsappinfo",
    ["info", "-only", "name,bundleid,pid", asn],
    200
  );
  return parseLsapp(raw);
};

const readNow = async (skip: string[]): Promise<FrontContext> => {
  const info = await readLsapp();
  if (!info.name || skip.includes(info.name)) {
    return emptyContext();
  }
  const extra = readAxContext(info.pid, info.name);
  return { page: extra.page, source: info.name, url: extra.url };
};

export const startFrontContext = (
  skip: string[]
): { ready: Promise<FrontContext>; rich: Promise<FrontContext> } => {
  const ready = readNow(skip).catch(() => emptyContext());
  return { ready, rich: ready };
};
