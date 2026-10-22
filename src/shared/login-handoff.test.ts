import { expect, test } from "bun:test";

import {
  actionsForPackaged,
  parseLoginItemNames,
  planLoginHandoff,
} from "./login-handoff";

test("an old Slip login item is re-registered only for a packaged app", () => {
  const plan = planLoginHandoff({
    launchAgents: [
      {
        path: "/Users/me/Library/LaunchAgents/dev.mohak.slip.plist",
        text: '<?xml version="1.0"?><string>dev.mohak.slip</string><string>/Applications/Slip.app</string>',
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
});
