import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";

import { BulkBar } from "@/components/bulk-bar";
import { DetailWell } from "@/components/detail-well";
import { SectionPicker } from "@/components/section-picker";
import { SlipMark } from "@/components/slip-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { titleOf } from "../../../shared/format";
import { groupedRows, whenLabel } from "../../../shared/logic";
import type { Slip } from "../../../shared/types";

interface BulkActions {
  archiveLabel: string;
  canMerge: boolean;
  doneLabel: string;
  fileValue: string;
  onArchive: () => void;
  onClear: () => void;
  onCopyList: () => void;
  onCopyPrompt: () => void;
  onDone: () => void;
  onMerge: () => void;
}

const MarkedActions = ({ actions }: { actions: BulkActions }) => {
  const {
    archiveLabel,
    canMerge,
    doneLabel,
    onArchive: handleArchive,
    onClear: handleClear,
    onCopyList: handleCopyList,
    onCopyPrompt: handleCopyPrompt,
    onDone: handleDone,
    onMerge: handleMerge,
  } = actions;
  return (
    <BulkBar
      archiveLabel={archiveLabel}
      canMerge={canMerge}
      doneLabel={doneLabel}
      onArchive={handleArchive}
      onClear={handleClear}
      onCopyList={handleCopyList}
      onCopyPrompt={handleCopyPrompt}
      onDone={handleDone}
      onMerge={handleMerge}
    />
  );
};

const composerHint = (renaming: string | null, section: string): string => {
  if (renaming !== null) {
    return `Rename ${renaming}`;
  }
  if (section.length > 0) {
    return `Add to ${section}`;
  }
  return "A new slip";
};

let menuAt = 0;

const SlipRow = ({
  focused,
  marked,
  onCopy,
  onDone,
  onMenu,
  onPick,
  slip,
}: {
  focused: boolean;
  marked: boolean;
  onCopy: () => void;
  onDone: () => void;
  onMenu: () => void;
  onPick: (mods: { meta: boolean; shift: boolean }) => void;
  slip: Slip;
}) => (
  <button
    className={cn(
      "flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1 text-left text-[13px] leading-snug select-none",
      !marked && !focused && "hover:bg-muted/60",
      focused && !marked && "bg-primary/10",
      marked && "bg-primary/15 shadow-[inset_0_0_0_1px_var(--primary)]"
    )}
    data-slip-row=""
    onClick={(event) => {
      if (Date.now() - menuAt < 250) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest("[data-slip-mark]")
      ) {
        if (event.detail > 1) {
          return;
        }
        onDone();
        return;
      }
      if (event.detail > 1) {
        onCopy();
        return;
      }
      onPick({
        meta: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
      });
    }}
    onContextMenu={(event) => {
      event.preventDefault();
      event.stopPropagation();
      menuAt = Date.now();
      onMenu();
    }}
    type="button"
  >
    <span
      className="text-muted-foreground group/mark relative mt-0.5 after:absolute after:-inset-2 after:content-['']"
      data-slip-mark=""
    >
      <SlipMark marked={marked} slip={slip} />
    </span>
    <span className="min-w-0 flex-1">
      <span
        className={`block truncate ${slip.done ? "text-muted-foreground line-through" : ""}`}
      >
        {titleOf(slip.content)}
      </span>
      <span className="text-muted-foreground text-[10px] tabular-nums">
        {whenLabel(slip.createdAt)}
        {slip.tags.length ? ` · ${slip.tags.join(" ")}` : ""}
      </span>
    </span>
  </button>
);

const SectionHeader = ({
  current,
  name,
  onMenu,
  onUse,
}: {
  current: boolean;
  name: string;
  onMenu: () => void;
  onUse: () => void;
}) => (
  <button
    className="text-muted-foreground flex w-full items-center gap-2 px-1.5 pt-2 pb-0.5 text-left text-[10px] tracking-wide"
    onClick={onUse}
    onContextMenu={(event) => {
      event.preventDefault();
      onMenu();
    }}
    type="button"
  >
    <span className={current ? "text-foreground" : ""}>{name}</span>
    <span className="bg-border h-px min-w-4 flex-1" />
  </button>
);

