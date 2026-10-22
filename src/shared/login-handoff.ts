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

const isLegacyAgent = (text: string): boolean =>
  text.includes("dev.mohak.slip") || text.includes("Slip.app");

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
