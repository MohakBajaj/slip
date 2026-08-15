import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import type { MouseEvent } from "react";

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

import { whenLabel } from "../../../shared/logic";
import type { Slip } from "../../../shared/types";
import { imgSrc } from "../lib/img-src";
import { Markdown } from "../markdown";

const Action = ({
  label,
  on,
  onClick,
}: {
  label: string;
  on?: boolean;
  onClick: () => void;
}) => (
  <Button
    className="press"
    onClick={onClick}
    size="xs"
    type="button"
    variant={on === true ? "default" : "ghost"}
  >
    {label}
  </Button>
);

const CopyGroup = ({ slip }: { slip: Slip }) => (
  <ButtonGroup>
    <Button
      className="press"
      onClick={() => {
        copySlip(slip).catch(() => undefined);
      }}
      size="xs"
      type="button"
      variant="outline"
    >
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
  onClose,
  onMenu,
  onPatch,
  sections,
  slip,
}: {
  onClose: () => void;
  onMenu: () => void;
  onPatch: (patch: Partial<Slip>) => void;
  sections: string[];
  slip: Slip;
}) => {
  const [tag, setTag] = useState("");
  const source =
    slip.source === "capture" || slip.source.length === 0 ? "" : slip.source;

  return (
    <section
      className="bg-card mx-2.5 mb-1.5 rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
      onContextMenu={(event) => onWellMenu(event, onMenu)}
    >
      {slip.content.trim().length > 0 ? (
        <div className="no-scrollbar scroll-fade max-h-40 overflow-auto px-2.5 pt-2 pb-1.5 text-pretty">
          <Markdown text={slip.content} />
        </div>
      ) : null}

      {slip.images.length > 0 ? (
        <div className="no-scrollbar scroll-fade-x flex gap-1.5 overflow-x-auto px-2.5 pb-1.5">
          {slip.images.map((filePath) => (
            <img
              alt=""
              className="h-14 w-auto rounded-md outline outline-black/10 dark:outline-white/10"
              key={filePath}
              src={imgSrc(filePath)}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-1 px-2.5 pb-1">
        <form
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            const next = tag.trim();
            if (next.length === 0) {
              return;
            }
            onPatch({ tags: [...new Set([...slip.tags, next])] });
            setTag("");
          }}
        >
          <span className="text-muted-foreground text-[10px] tabular-nums">
            {whenLabel(slip.createdAt)}
            {source ? ` · ${source}` : ""}
          </span>
          <SectionPicker
            onChange={(name) => onPatch({ section: name })}
            placeholder="Section"
            sections={sections}
            tone="chip"
            value={slip.section}
          />
          {slip.tags.map((name) => (
            <button
              className="press bg-muted text-muted-foreground hover:text-foreground relative rounded-full px-2 py-0.5 text-[10px] after:absolute after:-inset-1.5 after:content-['']"
              key={name}
              onClick={() =>
                onPatch({
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
            className="h-6 w-16 min-w-12 flex-1 border-0 bg-transparent px-1 text-xs shadow-none"
            onChange={(event) => setTag(event.target.value)}
            placeholder={slip.tags.length === 0 ? "Add a tag" : "Tag"}
            value={tag}
          />
        </form>
        <Button
          aria-label="Close slip"
          className="press relative after:absolute after:-inset-2 after:content-['']"
          onClick={onClose}
          size="icon-xs"
          variant="ghost"
        >
          <HugeiconsIcon className="size-3" icon={Cancel01Icon} />
        </Button>
      </div>

      <footer className="flex flex-wrap items-center gap-1 px-2.5 pt-1 pb-1.5 shadow-[inset_0_1px_0_rgba(0,0,0,0.06)]">
        <ButtonGroup className="flex-wrap">
          <Action
            label={slip.done ? "Reopen" : "Done"}
            on={slip.done}
            onClick={() => onPatch({ done: !slip.done })}
          />
          <Action
            label={slip.pin ? "Unpin" : "Pin"}
            on={slip.pin}
            onClick={() => onPatch({ pin: !slip.pin })}
          />
          <Action
            label={slip.archived ? "Restore" : "Archive"}
            onClick={() => onPatch({ archived: !slip.archived })}
          />
        </ButtonGroup>
        <CopyGroup slip={slip} />
      </footer>
    </section>
  );
};
