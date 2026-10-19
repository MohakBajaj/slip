import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { app } from "electron";

import { GATEWAY_MODELS_URL } from "../shared/gateway-api";
import { catalogChoices, parseGatewayModels } from "../shared/gateway-models";
import type { GatewayCatalog, GatewayModel } from "../shared/gateway-models";
import { bundledGatewayModels } from "../shared/gateway-snapshot";

const MODELS_TIMEOUT_MS = 8000;

let models: GatewayModel[] = [];
let pending: Promise<GatewayCatalog> | null = null;

const cacheFile = (): string =>
  path.join(app.getPath("userData"), "gateway-models.json");

const readCached = (): GatewayModel[] => {
  const file = cacheFile();
  if (!existsSync(file)) {
    return [];
  }
  try {
    return parseGatewayModels(JSON.parse(readFileSync(file, "utf-8")));
  } catch {
    return [];
  }
};

export const gatewayModels = (): readonly GatewayModel[] =>
  models.length > 0 ? models : bundledGatewayModels();

export const primeGatewayModels = (): void => {
  const cached = readCached();
  remember(cached.length > 0 ? cached : bundledGatewayModels());
};

const remember = (next: GatewayModel[]): void => {
  if (next.length > 0) {
    models = next;
  }
};

const pull = async (): Promise<GatewayCatalog> => {
  const cached = readCached();
  if (cached.length > 0) {
    remember(cached);
  } else if (models.length === 0) {
    remember(bundledGatewayModels());
  }
  try {
    const response = await fetch(GATEWAY_MODELS_URL, {
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    const payload: unknown = await response.json();
    const parsed = parseGatewayModels(payload);
    if (parsed.length > 0) {
      remember(parsed);
      const file = cacheFile();
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(payload));
    }
  } catch {
    remember(models.length > 0 ? models : bundledGatewayModels());
  }
  return catalogChoices(gatewayModels());
};

export const refreshGatewayModels = (): Promise<GatewayCatalog> => {
  if (pending !== null) {
    return pending;
  }
  pending = pull().finally(() => {
    pending = null;
  });
  return pending;
};
