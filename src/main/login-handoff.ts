import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { app } from "electron";

import {
  actionsForPackaged,
  parseLoginItemNames,
  planLoginHandoff,
  shouldAskSystemEvents,
  shouldRunLoginHandoff,
} from "../shared/login-handoff";
import type { LoginAgent } from "../shared/login-handoff";

const execText = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: "utf-8", timeout: 4000 },
      (error, stdout) => {
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });

const launchAgents = (): LoginAgent[] => {
  const dir = path.join(app.getPath("home"), "Library", "LaunchAgents");
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const found: LoginAgent[] = [];
  for (const name of names) {
    if (!name.endsWith(".plist")) {
      continue;
    }
    const file = path.join(dir, name);
    try {
      found.push({ path: file, text: readFileSync(file, "utf-8") });
    } catch {
      // A plist that cannot be read is not a Slip login item.
    }
  }
  return found;
};

const loginItemNames = async (ask: boolean): Promise<string[]> => {
  if (process.platform !== "darwin" || !ask) {
    return [];
  }
  try {
    const stdout = await execText("osascript", [
      "-e",
      'tell application "System Events" to get the name of every login item',
    ]);
    return parseLoginItemNames(stdout);
  } catch {
    return [];
  }
};

const quoted = (name: string): string =>
  name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

const forgetLoginItem = async (name: string): Promise<void> => {
  try {
    await execText("osascript", [
      "-e",
      `tell application "System Events" to delete login item "${quoted(name)}"`,
    ]);
  } catch {
    // System Events may refuse without Automation access.
  }
};

const handoffMarker = (): string =>
  path.join(app.getPath("userData"), "login-handoff-done");

/** Re-register login-at-start for this bundle and drop the old Slip item. */
export const handoffLogin = async (): Promise<void> => {
  const marker = handoffMarker();
  if (!shouldRunLoginHandoff(app.isPackaged, existsSync(marker))) {
    return;
  }
  const agents = launchAgents();
  const home = app.getPath("home");
  const plan = planLoginHandoff({
    launchAgents: agents,
    loginItemNames: await loginItemNames(
      shouldAskSystemEvents({
        applicationsApp: existsSync("/Applications/Slip.app"),
        desktopApp: existsSync(path.join(home, "Desktop", "Slip.app")),
        launchAgents: agents,
      })
    ),
  });
  const actions = actionsForPackaged(plan, true);
  if (actions.register) {
    app.setLoginItemSettings({ openAtLogin: true, type: "mainAppService" });
  }
  await Promise.all(actions.removeNames.map((name) => forgetLoginItem(name)));
  for (const file of actions.removeAgents) {
    rmSync(file, { force: true });
  }
  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(marker, "done\n");
};
