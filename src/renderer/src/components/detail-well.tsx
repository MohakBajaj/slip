import { PreviewCard } from "@base-ui/react/preview-card";
import {
  Archive02Icon,
  ArchiveRestoreIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  Delete02Icon,
  PencilEdit01Icon,
  PinIcon,
  PinOffIcon,
  ReloadIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps, MouseEvent } from "react";

import { ImagePicker, ImageStrip } from "@/components/image-strip";
import { SectionPicker } from "@/components/section-picker";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { copySlip } from "@/lib/copy-slip";
import { filesFromClipboard, useFileDrop } from "@/lib/drop-images";
import { cn } from "@/lib/utils";

import { moveItem, slipImgSrc } from "../../../shared/images";
import { whenLabel } from "../../../shared/logic";
import { isWebUrl, sourceApp, urlLabel } from "../../../shared/source";
import type { Slip } from "../../../shared/types";
import { Markdown } from "../markdown";

const Action = ({
  icon,
  label,
  named,
  on,
  onClick,
}: {
  icon: ComponentProps<typeof HugeiconsIcon>["icon"];
  label: string;
  named?: boolean;
  on?: boolean;
  onClick: () => void;
}) => (
  <Button
    aria-label={label}
    className="press"
    onClick={onClick}
    size={named === true ? "xs" : "icon-xs"}
    title={label}
    type="button"
    variant={on === true ? "default" : "ghost"}
  >
    <HugeiconsIcon className="size-3" icon={icon} />
    {named === true ? label : null}
  </Button>
);

const CopyGroup = ({ slip }: { slip: Slip }) => (
  <ButtonGroup className="ml-auto shrink-0">
    <Button
      className="press"
      onClick={() => {
        copySlip(slip).catch(() => undefined);
      }}
      size="xs"
      type="button"
      variant="outline"
    >
      <HugeiconsIcon className="size-3" icon={Copy01Icon} />
      Copy
    </Button>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="More copy options"
            className="press px-1"
            size="icon-xs"
            type="button"
            variant="outline"
          />
        }
      >
        <ChevronDownIcon className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-w-[min(12rem,var(--available-width))] min-w-32"
      >
        <DropdownMenuItem
          onClick={() => {
            window.slip.copyAtRef(slip.id).catch(() => undefined);
          }}
        >
          @ reference
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            window.slip.copyPath(slip.id).catch(() => undefined);
          }}
        >
          File path
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            window.slip.copyPrompt([slip.id]).catch(() => undefined);
          }}
        >
          As prompt
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </ButtonGroup>
);

const OriginUrl = ({ page, url }: { page: string; url: string }) => {
  const label = urlLabel(url);
  const className = cn(
    "text-muted-foreground truncate text-[10px]",
    page ? "mt-1" : ""
  );
  if (!isWebUrl(url)) {
    return <p className={className}>{label}</p>;
  }
  return (
    <a
      className={cn(
        className,
        "hover:text-foreground block underline-offset-2 hover:underline"
      )}
      href={url}
      onClick={(event) => {
        event.stopPropagation();
      }}
      rel="noreferrer"
      target="_blank"
    >
      {label}
    </a>
  );
};

const OriginCard = ({ slip }: { slip: Slip }) => {
  const app = sourceApp(slip.source);
  if (!app) {
    return null;
  }
  if (!slip.page && !slip.url) {
    return <span>{app}</span>;
  }
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        className="hover:text-foreground cursor-default underline-offset-2 hover:underline"
        closeDelay={80}
        delay={160}
        render={<span />}
      >
        {app}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          align="start"
          className="z-50 outline-none"
          side="top"
          sideOffset={6}
        >
          <PreviewCard.Popup className="bg-popover text-popover-foreground data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 w-64 origin-(--transform-origin) rounded-lg border border-foreground/20 p-2.5 shadow-lg duration-100">
            {slip.page ? (
              <p className="text-[12px] leading-snug text-pretty">
                {slip.page}
              </p>
            ) : null}
            {slip.url ? <OriginUrl page={slip.page} url={slip.url} /> : null}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
};

