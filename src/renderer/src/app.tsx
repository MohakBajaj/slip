import { Search, Settings as SettingsIcon, X } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import darkIcon from "@/assets/dock-dark.png";
import lightIcon from "@/assets/dock-light.png";
import { Cheatsheet } from "@/components/cheatsheet";
import { Chip } from "@/components/chip";
import { InboxPane } from "@/components/inbox-pane";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copySlip } from "@/lib/copy-slip";
import { filesToPayloads } from "@/lib/drop-images";
import { applyPick } from "@/lib/range-ids";
import { handleSectionMenu, sectionMenuEntries } from "@/lib/section-menu";
import { handleSlipMenu, slipMenuEntries } from "@/lib/slip-menu";
import { runMenuCommand, useSlipHotkeys } from "@/lib/use-slip-hotkeys";

import {
  formatCapture,
  formatDrawHint,
  formatHold,
} from "../../shared/capture-bind";
import { captureLabel } from "../../shared/capture-label";
import type { GrantPrompt } from "../../shared/grants";
import { imageTitle } from "../../shared/images";
import { KEY_REENTER } from "../../shared/key-status";
import {
  groupedRows,
  sectionsOf,
  slipIdsOf,
  visibleSlips,
} from "../../shared/logic";
import { shortcutTip } from "../../shared/shortcuts";
import { clampZoom, defaultSettings } from "../../shared/types";
import type {
  CaptureState,
  LoginState,
  Settings,
  Slip,
} from "../../shared/types";

const CommandPalette = lazy(async () => {
  const mod = await import("@/components/command-palette");
  return { default: mod.CommandPalette };
});

const SettingsPanel = lazy(async () => {
  const mod = await import("@/components/settings-panel");
  return { default: mod.SettingsPanel };
});

const snapshot = (slips: Slip[]): Slip[] =>
  slips.map((slip) => ({
    ...slip,
    audio: [...slip.audio],
    images: [...slip.images],
    tags: [...slip.tags],
  }));

const statusLine = (flash: string, selected: number, open: number): string => {
  if (flash) {
    return flash;
  }
  if (selected > 0) {
    return `${selected} selected`;
  }
  return `${open} open`;
};

const patchLabel = (next: Partial<Slip>): string | null => {
  if (next.archived === true) {
    return "Archived";
  }
  if (next.archived === false) {
    return "Restored";
  }
  if (next.done === true) {
    return "Done";
  }
  if (next.done === false) {
    return "Reopened";
  }
  if (next.images) {
    return "Updated images";
  }
  if (next.content !== undefined) {
    return "Edited";
  }
  return null;
};

