import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { defaultSettings } from "../../shared/types";

const BARS = 28;
const MAX_VOICE_MS = 5 * 60 * 1000;

const pickMime = (): string => {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
};

const extOf = (mime: string): string => {
  if (mime.includes("mp4")) {
    return "m4a";
  }
  return "webm";
};

const clock = (secs: number): string => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const Wave = ({ bars, live }: { bars: number[]; live: boolean }) => (
  <div className="flex h-7 min-w-0 flex-1 items-center gap-px">
    {bars.map((value, i) => (
      <span
        // oxlint-disable-next-line react/no-array-index-key -- ring buffer
        key={i}
        className={cn(
          "min-h-px w-full rounded-full",
          live ? "bg-primary" : "bg-muted-foreground/35"
        )}
        style={{ height: `${Math.round(14 + value * 86)}%` }}
      />
    ))}
  </div>
);

export const VoiceApp = () => {
  const [settings, setSettings] = useState(defaultSettings);
  const [status, setStatus] = useState<
    "asking" | "denied" | "failed" | "listening"
  >("asking");
  const [bars, setBars] = useState<number[]>(() =>
    Array.from({ length: BARS }, () => 0.06)
  );
  const [secs, setSecs] = useState(0);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  const busyRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const liveRef = useRef(false);
  const pendingRef = useRef(false);
  const capRef = useRef(0);
  const finishRef = useRef<() => void>(() => undefined);
  const histRef = useRef<number[]>(Array.from({ length: BARS }, () => 0.06));

  const dark =
    settings.scheme === "dark" || (settings.scheme === "system" && systemDark);

  const drop = useCallback((): void => {
    liveRef.current = false;
    window.cancelAnimationFrame(rafRef.current);
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    chunksRef.current = [];
    window.clearTimeout(capRef.current);
  }, []);

  const listen = useCallback(async (): Promise<void> => {
    drop();
    busyRef.current = false;
    chunksRef.current = [];
    liveRef.current = true;
    histRef.current = Array.from({ length: BARS }, () => 0.06);
    const granted = await window.slip.askMic();
    if (!liveRef.current) {
      return;
    }
    if (!granted || navigator.mediaDevices?.getUserMedia === undefined) {
      setStatus(granted ? "failed" : "denied");
      if (pendingRef.current) {
        pendingRef.current = false;
        void window.slip.closeVoice();
      }
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      if (liveRef.current) {
        setStatus("denied");
      }
      if (pendingRef.current) {
        pendingRef.current = false;
        void window.slip.closeVoice();
      }
      return;
    }
    if (!liveRef.current) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return;
    }
    streamRef.current = stream;
    const mime = pickMime();
    try {
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
    } catch {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
      setStatus("failed");
      return;
    }
    const audio = new AudioContext();
    void audio.resume();
    const source = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);
    audioCtxRef.current = audio;
    const samples = new Uint8Array(analyser.fftSize);
    let last = 0;
    const tick = (now: number): void => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const n = (sample - 128) / 128;
        sum += n * n;
      }
      const next = Math.min(1, Math.sqrt(sum / samples.length) * 3.4);
      const hist = histRef.current;
      hist.push(next);
      if (hist.length > BARS) {
        hist.shift();
      }
      if (now - last >= 80) {
        last = now;
        setBars([...hist]);
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    setStatus("listening");
    capRef.current = window.setTimeout(() => {
      finishRef.current();
    }, MAX_VOICE_MS);
    if (pendingRef.current) {
      pendingRef.current = false;
      finishRef.current();
    }
  }, [drop]);

  const finish = useCallback((): void => {
    if (busyRef.current) {
      return;
    }
    const recorder = recorderRef.current;
    if (
      (!recorder || recorder.state === "inactive") &&
      chunksRef.current.length === 0
    ) {
      if (liveRef.current) {
        pendingRef.current = true;
        return;
      }
      drop();
      void window.slip.closeVoice();
      return;
    }
    busyRef.current = true;
    liveRef.current = false;
    const mime = recorder?.mimeType ?? pickMime();
    const send = (blob: Blob | null): void => {
      void (async () => {
        drop();
        if (!(blob && blob.size > 44)) {
          void window.slip.closeVoice();
          return;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const slip = await window.slip.createVoiceSlip("Voice note", {
          bytes,
          name: `voice.${extOf(mime)}`,
        });
        if (slip === null) {
          void window.slip.closeVoice();
        }
      })();
    };
    if (!recorder || recorder.state === "inactive") {
      send(new Blob(chunksRef.current, { type: mime || "audio/webm" }));
      return;
    }
    recorder.onstop = () => {
      send(new Blob(chunksRef.current, { type: mime || "audio/webm" }));
    };
    recorder.stop();
  }, [drop]);
  finishRef.current = finish;

  useEffect(() => {
    const boot = async (): Promise<void> => {
      try {
        const data = await window.slip.load();
        setSettings(data.settings);
      } catch {
        // keep defaults
      }
    };
    void boot();
    const offCommit = window.slip.onVoiceCommit(finish);
    const offSettings = window.slip.onSettings(setSettings);
    void window.slip.voiceReady();
    return () => {
      offCommit();
      offSettings();
    };
  }, [finish]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void listen();
    }, 0);
    return () => {
      window.clearTimeout(id);
      drop();
    };
  }, [drop, listen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        drop();
        void window.slip.closeVoice();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [drop]);

  useEffect(() => {
    if (status !== "listening") {
      return () => {
        // idle
      };
    }
    const tick = window.setInterval(() => {
      setSecs((cur) => cur + 1);
    }, 1000);
    return () => {
      window.clearInterval(tick);
    };
  }, [status]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      setSystemDark(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.dataset.accent = settings.accent;
    root.dataset.theme = settings.theme;
    root.dataset.font = settings.font;
    if (settings.font === "news") {
      void import("@fontsource-variable/newsreader/wght.css");
    }
  }, [dark, settings.accent, settings.font, settings.theme]);

  const live = status === "listening";

  return (
    <div
      className={cn(
        "bg-background text-foreground flex h-screen items-center gap-1.5 px-2",
        dark && "dark"
      )}
    >
      {status === "denied" || status === "failed" ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="text-muted-foreground min-w-0 flex-1 truncate text-[12px]">
            {status === "denied" ? "Microphone is off" : "Could not record"}
          </p>
          <Button
            className="press"
            onClick={() => {
              if (status === "denied") {
                void window.slip.openMic();
                return;
              }
              void listen();
            }}
            size="xs"
          >
            {status === "denied" ? "Settings" : "Retry"}
          </Button>
        </div>
      ) : (
        <>
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              live ? "bg-primary animate-pulse" : "bg-muted-foreground/40"
            )}
          />
          <Wave bars={bars} live={live} />
          <span className="text-muted-foreground w-8 shrink-0 text-right text-[11px] tabular-nums">
            {clock(secs)}
          </span>
          <Button
            aria-label="Discard"
            className="press"
            onClick={() => {
              drop();
              void window.slip.closeVoice();
            }}
            size="icon-xs"
            variant="ghost"
          >
            <HugeiconsIcon className="size-3.5" icon={Cancel01Icon} />
          </Button>
          <Button
            aria-label="Save"
            className="press"
            onClick={finish}
            size="icon-xs"
          >
            <HugeiconsIcon className="size-3.5" icon={CheckmarkCircle02Icon} />
          </Button>
        </>
      )}
    </div>
  );
};
