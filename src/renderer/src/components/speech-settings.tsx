import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
] as const satisfies readonly {
  id: Exclude<CleanupRoute, "off">;
  label: string;
}[];

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
  if (!keySet) {
    return "No gateway key, so this runs on this Mac.";
  }
  return price.length > 0 ? price : "Cloud model";
};

const GatewayKey = ({
  keySet,
  onSet,
}: {
  keySet: boolean;
  onSet: (set: boolean) => void;
}) => {
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const saveKey = (): void => {
    if (draft.length === 0) {
      return;
    }
    window.slip
      .setCleanupKey(draft)
      .then((saved) => {
        if (saved) {
          onSet(true);
          setDraft("");
          setStatus("Key saved");
          return;
        }
        setStatus("Couldn't save the key");
      })
      .catch(() => {
        setStatus("Couldn't save the key");
      });
  };
  let statusClass = "text-muted-foreground text-[11px]";
  if (status === "Couldn't save the key") {
    statusClass = "text-destructive text-[11px]";
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] leading-none">AI Gateway key</p>
      <p className="text-muted-foreground text-[11px]">
        Stored in the keychain.
      </p>
      <div className="flex gap-1">
        <Input
          aria-label="Vercel AI Gateway API key"
          className="h-7 text-[12px]"
          onBlur={saveKey}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus("");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            saveKey();
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
                  setStatus("");
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
      {status.length > 0 ? <p className={statusClass}>{status}</p> : null}
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
    if (!settings.cleanTranscripts || settings.cleanupRoute !== "device") {
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
  }, [settings.cleanTranscripts, settings.cleanupRoute]);

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
  let cleanupHint = "";
  if (settings.cleanTranscripts && settings.cleanupRoute === "device") {
    cleanupHint = appleCleanupDetail(apple);
  } else if (settings.cleanTranscripts && settings.cleanupRoute === "cloud") {
    cleanupHint = cloudDetail(
      priceOf(catalog.cleanup, settings.cleanupModel),
      keySet
    );
  } else if (settings.cleanTranscripts) {
    cleanupHint = "Kept as spoken.";
  }

  const showKey =
    keySet ||
    settings.transcribeRoute === "cloud" ||
    (settings.cleanTranscripts && settings.cleanupRoute === "cloud");

  return (
    <div className="flex flex-col gap-3 px-2.5 py-2">
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] leading-none">Clean up transcripts</p>
        <Switch
          aria-label="Clean up transcripts"
          checked={settings.cleanTranscripts}
          onCheckedChange={(cleanTranscripts) => {
            onChange({ ...settings, cleanTranscripts });
          }}
          size="sm"
        />
      </div>
      {settings.cleanTranscripts ? (
        <RouteSwitch
          label="Cleanup"
          onPick={(cleanupRoute) => {
            onChange({ ...settings, cleanupRoute });
          }}
          options={cleanupRoutes}
          value={
            settings.cleanupRoute === "off" ? "device" : settings.cleanupRoute
          }
        />
      ) : null}
      {settings.cleanTranscripts && settings.cleanupRoute === "device" ? (
        <LocalMenu
          engines={localCleanups}
          label="Cleanup model"
          onPick={(cleanupDevice) => {
            onChange({ ...settings, cleanupDevice });
          }}
          value={settings.cleanupDevice}
        />
      ) : null}
      {settings.cleanTranscripts && settings.cleanupRoute === "cloud" ? (
        <ModelMenu
          choices={catalog.cleanup}
          label="Cleanup model"
          onPick={(cleanupModel) => {
            onChange({ ...settings, cleanupModel });
          }}
          value={settings.cleanupModel}
        />
      ) : null}
      {cleanupHint.length > 0 ? (
        <p className="text-muted-foreground text-[11px]">{cleanupHint}</p>
      ) : null}
      {showKey ? <GatewayKey keySet={keySet} onSet={setKeySet} /> : null}
    </div>
  );
};
