import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { SkillStatus } from "../shared/types";
import { AGENT_SKILL_MD } from "../skill-template";

const skillFile = (): string => {
  const home = process.env.HOME;
  if (home === undefined || home.length === 0) {
    return "";
  }
  return path.join(home, ".agents", "skills", "slip", "SKILL.md");
};

export const skillStatus = (): SkillStatus => {
  const file = skillFile();
  if (file.length === 0 || !existsSync(file)) {
    return { installed: false, path: file, stale: false };
  }
  return {
    installed: true,
    path: file,
    stale: readFileSync(file, "utf-8") !== AGENT_SKILL_MD,
  };
};

export const installSkill = (): SkillStatus => {
  const file = skillFile();
  if (file.length === 0) {
    return { installed: false, path: "", stale: false };
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, AGENT_SKILL_MD);
  return { installed: true, path: file, stale: false };
};
