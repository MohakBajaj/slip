import {
  Cancel01Icon,
  Search01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CommandPalette } from "@/components/command-palette";
import { InboxPane } from "@/components/inbox-pane";
import { SettingsPanel } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copySlip } from "@/lib/copy-slip";
import { applyPick } from "@/lib/range-ids";
import { handleSectionMenu, sectionMenuEntries } from "@/lib/section-menu";
import { handleSlipMenu, slipMenuEntries } from "@/lib/slip-menu";
import { runMenuCommand, useSlipHotkeys } from "@/lib/use-slip-hotkeys";

import { formatCapture } from "../../shared/capture-bind";
import {
  groupedRows,
  sectionsOf,
  slipIdsOf,
  visibleSlips,
} from "../../shared/logic";
import { clampZoom, defaultSettings } from "../../shared/types";
import type {
  CaptureState,
  LoginState,
  Settings,
  Slip,
} from "../../shared/types";

const snapshot = (slips: Slip[]): Slip[] =>
  slips.map((slip) => ({
    ...slip,
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [flash, setFlash] = useState("");
  const [undo, setUndo] = useState<{
    drop: string[];
    label: string;
    slips: Slip[];
  } | null>(null);

  const reload = useCallback(async () => {
    const data = await window.slip.load();
    setSlips(data.slips);
    setSettings(data.settings);
    setCapture(data.capture);
    setLogin(data.login);
  }, []);

  useEffect(() => {
    reload().catch(() => undefined);
    const offA = window.slip.onSlipsChanged(() => {
      reload().catch(() => undefined);
    });
    const offB = window.slip.onCaptureState(setCapture);
    const offC = window.slip.onLoginState(setLogin);
    return () => {
      offA();
      offB();
      offC();
    };
  }, [reload]);

  useEffect(() => {
    window.slip.setSection(section).catch(() => undefined);
  }, [section]);

  const say = (line: string): void => {
    setFlash(line);
    window.setTimeout(() => setFlash((cur) => (cur === line ? "" : cur)), 2200);
  };

  const remember = useCallback(
    (label: string, drop: string[] = []): void => {
      setUndo({ drop, label, slips: snapshot(slips) });
      say(`${label} — ⌘Z`);
    },
    [slips]
  );

  const goToSlip = (id: string): void => {
    const slip = slips.find((item) => item.id === id);
    setSettingsOpen(false);
    setSection("");
    setShowArchived(Boolean(slip?.archived));
    setFocused(id);
    setMarked([]);
    setPaletteOpen(false);
  };

  const runUndo = useCallback(async (): Promise<void> => {
    if (!undo) {
      return;
    }
    await window.slip.restoreSlips(undo.slips, undo.drop);
    setUndo(null);
    say("Undone");
    await reload();
  }, [reload, undo]);

  const list = useMemo(
    () => visibleSlips(slips, query, settings.showDone, showArchived),
    [query, settings.showDone, showArchived, slips]
  );
  const listIds = useMemo(() => slipIdsOf(groupedRows(list)), [list]);
  const sections = useMemo(() => sectionsOf(slips), [slips]);
  const current = list.find((slip) => slip.id === focused) ?? null;
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
      remember(label);
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
      remember("Merged");
      if (intoSection !== undefined) {
        setSection(intoSection);
        await window.slip.setSection(intoSection);
      }
      const content = items.map((slip) => slip.content.trim()).join("\n\n");
      const created = await window.slip.createSlip(content);
      if (created !== null) {
        setUndo((cur) => (cur ? { ...cur, drop: [created.id] } : cur));
      }
      setSlips(
        await window.slip.updateSlips(
          items.map((slip) => slip.id),
          { archived: true }
        )
      );
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
    remember("Renamed section");
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
      merge: () => {
        merge().catch(() => undefined);
      },
      patch: (ids, next) => {
        apply(ids, next).catch(() => undefined);
      },
      pick,
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
        remember("Removed section");
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
        copy_as_list: () => {
          copyList().catch(() => undefined);
        },
        copy_as_prompt: () => {
          copyPrompt().catch(() => undefined);
        },
        merge: () => {
          merge().catch(() => undefined);
        },
        palette: () => setPaletteOpen(true),
        settings: () => setSettingsOpen(true),
        undo: () => {
          runUndo().catch(() => undefined);
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
  }, [dark, settings.accent, settings.font, settings.theme]);

  useSlipHotkeys({
    focused,
    listIds,
    marked,
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
    onCopy: () => {
      copyFocused().catch(() => undefined);
    },
    onPalette: () => {
      setPaletteOpen((open) => !open);
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
    paused: binding,
    setFocused,
    setMarked,
    setQuery,
    setSettingsOpen,
    settingsOpen,
    shortcuts: settings.shortcuts,
  });

  const chordName = formatCapture(settings.capture);
  let emptyCopy = `${chordName} a selection, or type below.`;
  if (query) {
    emptyCopy = "No matches";
  }

  return (
    <div
      className={`bg-background text-foreground flex h-screen flex-col ${dark ? "dark" : ""} ${settingsOpen ? "no-pick" : ""}`}
      data-accent={settings.accent}
      data-font={settings.font}
      data-theme={settings.theme}
    >
      <header className="drag flex items-center gap-1.5 px-2.5 pt-10 pb-1.5">
        {settingsOpen ? (
          <p className="min-w-0 flex-1 text-[13px] font-medium text-pretty">
            Settings
          </p>
        ) : (
          <div className="no-drag relative min-w-0 flex-1">
            <HugeiconsIcon
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
              icon={Search01Icon}
            />
            <Input
              className={`h-7 pl-7 text-[13px] ${query ? "pr-7" : ""}`}
              data-search=""
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search slips"
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
                <HugeiconsIcon className="size-3" icon={Cancel01Icon} />
              </Button>
            ) : null}
          </div>
        )}
        <Button
          aria-label="Command palette"
          className="press no-drag relative after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-['']"
          onClick={() => setPaletteOpen(true)}
          size="icon-sm"
          variant="ghost"
        >
          <span className="text-[10px] font-medium">⌘K</span>
        </Button>
        <Button
          aria-label={settingsOpen ? "Close settings" : "Settings"}
          className="press no-drag relative after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-['']"
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
            <HugeiconsIcon className="size-3.5" icon={Settings02Icon} />
          )}
        </Button>
      </header>

      {capture === "denied" ? (
        <div className="bg-card mx-2.5 mb-1.5 flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          <p>{chordName} needs Accessibility.</p>
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

      {settingsOpen ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <SettingsPanel
            dark={dark}
            login={login}
            onBind={setBinding}
            onChange={writeSettings}
            onLogin={setLogin}
            settings={settings}
          />
        </div>
      ) : null}
      <InboxPane
        bulk={
          marked.length > 0
            ? {
                archiveLabel: subject.every((slip) => slip.archived)
                  ? "Restore"
                  : "Archive",
                canMerge: marked.length > 1,
                doneLabel: subject.every((slip) => slip.done)
                  ? "Reopen"
                  : "Done",
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
        emptyCopy={emptyCopy}
        focused={focused}
        hidden={settingsOpen}
        list={list}
        marked={marked}
        onCancelRename={stopRename}
        onCopy={(slip) => {
          if (marked.length > 1 && marked.includes(slip.id)) {
            copyList().catch(() => undefined);
            return;
          }
          copyNamed("Copied", () => copySlip(slip));
        }}
        onDraft={setDraft}
        onFile={(name) => {
          remember("Filed");
          apply(marked, { section: name }).catch(() => undefined);
        }}
        onFocus={(id) => {
          setFocused(id);
          setMarked([]);
        }}
        onHeaderMenu={(name) => {
          openHeaderMenu(name).catch(() => undefined);
        }}
        onInbox={() => {
          stopRename();
          setSection("");
          setShowArchived(false);
          setMarked([]);
        }}
        onMenu={(slip) => {
          openSlipMenu(slip).catch(() => undefined);
        }}
        onPick={pick}
        onPatch={(id, next) => {
          apply([id], next).catch(() => undefined);
        }}
        onSection={(name) => {
          stopRename();
          setSection(name);
          setMarked([]);
        }}
        onSubmit={() => {
          const text = draft.trim();
          if (!text) {
            return;
          }
          if (renaming !== null) {
            renameSection(renaming, text).catch(() => undefined);
            return;
          }
          remember("Added");
          window.slip
            .createSlip(text)
            .then((slip) => {
              if (slip === null) {
                return;
              }
              setUndo((cur) => (cur ? { ...cur, drop: [slip.id] } : cur));
              setDraft("");
              setSlips((cur) => [...cur, slip]);
            })
            .catch(() => undefined);
        }}
        onToggleArchive={() => {
          stopRename();
          setShowArchived((value) => !value);
          setMarked([]);
        }}
        renaming={renaming}
        section={section}
        sections={sections}
        showArchived={showArchived}
      />

      <footer className="text-muted-foreground flex items-center justify-between px-2.5 pb-1.5 text-[10px] tabular-nums">
        <span>
          {statusLine(
            flash,
            marked.length,
            list.filter((slip) => !slip.done).length
          )}
        </span>
        <span>{capture === "live" ? "listening" : capture}</span>
      </footer>

      <CommandPalette
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
        onSettings={() => {
          setSettingsOpen(true);
          setPaletteOpen(false);
        }}
        onUndo={() => {
          runUndo().catch(() => undefined);
          setPaletteOpen(false);
        }}
        open={paletteOpen}
        settingsOpen={settingsOpen}
        shortcuts={settings.shortcuts}
        slips={slips}
        subjectCount={subject.length}
        undoLabel={undo?.label ?? null}
      />
    </div>
  );
};

export default App;
