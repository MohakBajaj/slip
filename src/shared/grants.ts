export interface GrantInput {
  accessibility: boolean;
  inputMonitoring: boolean;
  microphone: string;
  screen: string;
}

export interface GrantPrompt {
  detail: string;
  id: "access" | "input" | "microphone" | "screen";
  title: string;
}

const SCREEN_OK = new Set(["granted"]);

export const missingGrants = (input: GrantInput): GrantPrompt[] => {
  const rows: GrantPrompt[] = [];
  if (!input.accessibility) {
    rows.push({
      detail: "Capture and paste need Accessibility.",
      id: "access",
      title: "Accessibility",
    });
  }
  if (!input.inputMonitoring) {
    rows.push({
      detail: "Hold fn needs Input Monitoring.",
      id: "input",
      title: "Input Monitoring",
    });
  }
  if (input.microphone !== "granted") {
    rows.push({
      detail: "Speaking needs the microphone.",
      id: "microphone",
      title: "Microphone",
    });
  }
  if (!SCREEN_OK.has(input.screen)) {
    rows.push({
      detail: "Annotating the screen needs Screen Recording.",
      id: "screen",
      title: "Screen Recording",
    });
  }
  return rows;
};