const onWellMenu = (event: MouseEvent, onMenu: () => void): void => {
  if (
    event.target instanceof HTMLElement &&
    event.target.closest("input, textarea, button")
  ) {
    return;
  }
  event.preventDefault();
  onMenu();
};

export const DetailWell = ({
  editing,
  onAddImages,
  onClose,
  onDelete,
  onEditing,
  onMenu,
  onPatch,
  sections,
  slip,
}: {
  editing: boolean;
  onAddImages: (files: File[]) => void;
  onClose: () => void;
  onDelete: () => void;
  onEditing: (on: boolean) => void;
  onMenu: () => void;
  onPatch: (id: string, patch: Partial<Slip>) => void;
  sections: string[];
  slip: Slip;
}) => {
  const [tag, setTag] = useState("");
  const [note, setNote] = useState(slip.content);
  const picker = useRef<HTMLInputElement>(null);
  const drop = useFileDrop(onAddImages);
  const noteRef = useRef(note);
  const prevId = useRef(slip.id);
  const prevContent = useRef(slip.content);
  const onPatchRef = useRef(onPatch);
  const onEditingRef = useRef(onEditing);
  noteRef.current = note;
  onPatchRef.current = onPatch;
  onEditingRef.current = onEditing;
  const app = sourceApp(slip.source);

  const startEdit = (): void => {
    setNote(slip.content);
    onEditing(true);
  };

  const stopEdit = (save: boolean): void => {
    onEditing(false);
    if (save && note !== slip.content) {
      onPatch(slip.id, { content: note });
    } else {
      setNote(slip.content);
    }
  };

  useEffect(() => {
    if (prevId.current === slip.id) {
      prevContent.current = slip.content;
      return;
    }
    if (noteRef.current !== prevContent.current) {
      onPatchRef.current(prevId.current, { content: noteRef.current });
    }
    setNote(slip.content);
    prevId.current = slip.id;
    prevContent.current = slip.content;
  }, [slip.content, slip.id]);

  useEffect(
    () => () => {
      if (noteRef.current !== prevContent.current) {
        onPatchRef.current(prevId.current, { content: noteRef.current });
      }
      onEditingRef.current(false);
    },
    []
  );

  let noteView = (
    <button
      className="text-muted-foreground w-full px-2.5 pt-2 pb-1.5 text-left text-[13px]"
      onClick={startEdit}
      type="button"
    >
      Write a note
    </button>
  );
  if (editing) {
    noteView = (
      <textarea
        autoFocus
        className="placeholder:text-muted-foreground no-scrollbar max-h-48 min-h-24 w-full resize-y bg-transparent px-2.5 pt-2 pb-1.5 text-[13px] leading-snug outline-none"
        onChange={(event) => {
          setNote(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            stopEdit(false);
            return;
          }
          if (event.key === "Enter" && event.metaKey) {
            event.preventDefault();
            stopEdit(true);
          }
        }}
        placeholder="Write a note"
        value={note}
      />
    );
  } else if (slip.content.trim().length > 0) {
    noteView = (
      <button
        className="no-scrollbar scroll-fade max-h-40 w-full overflow-auto px-2.5 pt-2 pb-1.5 text-left text-pretty"
        onDoubleClick={startEdit}
        type="button"
      >
        <Markdown text={slip.content} />
      </button>
    );
  }

  return (
    <section
      className={cn(
        "bg-card mx-2.5 mb-1.5 rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,0.06)]",
        drop.over && "shadow-[0_0_0_1px_var(--primary)]"
      )}
      onContextMenu={(event) => onWellMenu(event, onMenu)}
      tabIndex={-1}
      onPaste={(event) => {
        const files = filesFromClipboard(event.clipboardData);
        if (files.length === 0) {
          return;
        }
        onAddImages(files);
        if (!event.clipboardData.getData("text")) {
          event.preventDefault();
        }
      }}
      {...drop.props}
    >
      <ImagePicker inputRef={picker} onFiles={onAddImages} />
      {noteView}

      <div
        className={cn(
          "px-2.5 pb-1.5",
          slip.content.trim().length === 0 && "pt-2"
        )}
      >
        <ImageStrip
          items={slip.images.map((filePath) => ({
            key: filePath,
            src: slipImgSrc(filePath),
          }))}
          onAdd={() => {
            picker.current?.click();
          }}
          onOpen={(key) => {
            const at = slip.images.indexOf(key);
            window.slip
              .openPreview(slip.id, at === -1 ? 0 : at)
              .catch(() => undefined);
          }}
          onRemove={(key) => {
            onPatch(slip.id, {
              images: slip.images.filter((item) => item !== key),
            });
          }}
          onReorder={(from, to) => {
            onPatch(slip.id, { images: moveItem(slip.images, from, to) });
          }}
        />
      </div>

      <div className="flex items-center gap-1 px-2.5 pb-1">
        <form
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            const next = tag.trim();
            if (next.length === 0) {
              return;
            }
            onPatch(slip.id, { tags: [...new Set([...slip.tags, next])] });
            setTag("");
          }}
        >
          <span className="text-muted-foreground flex h-6 items-center gap-1 text-[10px] leading-none">
            <span className="tabular-nums">{whenLabel(slip.createdAt)}</span>
            {app ? (
              <>
                <span>·</span>
                <OriginCard slip={slip} />
              </>
            ) : null}
          </span>
          <SectionPicker
            onChange={(name) => onPatch(slip.id, { section: name })}
            placeholder="Section"
            sections={sections}
            tone="chip"
            value={slip.section}
          />
          {slip.tags.map((name) => (
            <button
              className="press bg-muted text-muted-foreground hover:text-foreground relative flex h-6 items-center rounded-full px-2 text-[10px] leading-none after:absolute after:-inset-1.5 after:content-['']"
              key={name}
              onClick={() =>
                onPatch(slip.id, {
                  tags: slip.tags.filter((item) => item !== name),
                })
              }
              type="button"
            >
              {name}
              <span className="ml-1 opacity-50">×</span>
            </button>
          ))}
          <Input
            aria-label="Add tag"
            className="h-6 min-h-6 w-16 min-w-12 flex-1 border-0 bg-transparent px-1 py-0 text-[10px] leading-none shadow-none dark:bg-transparent"
            onChange={(event) => setTag(event.target.value)}
            placeholder={slip.tags.length === 0 ? "Add a tag" : "Tag"}
            value={tag}
          />
        </form>
        <Button
          aria-label="Close slip"
          className="press relative after:absolute after:-inset-2 after:content-['']"
          onClick={() => {
            if (editing) {
              stopEdit(true);
            }
            onClose();
          }}
          size="icon-xs"
          variant="ghost"
        >
          <HugeiconsIcon className="size-3" icon={Cancel01Icon} />
        </Button>
      </div>

      <footer className="flex items-center gap-1 px-2.5 pt-1 pb-1.5 shadow-[inset_0_1px_0_rgba(0,0,0,0.06)]">
        <ButtonGroup>
          <Action
            icon={slip.done ? ReloadIcon : CheckmarkCircle02Icon}
            label={slip.done ? "Reopen" : "Done"}
            named
            on={slip.done}
            onClick={() => onPatch(slip.id, { done: !slip.done })}
          />
          <Action
            icon={slip.pin ? PinOffIcon : PinIcon}
            label={slip.pin ? "Unpin" : "Pin"}
            on={slip.pin}
            onClick={() => onPatch(slip.id, { pin: !slip.pin })}
          />
          <Action
            icon={slip.archived ? ArchiveRestoreIcon : Archive02Icon}
            label={slip.archived ? "Restore" : "Archive"}
            onClick={() => onPatch(slip.id, { archived: !slip.archived })}
          />
          {slip.archived ? (
            <Action icon={Delete02Icon} label="Delete" onClick={onDelete} />
          ) : null}
          <Action
            icon={PencilEdit01Icon}
            label={editing ? "Save" : "Edit"}
            named={editing}
            on={editing}
            onClick={() => {
              if (editing) {
                stopEdit(true);
                return;
              }
              startEdit();
            }}
          />
        </ButtonGroup>
        <CopyGroup slip={slip} />
      </footer>
    </section>
  );
};