export const InboxPane = ({
  bulk,
  current,
  draft,
  emptyCopy,
  focused,
  list,
  marked,
  onCancelRename,
  onCopy,
  onDraft,
  onFile,
  onFocus,
  onHeaderMenu,
  onMenu,
  onPick,
  onPatch,
  onSection,
  onSubmit,
  renaming,
  section,
  sections,
}: {
  bulk: BulkActions | null;
  current: Slip | null;
  draft: string;
  emptyCopy: string;
  focused: string | null;
  list: Slip[];
  marked: string[];
  onCancelRename: () => void;
  onCopy: (slip: Slip) => void;
  onDraft: (value: string) => void;
  onFile: (name: string) => void;
  onFocus: (id: string | null) => void;
  onHeaderMenu: (name: string) => void;
  onMenu: (slip: Slip) => void;
  onPick: (id: string, mods: { meta: boolean; shift: boolean }) => void;
  onPatch: (id: string, next: Partial<Slip>) => void;
  onSection: (name: string) => void;
  onSubmit: () => void;
  renaming: string | null;
  section: string;
  sections: string[];
}) => {
  const rows = useMemo(() => groupedRows(list), [list]);
  const marks = useMemo(() => new Set(marked), [marked]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) => (rows[index]?.kind === "header" ? 26 : 40),
    getItemKey: (index) => rows[index]?.key ?? index,
    getScrollElement: () => parentRef.current,
    overscan: 4,
    paddingEnd: 2,
    paddingStart: 2,
  });
  const isRename = renaming !== null;

  useEffect(() => {
    if (focused === null) {
      return;
    }
    const index = rows.findIndex(
      (row) => row.kind === "slip" && row.slip.id === focused
    );
    if (index === -1) {
      return;
    }
    virtualizer.scrollToIndex(index, { align: "auto" });
  }, [focused, rows, virtualizer]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="no-scrollbar scroll-fade min-h-0 flex-1 overflow-y-auto"
        ref={parentRef}
      >
        {list.length === 0 ? (
          <p className="text-muted-foreground px-4 py-5 text-center text-[13px] text-pretty">
            {emptyCopy}
          </p>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (row === undefined) {
                return null;
              }
              return (
                <div
                  className="absolute top-0 left-0 w-full px-2.5"
                  data-index={item.index}
                  key={item.key}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {row.kind === "header" ? (
                    <SectionHeader
                      current={section === row.name}
                      name={row.name}
                      onMenu={() => {
                        onHeaderMenu(row.name);
                      }}
                      onUse={() => {
                        onSection(row.name);
                      }}
                    />
                  ) : (
                    <SlipRow
                      focused={focused === row.slip.id}
                      marked={marks.has(row.slip.id)}
                      onCopy={() => {
                        onCopy(row.slip);
                      }}
                      onDone={() => {
                        onPatch(row.slip.id, { done: !row.slip.done });
                      }}
                      onMenu={() => {
                        onMenu(row.slip);
                      }}
                      onPick={(mods) => {
                        onPick(row.slip.id, mods);
                      }}
                      slip={row.slip}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {current ? (
        <DetailWell
          onClose={() => {
            onFocus(null);
          }}
          onMenu={() => {
            onMenu(current);
          }}
          onPatch={(next) => {
            onPatch(current.id, next);
          }}
          sections={sections}
          slip={current}
        />
      ) : null}

      <form
        className="px-2.5 pt-1.5 pb-2 shadow-[inset_0_1px_0_rgba(0,0,0,0.06)]"
        onSubmit={(event) => {
          event.preventDefault();
          if (bulk && !isRename) {
            return;
          }
          onSubmit();
        }}
      >
        <div className="bg-card flex flex-col gap-1.5 rounded-[16px] p-1.5 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
          {bulk && !isRename ? (
            <MarkedActions actions={bulk} />
          ) : (
            <textarea
              autoComplete="off"
              autoCorrect="off"
              autoFocus={isRename}
              className="placeholder:text-muted-foreground min-h-11 w-full resize-none bg-transparent px-1.5 py-1 text-[13px] outline-none"
              key={renaming ?? "compose"}
              spellCheck={false}
              onChange={(event) => {
                onDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  if (renaming !== null) {
                    onCancelRename();
                    return;
                  }
                  event.currentTarget.blur();
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={composerHint(renaming, section)}
              rows={2}
              value={draft}
            />
          )}
          <div className="flex items-center gap-1">
            {isRename ? (
              <span className="text-muted-foreground min-w-0 flex-1 truncate px-1.5 text-xs">
                Renaming
              </span>
            ) : (
              <SectionPicker
                onChange={bulk ? onFile : onSection}
                placeholder={bulk ? "File to…" : "Inbox"}
                sections={sections}
                value={bulk ? bulk.fileValue : section}
              />
            )}
            {isRename || (section.length > 0 && !bulk) ? (
              <Button
                aria-label={isRename ? "Cancel rename" : "Leave section"}
                className="press"
                onClick={() => {
                  if (isRename) {
                    onCancelRename();
                    return;
                  }
                  onSection("");
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                ×
              </Button>
            ) : null}
            {bulk && !isRename ? null : (
              <Button
                aria-label={isRename ? "Save name" : "Add slip"}
                className="press text-base leading-none"
                size="icon-sm"
                type="submit"
              >
                {isRename ? "✓" : "+"}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
