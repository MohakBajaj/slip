export const PARAKEET_ID = "parakeet";
export const APPLE_CLEANUP_ID = "apple";

/** Fastest cleanup model that kept the note, with effort none. */
export const DEFAULT_CLOUD_CLEANUP = "inception/mercury-2.5";

/** Cheapest file transcription model on the gateway. */
export const DEFAULT_CLOUD_TRANSCRIBE = "microsoft/mai-transcribe-2";

/** Previous cloud cleanup default, now a gateway model id. */
export const LEGACY_CLOUD_CLEANUP = "openai/gpt-4o-mini";

export type CleanupRoute = "cloud" | "device" | "off";
export type TranscribeRoute = "cloud" | "device";

export interface LocalEngine {
  detail: string;
  id: string;
  label: string;
}

export interface SpeechEngineSettings {
  cleanupDevice: string;
  cleanupModel: string;
  cleanupRoute: CleanupRoute;
  transcribeDevice: string;
  transcribeModel: string;
  transcribeRoute: TranscribeRoute;
}

export interface AppleCleanupStatus {
  available: boolean;
  reason: string;
}

export const localTranscribers: readonly LocalEngine[] = [
  { detail: "On this Mac", id: PARAKEET_ID, label: "Parakeet" },
];

export const localCleanups: readonly LocalEngine[] = [
  {
    detail: "Foundation Models",
    id: APPLE_CLEANUP_ID,
    label: "Apple Intelligence",
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isLocalTranscriber = (id: string): boolean =>
  localTranscribers.some((engine) => engine.id === id);

export const isLocalCleanup = (id: string): boolean =>
  localCleanups.some((engine) => engine.id === id);

const cleanupRouteOf = (value: unknown): CleanupRoute | null => {
  if (value === "cloud" || value === "device" || value === "off") {
    return value;
  }
  return null;
};

const textOf = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
};

const legacyCloudModel = (model: string): boolean =>
  model.length === 0 || model === "gpt-4o-mini";

const cloudCleanupModel = (
  model: string,
  route: CleanupRoute,
  explicit: boolean
): string => {
  if (!explicit && route === "cloud" && legacyCloudModel(model)) {
    return LEGACY_CLOUD_CLEANUP;
  }
  if (model === "gpt-4o-mini") {
    return LEGACY_CLOUD_CLEANUP;
  }
  if (model.length === 0 || isLocalCleanup(model)) {
    return DEFAULT_CLOUD_CLEANUP;
  }
  return model;
};

const resolveCleanupRoute = (
  record: Record<string, unknown>,
  explicit: CleanupRoute | null
): CleanupRoute => {
  if (explicit !== null) {
    return explicit;
  }
  if (record.cleanup === false) {
    return "off";
  }
  if (textOf(record, "cleanupUrl").length > 0) {
    return "cloud";
  }
  return "device";
};

const cloudTranscribeModel = (model: string): string => {
  if (model.length === 0 || isLocalTranscriber(model)) {
    return DEFAULT_CLOUD_TRANSCRIBE;
  }
  return model;
};

/** Old `cleanup` / `cleanupUrl` files become a route. The gateway key file is untouched. */
export const migrateSpeechSettings = (raw: unknown): SpeechEngineSettings => {
  const record = isRecord(raw) ? raw : {};
  const explicit = cleanupRouteOf(record.cleanupRoute);
  const cleanupRoute = resolveCleanupRoute(record, explicit);
  const device = textOf(record, "cleanupDevice");
  const transcriber = textOf(record, "transcribeDevice");
  return {
    cleanupDevice: isLocalCleanup(device) ? device : APPLE_CLEANUP_ID,
    cleanupModel: cloudCleanupModel(
      textOf(record, "cleanupModel"),
      cleanupRoute,
      explicit !== null
    ),
    cleanupRoute,
    transcribeDevice: isLocalTranscriber(transcriber)
      ? transcriber
      : PARAKEET_ID,
    transcribeModel: cloudTranscribeModel(textOf(record, "transcribeModel")),
    transcribeRoute: record.transcribeRoute === "cloud" ? "cloud" : "device",
  };
};

export const parseAppleCleanupStatus = (raw: string): AppleCleanupStatus => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { available: false, reason: "unavailable" };
    }
    const reason =
      typeof parsed.reason === "string" && parsed.reason.length > 0
        ? parsed.reason
        : "";
    return { available: parsed.available === true, reason };
  } catch {
    return { available: false, reason: "unavailable" };
  }
};

export const appleCleanupDetail = (
  status: AppleCleanupStatus | null
): string => {
  if (status === null) {
    return "Checking Apple Intelligence";
  }
  if (status.available) {
    return "Ready on this Mac";
  }
  if (status.reason === "appleIntelligenceNotEnabled") {
    return "Turn on Apple Intelligence";
  }
  if (status.reason === "deviceNotEligible") {
    return "This Mac can't run it";
  }
  if (status.reason === "modelNotReady") {
    return "Model still downloading";
  }
  if (status.reason === "missing") {
    return "Helper not installed";
  }
  return "Unavailable";
};
