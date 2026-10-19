import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { catalogChoices } from "../../../shared/gateway-models";
import type {
  GatewayCatalog,
  ModelChoice,
} from "../../../shared/gateway-models";
import { bundledGatewayModels } from "../../../shared/gateway-snapshot";
import {
  appleCleanupDetail,
  localCleanups,
  localTranscribers,
} from "../../../shared/speech-engines";
import type {
  AppleCleanupStatus,
  CleanupRoute,
  TranscribeRoute,
} from "../../../shared/speech-engines";
import type { Settings } from "../../../shared/types";

const transcribeRoutes = [
  { id: "device", label: "On-device" },
  { id: "cloud", label: "Cloud" },
] as const satisfies readonly { id: TranscribeRoute; label: string }[];

const cleanupRoutes = [
  { id: "device", label: "On-device" },
  { id: "cloud", label: "Cloud" },
  { id: "off", label: "Off" },
] as const satisfies readonly { id: CleanupRoute; label: string }[];

const selectClass =
  "border-input bg-background text-foreground h-7 w-full rounded-lg border px-2 text-[12px] outline-none";

const choiceLabel = (choice: ModelChoice): string =>
  choice.price.length > 0 ? `${choice.name} · ${choice.price}` : choice.name;

const ModelMenu = ({
  choices,
  label,
  onPick,
  value,
}: {
  choices: readonly ModelChoice[];
  label: string;
  onPick: (id: string) => void;
  value: string;
}) => {
  const known = choices.some((choice) => choice.id === value);
  const recommended = choices.filter(
    (choice) => choice.group === "recommended"
  );
  const rest = choices.filter((choice) => choice.group === "rest");
  const option = (choice: ModelChoice) => (
    <option key={choice.id} value={choice.id}>
      {choiceLabel(choice)}
    </option>
  );
  return (
    <select
      aria-label={label}
      className={selectClass}
      onChange={(event) => {
        onPick(event.target.value);
      }}
      value={value}
    >
      {known ? null : <option value={value}>{value}</option>}
      {recommended.length > 0 ? (
        <optgroup label="Recommended">{recommended.map(option)}</optgroup>
      ) : null}
      {rest.length > 0 ? (
        <optgroup label="All models">{rest.map(option)}</optgroup>
      ) : null}
    </select>
  );
};

const LocalMenu = ({
  engines,
  label,
  onPick,
  value,
}: {
  engines: readonly { id: string; label: string }[];
  label: string;
  onPick: (id: string) => void;
  value: string;
}) => (
  <select
    aria-label={label}
    className={selectClass}
    onChange={(event) => {
      onPick(event.target.value);
    }}
    value={value}
  >
    {engines.some((engine) => engine.id === value) ? null : (
      <option value={value}>{value}</option>
    )}
    {engines.map((engine) => (
      <option key={engine.id} value={engine.id}>
        {engine.label}
      </option>
    ))}
  </select>
);

