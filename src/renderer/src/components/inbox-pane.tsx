import { ImageAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Mic } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { BulkBar } from "@/components/bulk-bar";
import { DetailWell } from "@/components/detail-well";
import { ImagePicker, ImageStrip } from "@/components/image-strip";
import { SectionPicker } from "@/components/section-picker";
import { SlipMark } from "@/components/slip-mark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  filesFromClipboard,
  forgetPending,
  pendingFromFiles,
  useDraggingFiles,
  useFileDrop,
} from "@/lib/drop-images";
import type { PendingImage } from "@/lib/drop-images";
import { cn } from "@/lib/utils";

import { titleOf } from "../../../shared/format";
import { moveItem, slipImgSrc } from "../../../shared/images";
import { groupedRows, whenLabel } from "../../../shared/logic";
import { sourceWhere } from "../../../shared/source";
import type { Slip } from "../../../shared/types";

interface BulkActions {
  archiveLabel: string;
  canDelete: boolean;
  canMerge: boolean;
  doneLabel: string;
  fileValue: string;
  onArchive: () => void;
  onClear: () => void;
  onCopyList: () => void;
  onCopyPrompt: () => void;
  onDelete: () => void;
  onDone: () => void;
  onMerge: () => void;
}

const MarkedActions = ({ actions }: { actions: BulkActions }) => {
  const {
    archiveLabel,
    canDelete,
    canMerge,
    doneLabel,
    onArchive: handleArchive,
    onClear: handleClear,
    onCopyList: handleCopyList,
    onCopyPrompt: handleCopyPrompt,
    onDelete: handleDelete,
    onDone: handleDone,
    onMerge: handleMerge,
  } = actions;
  return (
    <BulkBar
      archiveLabel={archiveLabel}
      canDelete={canDelete}
      canMerge={canMerge}
      doneLabel={doneLabel}
      onArchive={handleArchive}
      onClear={handleClear}
      onCopyList={handleCopyList}
      onCopyPrompt={handleCopyPrompt}
      onDelete={handleDelete}
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

const SlipThumb = ({ slip }: { slip: Slip }) => {
  const [first] = slip.images;
  if (first !== undefined) {
    return (
      <span
        className="relative mt-0.5 shrink-0 after:absolute after:-inset-1.5 after:content-['']"
        data-slip-preview=""
      >
        <img
          alt=""
          className={`pointer-events-none size-7 rounded-[5px] object-cover outline outline-black/10 dark:outline-white/10 ${slip.done ? "opacity-50" : ""}`}
          draggable={false}
          src={slipImgSrc(first)}
        />
        {slip.images.length > 1 ? (
          <span className="bg-background/90 text-foreground absolute -right-1 -bottom-1 rounded-full px-1 text-[8px] leading-3 tabular-nums outline outline-black/10 dark:outline-white/10">
            {slip.images.length}
          </span>
        ) : null}
      </span>
    );
  }
  if (slip.audio.length === 0) {
    return null;
  }
  return (
    <span className="text-muted-foreground mt-0.5 flex shrink-0 items-center gap-0.5">
      <Mic className="size-3.5" />
      {slip.audio.length > 1 ? (
        <span className="text-[8px] tabular-nums">{slip.audio.length}</span>
      ) : null}
    </span>
  );
};

const SlipRow = ({
  focused,
  marked,
  onCopy,
  onDone,
  onDropImages,
  onMenu,
  onPick,
  onPreview,
  slip,
}: {
  focused: boolean;
  marked: boolean;
  onCopy: () => void;
  onDone: () => void;
  onDropImages: (files: File[]) => void;
  onMenu: () => void;
  onPick: (mods: { meta: boolean; shift: boolean }) => void;
  onPreview: () => void;
  slip: Slip;
}) => {
  const drop = useFileDrop(onDropImages);
  const from = sourceWhere(slip);
  return (
    <button
      className={cn(
        "flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1 text-left text-[13px] leading-snug select-none",
        !marked && !focused && "hover:bg-muted/60",
        focused && !marked && "bg-primary/10",
        marked && "bg-primary/15 shadow-[inset_0_0_0_1px_var(--primary)]",
        drop.over && "bg-primary/15 shadow-[inset_0_0_0_1px_var(--primary)]"
      )}
      {...drop.props}
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
        if (
          event.target instanceof Element &&
          event.target.closest("[data-slip-preview]")
        ) {
          if (event.detail > 1) {
            return;
          }
          onPreview();
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
        <span className="text-muted-foreground block truncate text-[10px] tabular-nums">
          {whenLabel(slip.createdAt)}
          {from ? ` · ${from}` : ""}
          {slip.tags.length ? ` · ${slip.tags.join(" ")}` : ""}
        </span>
      </span>
      <SlipThumb slip={slip} />
    </button>
  );
};

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
  editing,
  emptyCopy,
  focused,
  list,
  marked,
  onAddImages,
  onCancelRename,
  onCopy,
  onCreateImages,
  onDelete,
  onDraft,
  onEditing,
  onFile,
  onFocus,
  onHeaderMenu,
  onMenu,
  onPick,
  onPatch,
  onSection,
  onSubmit,
  onVoice,
  renaming,
  section,
  sections,
}: {
  bulk: BulkActions | null;
  current: Slip | null;
  draft: string;
  editing: boolean;
  emptyCopy: string;
  focused: string | null;
  list: Slip[];
  marked: string[];
  onAddImages: (id: string, files: File[]) => void;
  onCancelRename: () => void;
  onCopy: (slip: Slip) => void;
  onCreateImages: (files: File[]) => void;
  onDelete: (id: string) => void;
  onDraft: (value: string) => void;
  onEditing: (on: boolean) => void;
  onFile: (name: string) => void;
  onFocus: (id: string | null) => void;
  onHeaderMenu: (name: string) => void;
  onMenu: (slip: Slip) => void;
  onPick: (id: string, mods: { meta: boolean; shift: boolean }) => void;
  onPatch: (id: string, next: Partial<Slip>) => void;
  onSection: (name: string) => void;
  onSubmit: (files: File[]) => void;
  onVoice: () => void;
  renaming: string | null;
  section: string;
  sections: string[];
}) => {
  const rows = useMemo(() => groupedRows(list), [list]);
  const marks = useMemo(() => new Set(marked), [marked]);
  const parentRef = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const pendingRef = useRef<PendingImage[]>([]);
  pendingRef.current = pending;
  const dragging = useDraggingFiles();
  const composing = renaming === null && !bulk;
  const listDrop = useFileDrop(onCreateImages, composing);

  useEffect(
    () =>
      window.slip.onDrawAttach((bytes) => {
        const file = new File([Uint8Array.from(bytes)], "drawing.png", {
          type: "image/png",
        });
        setPending((cur) => [...cur, ...pendingFromFiles([file])]);
      }),
    []
  );
  const composeDrop = useFileDrop((files) => {
    setPending((cur) => [...cur, ...pendingFromFiles(files)]);
  }, composing);
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

  useEffect(
    () => () => {
      forgetPending(pendingRef.current);
    },
    []
  );

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

  const takePending = (): File[] => {
    const files = pending.map((item) => item.file);
    forgetPending(pending);
    setPending([]);
    return files;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "no-scrollbar scroll-fade relative min-h-0 flex-1 overflow-y-auto",
          listDrop.over && "bg-primary/5"
        )}
        ref={parentRef}
        {...listDrop.props}
      >
        {list.length === 0 ? (
          <p className="text-muted-foreground px-4 py-5 text-center text-[13px] text-pretty">
            {dragging || listDrop.over ? "Drop to capture images" : emptyCopy}
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
                      onDropImages={(files) => {
                        onAddImages(row.slip.id, files);
                      }}
                      onMenu={() => {
                        onMenu(row.slip);
                      }}
                      onPick={(mods) => {
                        onPick(row.slip.id, mods);
                      }}
                      onPreview={() => {
                        onPick(row.slip.id, { meta: false, shift: false });
                        window.slip
                          .openPreview(row.slip.id, 0)
                          .catch(() => undefined);
                      }}
                      slip={row.slip}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {dragging && list.length > 0 ? (
          <p className="text-muted-foreground pointer-events-none sticky bottom-0 px-4 py-1.5 text-center text-[10px]">
            Drop on a slip to attach, or on empty space to start one
          </p>
        ) : null}
      </div>

      {current ? (
        <DetailWell
          editing={editing}
          onAddImages={(files) => {
            onAddImages(current.id, files);
          }}
          onClose={() => {
            onEditing(false);
            onFocus(null);
          }}
          onDelete={() => {
            onDelete(current.id);
          }}
          onEditing={onEditing}
          onMenu={() => {
            onMenu(current);
          }}
          onPatch={onPatch}
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
          onSubmit(isRename ? [] : takePending());
        }}
      >
        <ImagePicker
          inputRef={picker}
          onFiles={(files) => {
            if (!composing) {
              return;
            }
            setPending((cur) => [...cur, ...pendingFromFiles(files)]);
          }}
        />
        <div
          className={cn(
            "bg-card flex flex-col gap-1.5 rounded-[16px] p-1.5 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
            composeDrop.over && "shadow-[0_0_0_1px_var(--primary)]"
          )}
          {...composeDrop.props}
        >
          {bulk && !isRename ? (
            <MarkedActions actions={bulk} />
          ) : (
            <textarea
              autoComplete="off"
              autoCorrect="off"
              autoFocus={isRename}
              className="placeholder:text-muted-foreground min-h-11 w-full resize-none bg-transparent px-1.5 py-1 text-[13px] outline-none"
              data-composer=""
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
                  if (pending.length > 0) {
                    forgetPending(pending);
                    setPending([]);
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
              onPaste={(event) => {
                if (!composing) {
                  return;
                }
                const files = filesFromClipboard(event.clipboardData);
                if (files.length === 0) {
                  return;
                }
                setPending((cur) => [...cur, ...pendingFromFiles(files)]);
                if (!event.clipboardData.getData("text")) {
                  event.preventDefault();
                }
              }}
              placeholder={
                composeDrop.over
                  ? "Drop images"
                  : composerHint(renaming, section)
              }
              rows={2}
              value={draft}
            />
          )}
          {composing && pending.length > 0 ? (
            <div className="px-0.5">
              <ImageStrip
                items={pending.map((item) => ({
                  key: item.id,
                  src: item.url,
                }))}
                onRemove={(key) => {
                  setPending((cur) => {
                    const next = cur.filter((item) => item.id !== key);
                    forgetPending(cur.filter((item) => item.id === key));
                    return next;
                  });
                }}
                onReorder={(from, to) => {
                  setPending((cur) => moveItem(cur, from, to));
                }}
              />
            </div>
          ) : null}
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
            {composing ? (
              <>
                <Button
                  aria-label="Voice"
                  className="press"
                  onClick={onVoice}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Mic className="size-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        aria-label="Attach"
                        className="press"
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      />
                    }
                  >
                    <HugeiconsIcon className="size-3.5" icon={ImageAdd01Icon} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-28">
                    <DropdownMenuItem
                      onClick={() => {
                        picker.current?.click();
                      }}
                    >
                      Photo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        window.slip.openDraw("attach").catch(() => undefined);
                      }}
                    >
                      Draw
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
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
