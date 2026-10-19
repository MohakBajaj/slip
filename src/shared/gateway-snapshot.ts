import payload from "./fixtures/gateway-models.json" with { type: "json" };
import { parseGatewayModels } from "./gateway-models";
import type { GatewayModel } from "./gateway-models";

let cached: GatewayModel[] | null = null;

export const bundledGatewayModels = (): GatewayModel[] => {
  cached ??= parseGatewayModels(payload);
  return cached;
};