const App = () => {
  const [slips, setSlips] = useState<Slip[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [capture, setCapture] = useState<CaptureState>("off");
  const [login, setLogin] = useState<LoginState>("unknown");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const [marked, setMarked] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [binding, setBinding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [flash, setFlash] = useState("");
  const [grants, setGrants] = useState<GrantPrompt[]>([]);
  const [keyNote, setKeyNote] = useState("");
  const [keyFocus, setKeyFocus] = useState(0);
  const [undo, setUndo] = useState<{
    drop: string[];
    held: string[];
    label: string;
    slips: Slip[];
  } | null>(null);
  const undoRef = useRef(undo);
  undoRef.current = undo;

  const loadInbox = useCallback(async () => {
    const data = await window.slip.load();
    setSlips(data.slips);
    setSettings(data.settings);
    setCapture(data.capture);
    setLogin(data.login);
  }, []);

  const reloadSlips = useCallback(async () => {
    const data = await window.slip.load();
    setSlips(data.slips);
  }, []);

  useEffect(() => {
    let live = true;
    const readGrants = (): void => {
      window.slip
        .grantStatus()
        .then((rows) => {
          if (live) {
            setGrants(rows);
          }
        })
        .catch(() => undefined);
      window.slip
        .cleanupKeyStatus()
        .then((status) => {
          if (live) {
            setKeyNote(status === "reenter" ? KEY_REENTER : "");
          }
        })
        .catch(() => undefined);
    };
    readGrants();
    window.addEventListener("focus", readGrants);
    return () => {
      live = false;
      window.removeEventListener("focus", readGrants);
    };
  }, [settingsOpen]);

  useEffect(() => {
    loadInbox().catch(() => undefined);
    const offSlips = window.slip.onSlipsChanged(() => {
      reloadSlips().catch(() => undefined);
    });
    const offCapture = window.slip.onCaptureState(setCapture);
    const offLogin = window.slip.onLoginState(setLogin);
    const offSettings = window.slip.onSettings(setSettings);
    return () => {
      offSlips();
      offCapture();
      offLogin();
      offSettings();
    };
  }, [loadInbox, reloadSlips]);

  useEffect(() => {
    window.slip.setSection(section).catch(() => undefined);
  }, [section]);

  const say = (line: string): void => {
    setFlash(line);
    window.setTimeout(() => setFlash((cur) => (cur === line ? "" : cur)), 2200);
  };

  const remember = useCallback(
    (
      label: string,
      ids: string[],
      drop: string[] = [],
      held: string[] = []
    ): void => {
      const prev = undoRef.current;
      if (prev !== null && prev.held.length > 0) {
        window.slip.commitDeletes(prev.held).catch(() => undefined);
      }
      setUndo({
        drop,
        held,
        label,
        slips: snapshot(slips.filter((slip) => ids.includes(slip.id))),
      });
      say(`${label}. ⌘Z to undo`);
    },
    [slips]
  );

  const goToSlip = useCallback(
    (id: string): void => {
      const slip = slips.find((item) => item.id === id);
      setSettingsOpen(false);
      setSection("");
      setShowArchived(Boolean(slip?.archived));
      setFocused(id);
      setMarked([]);
      setPaletteOpen(false);
    },
    [slips]
  );

  useEffect(() => window.slip.onRevealSlip(goToSlip), [goToSlip]);

  const runUndo = useCallback(async (): Promise<void> => {
    if (!undo) {
      return;
    }
    await window.slip.restoreSlips(undo.slips, undo.drop);
    setUndo(null);
    say("Undone");
    await reloadSlips();
  }, [reloadSlips, undo]);

  const list = useMemo(
    () => visibleSlips(slips, query, settings.showDone, showArchived),
    [query, settings.showDone, showArchived, slips]
  );
  const listIds = useMemo(() => slipIdsOf(groupedRows(list)), [list]);
  const sections = useMemo(() => sectionsOf(slips), [slips]);
  const current = list.find((slip) => slip.id === focused) ?? null;
  useEffect(() => {
    if (
      editingId !== null &&
      (settingsOpen || marked.length > 1 || current?.id !== editingId)
    ) {
      setEditingId(null);
    }
  }, [current, editingId, marked.length, settingsOpen]);
  let subject = slips.filter((slip) => marked.includes(slip.id));
  if (subject.length === 0 && current) {
    subject = [current];
  }

  const writeSettings = (next: Settings): void => {
    setSettings(next);
    window.slip.saveSettings(next).catch(() => undefined);
  };

  const apply = async (ids: string[], next: Partial<Slip>): Promise<void> => {
    if (ids.length === 0) {
      return;
    }
    const label = patchLabel(next);
    if (label !== null) {
      remember(label, ids);
    }
    setSlips(await window.slip.updateSlips(ids, next));
    if (ids.length > 1) {
      setMarked([]);
    }
  };

  const toggle = (ids: string[], key: "archived" | "done"): void => {
    const items = slips.filter((slip) => ids.includes(slip.id));
    if (items.length === 0) {
      return;
    }
    apply(ids, { [key]: !items.every((item) => item[key]) }).catch(
      () => undefined
    );
  };

  const attachFiles = async (id: string, files: File[]): Promise<void> => {
    const payloads = await filesToPayloads(files);
    if (payloads.length === 0) {
      return;
    }
    const slip = await window.slip.addImages(id, payloads);
    if (slip === null) {
      return;
    }
    remember("Added images", [id]);
    setFocused(id);
    setSlips((cur) => cur.map((item) => (item.id === slip.id ? slip : item)));
  };

  const addFromFiles = async (
    files: File[],
    content?: string
  ): Promise<boolean> => {
    const payloads = await filesToPayloads(files);
    const [first] = payloads;
    if (
      first === undefined &&
      (content === undefined || content.length === 0)
    ) {
      return false;
    }
    const slip = await window.slip.createSlip(
      content !== undefined && content.length > 0
        ? content
        : imageTitle(first?.name ?? "image"),
      payloads
    );
    if (slip === null) {
      return false;
    }
    remember("Added", [], [slip.id]);
    setShowArchived(false);
    setSlips((cur) => [...cur, slip]);
    setFocused(slip.id);
    return true;
  };

  const removeSlips = async (ids: string[]): Promise<void> => {
    const doomed = slips.filter((slip) => ids.includes(slip.id));
    if (doomed.length === 0) {
      return;
    }
    const drop = doomed.map((slip) => slip.id);
    remember("Deleted", drop, [], drop);
    setSlips(await window.slip.deleteSlips(drop));
    setMarked((cur) => cur.filter((id) => !drop.includes(id)));
    setFocused((cur) => (cur !== null && drop.includes(cur) ? null : cur));
  };

  const pick = (id: string, mods: { meta: boolean; shift: boolean }): void => {
    const next = applyPick(listIds, focused, marked, id, mods);
    setFocused(next.focused);
    setMarked(next.marked);
  };

  const copyList = useCallback(async () => {
    const ids = subject.map((slip) => slip.id);
    if (ids.length === 0) {
      return;
    }
    await window.slip.copyList(ids);
    say("Copied as list");
  }, [subject]);

  const copyPrompt = useCallback(async () => {
    const ids = subject.map((slip) => slip.id);
    if (ids.length === 0) {
      return;
    }
    await window.slip.copyPrompt(ids);
    say("Copied as prompt");
  }, [subject]);

  const copyFocused = useCallback(async (): Promise<void> => {
    if (subject.length > 1) {
      await copyList();
      return;
    }
    const [slip] = subject;
    if (slip === undefined) {
      return;
    }
    await copySlip(slip);
    say("Copied");
  }, [copyList, subject]);

  const copyNamed = (line: string, run: () => Promise<void>): void => {
    run()
      .then(() => say(line))
      .catch(() => undefined);
  };

  const mergeItems = useCallback(
    async (items: Slip[], intoSection?: string): Promise<void> => {
      if (items.length < 2) {
        return;
      }
      remember(
        "Merged",
        items.map((slip) => slip.id)
      );
      if (intoSection !== undefined) {
        setSection(intoSection);
        await window.slip.setSection(intoSection);
      }
      const result = await window.slip.mergeSlips(
        items.map((slip) => slip.id),
        intoSection
      );
      if (result === null) {
        return;
      }
      setUndo((cur) => (cur ? { ...cur, drop: [result.created.id] } : cur));
      setSlips(result.slips);
      setFocused(result.created.id);
      setMarked([]);
    },
    [remember]
  );

  const merge = useCallback(async () => {
    await mergeItems(subject);
  }, [mergeItems, subject]);

  const stopRename = (): void => {
    if (renaming === null) {
      return;
    }
    setRenaming(null);
    setDraft("");
  };

  const renameSection = async (from: string, to: string): Promise<void> => {
    const named = to.trim();
    if (named.length === 0 || named.toLowerCase() === "inbox") {
      stopRename();
      return;
    }
    if (named === from) {
      stopRename();
      return;
    }
    const ids = slips
      .filter((slip) => slip.section === from)
      .map((slip) => slip.id);
    remember("Renamed section", ids);
    setSlips(await window.slip.updateSlips(ids, { section: named }));
    setSection(named);
    stopRename();
  };

  const membersOf = (name: string): Slip[] =>
    slips.filter(
      (slip) => slip.section === name && slip.archived === showArchived
    );

  const openSlipMenu = async (slip: Slip): Promise<void> => {
    const useSet = marked.length > 1 && marked.includes(slip.id);
    const scope = useSet ? marked : [slip.id];
    const scoped = slips.filter((item) => scope.includes(item.id));
    const setDone = scoped.every((item) => item.done);
    const setArchived = scoped.every((item) => item.archived);
    const id = await window.slip.popupMenu(
      slipMenuEntries({
        canSelectTo: focused !== null && focused !== slip.id,
        manyMarked: marked.length > 1,
        marked: marked.includes(slip.id),
        sections,
        setArchived,
        setDone,
        shortcuts: settings.shortcuts,
        slip,
      })
    );
    handleSlipMenu(id, slip, {
      copy: (item) => {
        copyNamed("Copied", () => copySlip(item));
      },
      copyList: () => {
        copyList().catch(() => undefined);
      },
      copyPath: (itemId) => {
        copyNamed("Copied path", () => window.slip.copyPath(itemId));
      },
      copyPrompt: (itemIds) => {
        copyNamed("Copied as prompt", () => window.slip.copyPrompt(itemIds));
      },
      copyRef: (itemId) => {
        copyNamed("Copied @", () => window.slip.copyAtRef(itemId));
      },
      edit: (item) => {
        setFocused(item.id);
        setMarked([]);
        setEditingId(item.id);
      },
      merge: () => {
        merge().catch(() => undefined);
      },
      patch: (ids, next) => {
        apply(ids, next).catch(() => undefined);
      },
      pick,
      remove: (ids) => {
        removeSlips(ids).catch(() => undefined);
      },
      scope,
      setArchived,
      setDone,
    });
  };

  const openHeaderMenu = async (name: string): Promise<void> => {
    const members = membersOf(name);
    const ids = members.map((slip) => slip.id);
    const allDone = members.length > 0 && members.every((slip) => slip.done);
    const allArchived =
      members.length > 0 && members.every((slip) => slip.archived);
    const id = await window.slip.popupMenu(
      sectionMenuEntries({
        allArchived,
        allDone,
        canMerge: members.length > 1,
      })
    );
    handleSectionMenu(id, {
      archive: () => {
        apply(ids, { archived: !allArchived }).catch(() => undefined);
      },
      copyList: () => {
        if (ids.length === 0) {
          return;
        }
        copyNamed("Copied as list", () => window.slip.copyList(ids));
      },
      copyPrompt: () => {
        if (ids.length === 0) {
          return;
        }
        copyNamed("Copied as prompt", () => window.slip.copyPrompt(ids));
      },
      dissolve: () => {
        const every = slips
          .filter((slip) => slip.section === name)
          .map((slip) => slip.id);
        remember("Removed section", every);
        apply(every, { section: "" })
          .then(() => {
            if (section === name) {
              setSection("");
            }
          })
          .catch(() => undefined);
      },
      done: () => {
        apply(ids, { done: !allDone }).catch(() => undefined);
      },
      merge: () => {
        mergeItems(members, name).catch(() => undefined);
      },
      rename: () => {
        setShowArchived(false);
        setSection(name);
        setRenaming(name);
        setDraft(name);
        setMarked([]);
        setFocused(null);
      },
      select: () => {
        const visible = list
          .filter((slip) => slip.section === name)
          .map((slip) => slip.id);
        setMarked(visible);
        setFocused(visible[0] ?? null);
      },
      use: () => {
        setSection(name);
        setShowArchived(false);
        stopRename();
      },
    });
  };

  useEffect(() => {
    const off = window.slip.onCommand((name) => {
      runMenuCommand(name, {
        cheatsheet: () => {
          setPaletteOpen(false);
          setHelpOpen((open) => !open);
        },
        compose: () => {
          setSettingsOpen(false);
          setPaletteOpen(false);
          setHelpOpen(false);
          setShowArchived(false);
          setEditingId(null);
          setFocused(null);
          setMarked([]);
          setRenaming(null);
          window.setTimeout(() => {
            document
              .querySelector<HTMLTextAreaElement>("[data-composer]")
              ?.focus();
          }, 50);
        },
        copy_as_list: () => {
          copyList().catch(() => undefined);
        },
        copy_as_prompt: () => {
          copyPrompt().catch(() => undefined);
        },
        merge: () => {
          merge().catch(() => undefined);
        },
        palette: () => {
          setHelpOpen(false);
          setPaletteOpen(true);
        },
        search: () => {
          setSettingsOpen(false);
          setPaletteOpen(false);
          setHelpOpen(false);
          window.setTimeout(() => {
            const node =
              document.querySelector<HTMLInputElement>("[data-search]");
            node?.focus();
            node?.select();
          }, 50);
        },
        settings: () => {
          setHelpOpen(false);
          setPaletteOpen(false);
          setSettingsOpen(true);
        },
        undo: () => {
          runUndo().catch(() => undefined);
        },
        voice: () => {
          void window.slip.openVoice();
        },
        zoom_in: () => {
          writeSettings({ ...settings, zoom: clampZoom(settings.zoom + 0.1) });
        },
        zoom_out: () => {
          writeSettings({ ...settings, zoom: clampZoom(settings.zoom - 0.1) });
        },
        zoom_reset: () => {
          writeSettings({ ...settings, zoom: 1 });
        },
      });
    });
    return off;
  }, [copyList, copyPrompt, merge, runUndo, settings]);

  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const dark =
    settings.scheme === "dark" || (settings.scheme === "system" && systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.dataset.accent = settings.accent;
    root.dataset.theme = settings.theme;
    root.dataset.font = settings.font;
    if (settings.font === "geist") {
      void import("@fontsource-variable/geist/wght.css");
    }
    if (settings.font === "news") {
      void import("@fontsource-variable/newsreader/wght.css");
    }
  }, [dark, settings.accent, settings.font, settings.theme]);

  const clearRangeAnchor = useSlipHotkeys({
    binding,
    editing: editingId !== null,
    focused,
    helpOpen,
    listIds,
    marked,
    onAnnotate: () => {
      const imagePath = current?.images[0];
      if (current === null || imagePath === undefined) {
        return;
      }
      window.slip
        .openDraw({ imagePath, slipId: current.id })
        .catch(() => undefined);
    },
    onArchive: () => {
      if (marked.length > 0) {
        toggle(marked, "archived");
        return;
      }
      const slip = current ?? slips.find((item) => item.id === focused);
      if (slip) {
        toggle([slip.id], "archived");
      }
    },
    onCheatsheet: () => {
      setPaletteOpen(false);
      setHelpOpen((open) => !open);
    },
    onCompose: () => {
      setSettingsOpen(false);
      setPaletteOpen(false);
      setHelpOpen(false);
      setShowArchived(false);
      setEditingId(null);
      setFocused(null);
      setMarked([]);
      setRenaming(null);
      window.setTimeout(() => {
        document.querySelector<HTMLTextAreaElement>("[data-composer]")?.focus();
      }, 50);
    },
    onCopy: () => {
      copyFocused().catch(() => undefined);
    },
    onDelete: () => {
      let ids: string[] = [];
      if (marked.length > 0) {
        ids = marked;
      } else if (current) {
        ids = [current.id];
      }
      removeSlips(ids).catch(() => undefined);
    },
    onEdit: () => {
      if (current === null) {
        return;
      }
      setFocused(current.id);
      setMarked([]);
      setEditingId(current.id);
    },
    onOpen: () => {
      if (focused !== null) {
        return;
      }
      const [first] = listIds;
      if (first !== undefined) {
        setFocused(first);
        setMarked([]);
      }
    },
    onPalette: () => {
      setHelpOpen(false);
      setPaletteOpen((open) => !open);
    },
    onPin: () => {
      let ids: string[] = [];
      if (marked.length > 0) {
        ids = marked;
      } else if (current) {
        ids = [current.id];
      }
      const items = slips.filter((slip) => ids.includes(slip.id));
      if (items.length === 0) {
        return;
      }
      apply(ids, { pin: !items.every((slip) => slip.pin) }).catch(
        () => undefined
      );
    },
    onSearch: () => {
      setSettingsOpen(false);
      setPaletteOpen(false);
      setHelpOpen(false);
      window.setTimeout(() => {
        const node = document.querySelector<HTMLInputElement>("[data-search]");
        node?.focus();
        node?.select();
      }, 50);
    },
    onSettings: () => {
      setHelpOpen(false);
      setPaletteOpen(false);
      setSettingsOpen(true);
    },
    onToggleDone: () => {
      if (marked.length > 0) {
        toggle(marked, "done");
        return;
      }
      if (current) {
        toggle([current.id], "done");
      }
    },
    onUndo: () => {
      runUndo().catch(() => undefined);
    },
    paletteOpen,
    setFocused,
    setHelpOpen,
    setMarked,
    setQuery,
    setSettingsOpen,
    settingsOpen,
    shortcuts: settings.shortcuts,
  });

  const chordName = formatCapture(settings.capture);
  const noteName = formatCapture(settings.noteCapture);
  const voiceName = formatHold(settings.voiceCapture);
  const drawName = formatDrawHint(settings.drawCapture);
  const emptyHints = [
    settings.capture.length > 0
      ? { keys: chordName, text: "a selection" }
      : null,
    { keys: "fn", text: "to dictate" },
    settings.annotateOut.length > 0
      ? { keys: formatCapture(settings.annotateOut), text: "to annotate" }
      : null,
    settings.noteCapture.length > 0
      ? { keys: noteName, text: "for a note" }
      : null,
    settings.voiceCapture.length > 0
      ? { keys: voiceName, text: "to speak" }
      : null,
    settings.drawCapture.length > 0
      ? { keys: drawName, text: "to draw" }
      : null,
  ].filter((hint) => hint !== null);
  let emptyCopy: ReactNode = (
    <div className="flex flex-col items-center gap-1">
      {emptyHints.map((hint) => (
        <p key={hint.text}>
          <kbd className="font-sans font-medium whitespace-nowrap">
            {hint.keys}
          </kbd>{" "}
          {hint.text}
        </p>
      ))}
      <p>Drop images, or type below.</p>
    </div>
  );
  if (showArchived) {
    emptyCopy = "No archived jots";
  }
  if (query.trim()) {
    emptyCopy = `No jots match "${query.trim()}"`;
  }

  return (
    <div
      className={`bg-background text-foreground relative flex h-screen min-w-0 flex-col overflow-hidden scroll-smooth antialiased ${dark ? "dark" : ""} ${settingsOpen ? "no-pick" : ""}`}
      data-accent={settings.accent}
      data-font={settings.font}
      data-theme={settings.theme}
    >
      <header className="drag flex flex-col">
        <div className="flex h-9.5 items-center gap-2 pr-2.5">
          <div className="flex min-w-0 items-center gap-1.5 pl-20">
            <img
              alt=""
              className={`pointer-events-none size-4 rounded-[4.5px] outline ${dark ? "outline-white/10" : "outline-black/10"}`}
              draggable={false}
              src={dark ? darkIcon : lightIcon}
            />
            <p className="truncate text-[13px] font-medium">Jot</p>
          </div>
          {settingsOpen ? null : (
            <div className="no-drag ml-auto flex shrink-0 gap-1">
              <Chip
                on={!showArchived}
                onClick={() => {
                  stopRename();
                  setSection("");
                  setShowArchived(false);
                  setMarked([]);
                }}
              >
                Inbox
              </Chip>
              <Chip
                on={showArchived}
                onClick={() => {
                  stopRename();
                  setShowArchived((value) => !value);
                  setMarked([]);
                }}
              >
                Archive
              </Chip>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-2.5 pb-1.5">
          {settingsOpen ? (
            <p className="min-w-0 flex-1 text-[13px] font-medium text-pretty">
              Settings
            </p>
          ) : (
            <div className="no-drag relative min-w-0 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
              <Input
                autoComplete="off"
                autoCorrect="off"
                className={`h-7 pl-7 text-[13px] ${query ? "pr-7" : ""}`}
                data-search=""
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search jots"
                spellCheck={false}
                title={shortcutTip("Search", settings.shortcuts.search)}
                value={query}
              />
              {query ? (
                <Button
                  aria-label="Clear search"
                  className="press absolute top-1/2 right-0.5 -translate-y-1/2"
                  onClick={() => setQuery("")}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-3" />
                </Button>
              ) : null}
            </div>
          )}
          <Button
            aria-label="Command palette"
            className="press no-drag relative after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-['']"
            title={shortcutTip("Commands", settings.shortcuts.palette)}
            onClick={() => setPaletteOpen(true)}
            size="icon-sm"
            variant="ghost"
          >
            <span className="text-[11px] font-medium">⌘K</span>
          </Button>
          <Button
            aria-label={settingsOpen ? "Close settings" : "Settings"}
            className="press no-drag relative after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-['']"
            title={
              settingsOpen
                ? shortcutTip("Close", settings.shortcuts.dismiss)
                : shortcutTip("Settings", settings.shortcuts.settings)
            }
            onClick={() => {
              stopRename();
              setSettingsOpen((value) => !value);
            }}
            size={settingsOpen ? "sm" : "icon-sm"}
            variant="ghost"
          >
            {settingsOpen ? (
              <span className="text-[11px]">Done</span>
            ) : (
              <SettingsIcon className="size-3.5" />
            )}
          </Button>
        </div>
      </header>

      {keyNote.length > 0 ? (
        <div className="bg-card mx-2.5 mb-1.5 flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[11px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          <p>{keyNote}</p>
          <Button
            className="press"
            onClick={() => {
              setSettingsOpen(true);
              setKeyFocus((value) => value + 1);
            }}
            size="xs"
          >
            Enter key
          </Button>
        </div>
      ) : null}
      {grants
        .filter((grant) => !(grant.id === "access" && capture === "denied"))
        .map((grant) => (
          <div
            className="bg-card mx-2.5 mb-1.5 flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[11px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
            key={grant.id}
          >
            <p>{grant.detail}</p>
            <Button
              className="press"
              onClick={() => {
                if (grant.id === "access") {
                  window.slip.openAccess().catch(() => undefined);
                  return;
                }
                if (grant.id === "input") {
                  window.slip.openInput().catch(() => undefined);
                  return;
                }
                if (grant.id === "microphone") {
                  window.slip
                    .askMic()
                    .then(() => window.slip.grantStatus())
                    .then(setGrants)
                    .catch(() => undefined);
                  return;
                }
                window.slip.openScreen().catch(() => undefined);
              }}
              size="xs"
            >
              Allow
            </Button>
          </div>
        ))}
      {capture === "denied" ? (
        <div className="bg-card mx-2.5 mb-1.5 flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          <p>Capture and paste need Accessibility.</p>
          <Button
            onClick={() => {
              window.slip.openAccess().catch(() => undefined);
            }}
            className="press"
            size="xs"
          >
            Open Settings
          </Button>
        </div>
      ) : null}
      {capture === "failed" ? (
        <div className="bg-card mx-2.5 mb-1.5 flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          <p>Shortcuts could not start.</p>
          <Button
            className="press"
            onClick={() => {
              window.slip.openAccess().catch(() => undefined);
            }}
            size="xs"
          >
            Open Settings
          </Button>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Suspense fallback={null}>
            <SettingsPanel
              dark={dark}
              focusKey={keyFocus}
              login={login}
              onBind={setBinding}
              onChange={writeSettings}
              onLogin={setLogin}
              settings={settings}
            />
          </Suspense>
        </div>
      ) : (
        <InboxPane
          bulk={
            marked.length > 0
              ? {
                  archiveLabel: subject.every((slip) => slip.archived)
                    ? "Restore"
                    : "Archive",
                  archiveTip: shortcutTip(
                    subject.every((slip) => slip.archived)
                      ? "Restore"
                      : "Archive",
                    settings.shortcuts.archive
                  ),
                  canDelete: true,
                  canMerge: marked.length > 1,
                  copyTip: shortcutTip("Copy", settings.shortcuts.copy),
                  deleteTip: shortcutTip("Delete", settings.shortcuts.delete),
                  doneLabel: subject.every((slip) => slip.done)
                    ? "Reopen"
                    : "Done",
                  doneTip: shortcutTip(
                    subject.every((slip) => slip.done) ? "Reopen" : "Done",
                    settings.shortcuts.done
                  ),
                  fileValue: subject.every(
                    (slip) => slip.section === subject[0]?.section
                  )
                    ? (subject[0]?.section ?? "")
                    : "",
                  onArchive: () => {
                    toggle(marked, "archived");
                  },
                  onClear: () => setMarked([]),
                  onCopyList: () => {
                    copyList().catch(() => undefined);
                  },
                  onCopyPrompt: () => {
                    copyPrompt().catch(() => undefined);
                  },
                  onDelete: () => {
                    removeSlips(marked).catch(() => undefined);
                  },
                  onDone: () => {
                    toggle(marked, "done");
                  },
                  onMerge: () => {
                    merge().catch(() => undefined);
                  },
                }
              : null
          }
          current={marked.length > 1 ? null : current}
          draft={draft}
          editing={
            editingId !== null &&
            editingId === current?.id &&
            marked.length <= 1
          }
          emptyCopy={emptyCopy}
          focused={focused}
          onVoice={() => {
            void window.slip.openVoice();
          }}
          list={list}
          marked={marked}
          onCancelRename={stopRename}
          onAddImages={(id, files) => {
            attachFiles(id, files).catch(() => undefined);
          }}
          onDelete={(id) => {
            removeSlips([id]).catch(() => undefined);
          }}
          onCopy={(slip) => {
            if (marked.length > 1 && marked.includes(slip.id)) {
              copyList().catch(() => undefined);
              return;
            }
            copyNamed("Copied", () => copySlip(slip));
          }}
          onCopyAs={(kind) => {
            if (current === null) {
              return;
            }
            if (kind === "copy") {
              copyNamed("Copied", () => copySlip(current));
              return;
            }
            if (kind === "ref") {
              copyNamed("Copied @", () => window.slip.copyAtRef(current.id));
              return;
            }
            if (kind === "path") {
              copyNamed("Copied path", () => window.slip.copyPath(current.id));
              return;
            }
            copyNamed("Copied as prompt", () =>
              window.slip.copyPrompt([current.id])
            );
          }}
          onEditing={(on) => {
            setEditingId(on ? (current?.id ?? null) : null);
          }}
          onCreateImages={(files) => {
            addFromFiles(files).catch(() => undefined);
          }}
          onDraft={setDraft}
          onFile={(name) => {
            remember("Filed", marked);
            apply(marked, { section: name }).catch(() => undefined);
          }}
          onFocus={(id) => {
            clearRangeAnchor();
            setFocused(id);
            setMarked([]);
          }}
          onHeaderMenu={(name) => {
            openHeaderMenu(name).catch(() => undefined);
          }}
          onMenu={(slip) => {
            openSlipMenu(slip).catch(() => undefined);
          }}
          onPick={(id, mods) => {
            clearRangeAnchor();
            pick(id, mods);
          }}
          onPatch={(id, next) => {
            apply([id], next).catch(() => undefined);
          }}
          onSection={(name) => {
            stopRename();
            setSection(name);
            setMarked([]);
          }}
          onSubmit={(files) => {
            const text = draft.trim();
            if (renaming !== null) {
              if (!text) {
                return;
              }
              renameSection(renaming, text).catch(() => undefined);
              return;
            }
            if (!(text || files.length > 0)) {
              return;
            }
            addFromFiles(files, text || undefined)
              .then((ok) => {
                if (ok) {
                  setDraft("");
                }
              })
              .catch(() => undefined);
          }}
          renaming={renaming}
          section={section}
          sections={sections}
          shortcuts={settings.shortcuts}
        />
      )}

      <footer className="text-muted-foreground flex items-center justify-between px-2.5 pb-1.5 text-[11px] tabular-nums">
        <span>
          {statusLine(
            flash,
            marked.length,
            list.filter((slip) => !slip.done).length
          )}
        </span>
        <span>{capture === "failed" ? "" : captureLabel(capture)}</span>
      </footer>

      {helpOpen ? (
        <Cheatsheet
          anywhere={[
            { keys: "hold fn", label: "Dictate anywhere" },
            ...(settings.annotateOut.length > 0
              ? [
                  {
                    keys: formatCapture(settings.annotateOut),
                    label: "Annotate anywhere",
                  },
                ]
              : []),
            ...(settings.dictateCapture.length > 0
              ? [
                  {
                    keys: formatCapture(settings.dictateCapture),
                    label: "Dictate shortcut",
                  },
                ]
              : []),
          ]}
          onClose={() => {
            setHelpOpen(false);
          }}
          shortcuts={settings.shortcuts}
        />
      ) : null}

      {paletteOpen ? (
        <Suspense fallback={null}>
          <CommandPalette
            onCheatsheet={() => {
              setPaletteOpen(false);
              setHelpOpen((open) => !open);
            }}
            onCopyList={() => {
              setSettingsOpen(false);
              copyList().catch(() => undefined);
              setPaletteOpen(false);
            }}
            onCopyPrompt={() => {
              setSettingsOpen(false);
              copyPrompt().catch(() => undefined);
              setPaletteOpen(false);
            }}
            onAnnotate={() => {
              void window.slip.openAnnotate();
              setPaletteOpen(false);
            }}
            onDictate={() => {
              void window.slip.openDictate();
              setPaletteOpen(false);
            }}
            onDraw={() => {
              window.slip.openDraw().catch(() => undefined);
              setPaletteOpen(false);
            }}
            onVoice={() => {
              void window.slip.openVoice();
              setPaletteOpen(false);
            }}
            onInbox={() => {
              setSettingsOpen(false);
              setPaletteOpen(false);
            }}
            onMerge={() => {
              setSettingsOpen(false);
              merge().catch(() => undefined);
              setPaletteOpen(false);
            }}
            onOpen={goToSlip}
            onOpenChange={setPaletteOpen}
            onOpenVault={() => {
              window.slip.openVault().catch(() => undefined);
              setPaletteOpen(false);
            }}
            onSelectAll={() => {
              setMarked(listIds);
              setPaletteOpen(false);
            }}
            onSettings={() => {
              setSettingsOpen(true);
              setPaletteOpen(false);
            }}
            onUndo={() => {
              runUndo().catch(() => undefined);
              setPaletteOpen(false);
            }}
            open
            settingsOpen={settingsOpen}
            shortcuts={settings.shortcuts}
            slips={slips}
            subjectCount={subject.length}
            undoLabel={undo?.label ?? null}
          />
        </Suspense>
      ) : null}
    </div>
  );
};

export default App;
