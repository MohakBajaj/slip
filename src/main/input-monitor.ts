import { systemPreferences } from "electron";

export const INPUT_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";

/** Status only. Does not prompt and does not touch the event tap. */
export const inputMonitoringGranted = (): boolean => {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    // Electron's types omit input-monitoring; the runtime accepts it on macOS.
    const preferences = systemPreferences as unknown as {
      getMediaAccessStatus: (media: "input-monitoring") => string;
    };
    return preferences.getMediaAccessStatus("input-monitoring") === "granted";
  } catch {
    return false;
  }
};
