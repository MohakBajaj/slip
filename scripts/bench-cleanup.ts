import { cleanupRequest } from "../src/shared/cleanup";
import {
  chatCompletionBody,
  GATEWAY_MODELS_URL,
  streamChatCompletion,
} from "../src/shared/gateway-api";
import {
  CLEANUP_RECOMMENDED,
  findModel,
  parseGatewayModels,
} from "../src/shared/gateway-models";
import type { GatewayModel } from "../src/shared/gateway-models";
import { bundledGatewayModels } from "../src/shared/gateway-snapshot";

const SAMPLES = [
  "um hey so I I need to uh ping the vendor about the invoice honestly",
  "the quote was 40k no sorry 45k and it is due on the 12th actually make that the 15th",
  "okay the list is batteries tape and a spare cable",
  "hey can you uh remind me what time the standup is on Friday",
  "I think we should probably kind of move the demo to the afternoon",
  "Okay, so hello people, what's up? How are you doing today? So we got Zen, Microsoft Edge, Chrome, Termius, MongoDB, WhatsApp, Teams, Figma, Cloudflare, Settings, Flip in the house with us today. I think we are all going to have fun, and here's our shopping list for the day. It's apples, bananas, mangoes, chocolates, etcetera, etcetera. I think that's about it.",
  "for the trip I need to pack my passport the charger and the blue jacket",
];

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
    // The bundled snapshot still has reasoning flags.
  }
  return bundledGatewayModels();
};

const key = process.env.AI_GATEWAY_API_KEY?.trim() ?? "";
if (key.length === 0) {
  console.error("AI_GATEWAY_API_KEY is required");
  process.exit(1);
}

const chosen = process.argv.slice(2);
const models = await loadModels();
const ids = chosen.length > 0 ? chosen : [...CLEANUP_RECOMMENDED];

for (const id of ids) {
  const record = findModel(models, id);
  console.log(`\n${id}`);
  for (const [index, sample] of SAMPLES.entries()) {
    const started = performance.now();
    let first = 0;
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one call at a time, so the timings stay readable
      const { text: output } = await streamChatCompletion({
        apiKey: key,
        body: chatCompletionBody({
          modelId: id,
          record,
          request: cleanupRequest(sample),
          stream: true,
        }),
        onDelta: () => {
          if (first === 0) {
            first = performance.now() - started;
          }
        },
      });
      const total = Math.round(performance.now() - started);
      const ttft = first === 0 ? total : Math.round(first);
      console.log(`  ${index + 1}. ttft ${ttft}ms  total ${total}ms`);
      console.log(`  ${output.replaceAll("\n", "\n  ")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed";
      console.log(`  ${index + 1}. ${message}`);
    }
  }
}
