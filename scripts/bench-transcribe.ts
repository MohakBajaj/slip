import { readFileSync } from "node:fs";

import { GATEWAY_MODELS_URL, transcribeAudio } from "../src/shared/gateway-api";
import {
  listModelChoices,
  parseGatewayModels,
  TRANSCRIBE_RECOMMENDED,
} from "../src/shared/gateway-models";
import type { GatewayModel } from "../src/shared/gateway-models";
import { bundledGatewayModels } from "../src/shared/gateway-snapshot";

const loadModels = async (): Promise<GatewayModel[]> => {
  try {
    const response = await fetch(GATEWAY_MODELS_URL, {
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const parsed = parseGatewayModels(await response.json());
      if (parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Bundled snapshot.
  }
  return bundledGatewayModels();
};

const key = process.env.AI_GATEWAY_API_KEY?.trim() ?? "";
const [wavPath, ...chosen] = process.argv.slice(2);
if (key.length === 0 || wavPath === undefined) {
  console.error(
    "usage: AI_GATEWAY_API_KEY=... bun scripts/bench-transcribe.ts <file.wav> [model...]"
  );
  process.exit(1);
}

const audio = new Uint8Array(readFileSync(wavPath));
const models = await loadModels();
const fileIds = new Set(
  listModelChoices(models, "transcription").map((choice) => choice.id)
);
const defaults = TRANSCRIBE_RECOMMENDED.filter((id) => fileIds.has(id));
const ids = chosen.length > 0 ? chosen : defaults;

for (const id of ids) {
  const started = performance.now();
  try {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one call at a time, so the timings stay readable
    const { text } = await transcribeAudio({
      apiKey: key,
      audio,
      mediaType: "audio/wav",
      model: id,
    });
    const total = Math.round(performance.now() - started);
    console.log(`\n${id}`);
    console.log(`  total ${total}ms  (batch response, no partial tokens)`);
    console.log(`  ${text.replaceAll("\n", "\n  ")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    console.log(`\n${id}\n  ${message}`);
  }
}