const RouteSwitch = <T extends string>({
  label,
  onPick,
  options,
  value,
}: {
  label: string;
  onPick: (next: T) => void;
  options: readonly { id: T; label: string }[];
  value: T;
}) => (
  <div className="flex flex-col gap-1">
    <p className="text-[13px] leading-none">{label}</p>
    <div className="bg-muted/70 flex rounded-xl p-0.5">
      {options.map((option) => (
        <button
          aria-pressed={value === option.id}
          className={cn(
            "press h-7 flex-1 rounded-[10px] text-[12px]",
            value === option.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground"
          )}
          key={option.id}
          onClick={() => {
            onPick(option.id);
          }}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

const priceOf = (choices: readonly ModelChoice[], id: string): string =>
  choices.find((choice) => choice.id === id)?.price ?? "";

const cloudDetail = (price: string, keySet: boolean): string => {
  if (keySet) {
    return price.length > 0 ? price : "Cloud model";
  }
  if (price.length > 0) {
    return `${price}. Add a gateway key.`;
  }
  return "Add a gateway key.";
};

const GatewayKey = ({
  keySet,
  onSet,
}: {
  keySet: boolean;
  onSet: (set: boolean) => void;
}) => {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] leading-none">AI Gateway key</p>
      <p className="text-muted-foreground text-[11px]">
        One key for cloud transcription and cleanup. Stored in the keychain.
      </p>
      <div className="flex gap-1">
        <Input
          aria-label="Vercel AI Gateway API key"
          className="h-7 text-[12px]"
          onBlur={() => {
            if (draft.length === 0) {
              return;
            }
            window.slip
              .setCleanupKey(draft)
              .then((saved) => {
                if (saved) {
                  onSet(true);
                  setDraft("");
                }
              })
              .catch(() => undefined);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          placeholder={keySet ? "Key saved" : "Vercel AI Gateway key"}
          type="password"
          value={draft}
        />
        {keySet ? (
          <Button
            className="press"
            onClick={() => {
              window.slip
                .setCleanupKey("")
                .then(() => {
                  onSet(false);
                  setDraft("");
                })
                .catch(() => undefined);
            }}
            size="xs"
            variant="ghost"
          >
            Forget
          </Button>
        ) : null}
      </div>
    </div>
  );
};

export const SpeechSettings = ({
  onChange,
  settings,
}: {
  onChange: (next: Settings) => void;
  settings: Settings;
}) => {
  const [catalog, setCatalog] = useState<GatewayCatalog>(() =>
    catalogChoices(bundledGatewayModels())
  );
  const [keySet, setKeySet] = useState(false);
  const [apple, setApple] = useState<AppleCleanupStatus | null>(null);

  useEffect(() => {
    window.slip
      .gatewayCatalog()
      .then(setCatalog)
      .catch(() => undefined);
    window.slip
      .cleanupKeySet()
      .then(setKeySet)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (settings.cleanupRoute !== "device") {
      return undefined;
    }
    let live = true;
    window.slip
      .appleCleanupStatus()
      .then((status) => {
        if (live) {
          setApple(status);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [settings.cleanupRoute]);

  const transcribePrice = priceOf(
    catalog.transcription,
    settings.transcribeModel
  );
  const localTranscriber = localTranscribers.find(
    (engine) => engine.id === settings.transcribeDevice
  );
  let transcribeHint = localTranscriber?.detail ?? "On this Mac";
  if (settings.transcribeRoute === "cloud") {
    transcribeHint = cloudDetail(transcribePrice, keySet);
  }
  let cleanupHint = "The transcript is the note.";
  if (settings.cleanupRoute === "device") {
    cleanupHint = appleCleanupDetail(apple);
  } else if (settings.cleanupRoute === "cloud") {
    cleanupHint = cloudDetail(
      priceOf(catalog.cleanup, settings.cleanupModel),
      keySet
    );
  }

  return (
    <div className="flex flex-col gap-3 px-2.5 py-2">
      <GatewayKey keySet={keySet} onSet={setKeySet} />
      <RouteSwitch
        label="Transcription"
        onPick={(transcribeRoute) => {
          onChange({ ...settings, transcribeRoute });
        }}
        options={transcribeRoutes}
        value={settings.transcribeRoute}
      />
      {settings.transcribeRoute === "device" ? (
        <LocalMenu
          engines={localTranscribers}
          label="Transcription model"
          onPick={(transcribeDevice) => {
            onChange({ ...settings, transcribeDevice });
          }}
          value={settings.transcribeDevice}
        />
      ) : (
        <ModelMenu
          choices={catalog.transcription}
          label="Transcription model"
          onPick={(transcribeModel) => {
            onChange({ ...settings, transcribeModel });
          }}
          value={settings.transcribeModel}
        />
      )}
      <p className="text-muted-foreground text-[11px]">{transcribeHint}</p>
      <RouteSwitch
        label="Cleanup"
        onPick={(cleanupRoute) => {
          onChange({ ...settings, cleanupRoute });
        }}
        options={cleanupRoutes}
        value={settings.cleanupRoute}
      />
      {settings.cleanupRoute === "device" ? (
        <LocalMenu
          engines={localCleanups}
          label="Cleanup model"
          onPick={(cleanupDevice) => {
            onChange({ ...settings, cleanupDevice });
          }}
          value={settings.cleanupDevice}
        />
      ) : null}
      {settings.cleanupRoute === "cloud" ? (
        <ModelMenu
          choices={catalog.cleanup}
          label="Cleanup model"
          onPick={(cleanupModel) => {
            onChange({ ...settings, cleanupModel });
          }}
          value={settings.cleanupModel}
        />
      ) : null}
      <p className="text-muted-foreground text-[11px]">{cleanupHint}</p>
    </div>
  );
};
