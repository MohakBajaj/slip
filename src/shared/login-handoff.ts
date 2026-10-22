export interface LoginAgent {
  path: string;
  text: string;
}

export interface LoginHandoff {
  enableNew: boolean;
  removeAgents: string[];
  removeNames: string[];
}

export interface LoginActions {
  register: boolean;
  removeAgents: string[];
  removeNames: string[];
}

const LEGACY_NAME = new Set(["Slip", "Slip.app"]);
const LEGACY_LABEL = /<key>Label<\/key>\s*<string>dev\.mohak\.slip<\/string>/u;
const LEGACY_EXE = "/Slip.app/Contents/MacOS/Slip";

const programArguments = (text: string): string[] => {
  const block =
    /<key>ProgramArguments<\/key>\s*<array>(?<body>[\s\S]*?)<\/array>/u.exec(
      text
    );
  const body = block?.groups?.body;
  if (body === undefined) {
    return [];
  }
  const values: string[] = [];
  const strings = /<string>(?<value>[^<]*)<\/string>/gu;
  for (const match of body.matchAll(strings)) {
    const value = match.groups?.value;
    if (value !== undefined) {
      values.push(value);
    }
  }
  return values;
};

const isLegacyAgent = (text: string): boolean =>
  LEGACY_LABEL.test(text) ||
  programArguments(text).some((value) => value.endsWith(LEGACY_EXE));

/** System Events prompts the first time. Ask only when Slip is still around. */
export const shouldAskSystemEvents = (input: {
  applicationsApp: boolean;
  desktopApp: boolean;
  launchAgents: LoginAgent[];
}): boolean =>
  input.applicationsApp ||
  input.desktopApp ||
  input.launchAgents.some((agent) => isLegacyAgent(agent.text));

export const planLoginHandoff = (input: {
  launchAgents: LoginAgent[];
  loginItemNames: string[];
}): LoginHandoff => {
  const removeNames = input.loginItemNames.filter((name) =>
    LEGACY_NAME.has(name)
  );
  const removeAgents = input.launchAgents
    .filter((agent) => isLegacyAgent(agent.text))
    .map((agent) => agent.path);
  return {
    enableNew: removeNames.length > 0 || removeAgents.length > 0,
    removeAgents,
    removeNames,
  };
};

export const actionsForPackaged = (
  plan: LoginHandoff,
  packaged: boolean
): LoginActions => {
  if (!packaged) {
    return { register: false, removeAgents: [], removeNames: [] };
  }
  return {
    register: plan.enableNew,
    removeAgents: plan.removeAgents,
    removeNames: plan.removeNames,
  };
};

export const shouldRunLoginHandoff = (
  packaged: boolean,
  alreadyDone: boolean
): boolean => packaged && !alreadyDone;

export const parseLoginItemNames = (output: string): string[] =>
  output
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
