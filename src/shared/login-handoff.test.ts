import { expect, test } from "bun:test";

import {
  actionsForPackaged,
  parseLoginItemNames,
  planLoginHandoff,
  shouldAskSystemEvents,
  shouldRunLoginHandoff,
} from "./login-handoff";

const labelPlist = `<?xml version="1.0"?>
<plist><dict>
  <key>Label</key>
  <string>dev.mohak.slip</string>
</dict></plist>`;

const exePlist = `<?xml version="1.0"?>
<plist><dict>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/me/Desktop/Slip.app/Contents/MacOS/Slip</string>
  </array>
</dict></plist>`;

const mentionPlist = `<?xml version="1.0"?>
<plist><dict>
  <key>Label</key>
  <string>com.example.notes</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/Slip.app</string>
  </array>
  <key>Comment</key>
  <string>dev.mohak.slip</string>
</dict></plist>`;

test("an old Slip login item is re-registered only for a packaged app", () => {
  const plan = planLoginHandoff({
    launchAgents: [
      {
        path: "/Users/me/Library/LaunchAgents/dev.mohak.slip.plist",
        text: labelPlist,
      },
      {
        path: "/Users/me/Library/LaunchAgents/other.plist",
        text: "<string>com.example.other</string>",
      },
    ],
    loginItemNames: parseLoginItemNames("Slip, Calendar"),
  });
  expect(plan.enableNew).toBe(true);
  expect(plan.removeNames).toEqual(["Slip"]);
  expect(plan.removeAgents).toEqual([
    "/Users/me/Library/LaunchAgents/dev.mohak.slip.plist",
  ]);
  expect(actionsForPackaged(plan, true).register).toBe(true);
  expect(actionsForPackaged(plan, false)).toEqual({
    register: false,
    removeAgents: [],
    removeNames: [],
  });
  expect(
    planLoginHandoff({ launchAgents: [], loginItemNames: [] }).enableNew
  ).toBe(false);
  expect(shouldRunLoginHandoff(false, false)).toBe(false);
  expect(shouldRunLoginHandoff(true, true)).toBe(false);
  expect(shouldRunLoginHandoff(true, false)).toBe(true);
});

test("a legacy agent is the Slip label or the Slip executable", () => {
  const labeled = planLoginHandoff({
    launchAgents: [
      { path: "/Agents/label.plist", text: labelPlist },
      { path: "/Agents/exe.plist", text: exePlist },
      { path: "/Agents/mention.plist", text: mentionPlist },
    ],
    loginItemNames: [],
  });
  expect(labeled.removeAgents).toEqual([
    "/Agents/label.plist",
    "/Agents/exe.plist",
  ]);
  expect(labeled.enableNew).toBe(true);
});

test("System Events is asked only when Slip is still on the Mac", () => {
  const quiet = {
    applicationsApp: false,
    desktopApp: false,
    launchAgents: [{ path: "/Agents/mention.plist", text: mentionPlist }],
  };
  expect(shouldAskSystemEvents(quiet)).toBe(false);
  expect(shouldAskSystemEvents({ ...quiet, applicationsApp: true })).toBe(true);
  expect(shouldAskSystemEvents({ ...quiet, desktopApp: true })).toBe(true);
  expect(
    shouldAskSystemEvents({
      ...quiet,
      launchAgents: [{ path: "/Agents/label.plist", text: labelPlist }],
    })
  ).toBe(true);
  expect(
    shouldAskSystemEvents({
      applicationsApp: false,
      desktopApp: false,
      launchAgents: [],
    })
  ).toBe(false);
});
