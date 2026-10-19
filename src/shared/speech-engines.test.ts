import { expect, test } from "bun:test";

import {
  appleCleanupDetail,
  migrateSpeechSettings,
  parseAppleCleanupStatus,
} from "./speech-engines";
import { sanitizeSettings } from "./types";

test("new installs stay on device until a gateway key is added", () => {
  const next = sanitizeSettings({});
  expect(next.transcribeRoute).toBe("device");
  expect(next.transcribeDevice).toBe("parakeet");
  expect(next.transcribeModel).toBe("microsoft/mai-transcribe-2");
  expect(next.cleanupRoute).toBe("device");
  expect(next.cleanupDevice).toBe("apple");
  expect(next.cleanupModel).toBe("inception/mercury-2.5");
  expect(migrateSpeechSettings(next)).toEqual({
    cleanupDevice: next.cleanupDevice,
    cleanupModel: next.cleanupModel,
    cleanupRoute: next.cleanupRoute,
    transcribeDevice: next.transcribeDevice,
    transcribeModel: next.transcribeModel,
    transcribeRoute: next.transcribeRoute,
  });
});

test("an old cleanup endpoint becomes cloud, and off stays off", () => {
  expect(
    sanitizeSettings({
      cleanup: true,
      cleanupModel: "",
      cleanupUrl: "https://api.openai.com/v1",
    })
  ).toMatchObject({
    cleanupModel: "openai/gpt-4o-mini",
    cleanupRoute: "cloud",
  });
  expect(
    sanitizeSettings({
      cleanupModel: "gpt-4o-mini",
      cleanupUrl: "https://api.openai.com/v1",
    }).cleanupModel
  ).toBe("openai/gpt-4o-mini");
  expect(
    sanitizeSettings({
      cleanupModel: "llama3.1",
      cleanupUrl: "http://127.0.0.1:11434/v1",
    })
  ).toMatchObject({ cleanupModel: "llama3.1", cleanupRoute: "cloud" });
  const off = sanitizeSettings({
    cleanup: false,
    cleanupUrl: "https://api.openai.com/v1",
  });
  expect(off.cleanupRoute).toBe("off");
  expect("cleanupUrl" in off).toBe(false);
  expect(sanitizeSettings({ cleanup: true, cleanupUrl: "" }).cleanupRoute).toBe(
    "device"
  );
});

test("an explicit route is kept, and unknown device ids fall back", () => {
  const next = sanitizeSettings({
    cleanupDevice: "nope",
    cleanupModel: "",
    cleanupRoute: "cloud",
    transcribeDevice: "whisper-local",
    transcribeModel: "openai/whisper-1",
    transcribeRoute: "cloud",
  });
  expect(next.cleanupRoute).toBe("cloud");
  expect(next.cleanupModel).toBe("inception/mercury-2.5");
  expect(next.cleanupDevice).toBe("apple");
  expect(next.transcribeRoute).toBe("cloud");
  expect(next.transcribeModel).toBe("openai/whisper-1");
  expect(next.transcribeDevice).toBe("parakeet");
});

test("apple cleanup status", () => {
  expect(parseAppleCleanupStatus('{"available":true}')).toEqual({
    available: true,
    reason: "",
  });
  expect(
    parseAppleCleanupStatus(
      '{"available":false,"reason":"appleIntelligenceNotEnabled"}'
    ).reason
  ).toBe("appleIntelligenceNotEnabled");
  expect(parseAppleCleanupStatus("nope").available).toBe(false);
  expect(appleCleanupDetail(null)).toBe("Checking Apple Intelligence");
  expect(appleCleanupDetail({ available: true, reason: "" })).toBe(
    "Ready on this Mac"
  );
  expect(
    appleCleanupDetail({
      available: false,
      reason: "deviceNotEligible",
    })
  ).toBe("This Mac can't run it");
  expect(appleCleanupDetail({ available: false, reason: "missing" })).toBe(
    "Helper not installed"
  );
});
