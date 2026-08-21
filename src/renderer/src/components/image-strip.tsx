import { Cancel01Icon, ImageAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent, RefObject } from "react";

import { Button } from "@/components/ui/button";
import { filesFromList } from "@/lib/drop-images";
import { cn } from "@/lib/utils";

const REORDER = "application/x-slip-image";

export const ImagePicker = ({
  inputRef,
  onFiles,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  onFiles: (files: File[]) => void;
}) => (
  <input
    accept="image/*,.bmp,.gif,.heic,.jpeg,.jpg,.png,.tif,.tiff,.webp"
    className="hidden"
    multiple
    onChange={(event: ChangeEvent<HTMLInputElement>) => {
      const files = filesFromList(event.target.files ?? []);
      event.target.value = "";
      if (files.length > 0) {
        onFiles(files);
      }
    }}
    ref={inputRef}
    type="file"
  />
);

export const ImageStrip = ({
  items,
  onAdd,
  onOpen,
  onRemove,
  onReorder,
}: {
  items: { key: string; src: string }[];
  onAdd?: () => void;
  onOpen?: (key: string) => void;
  onRemove?: (key: string) => void;
  onReorder?: (from: number, to: number) => void;
}) => {
  const [hold, setHold] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const dragged = useRef(false);

  const canMove = onReorder !== undefined && items.length > 1;

  const finish = (): void => {
    setHold(null);
    setOver(null);
  };

  if (items.length === 0 && onAdd) {
    return (
      <Button
        className="press text-muted-foreground h-7 px-1.5"
        onClick={onAdd}
        size="xs"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon className="size-3" icon={ImageAdd01Icon} />
        Add images
      </Button>
    );
  }

  return (
    <div className="no-scrollbar scroll-fade-x flex gap-1.5 overflow-x-auto">
      {items.map((item, index) => (
        <div
          className={cn(
            "group relative shrink-0",
            hold === index && "opacity-50",
            over === index && "outline-primary rounded-md outline"
          )}
          draggable={canMove}
          key={item.key}
          onDragEnd={finish}
          onDragEnter={(event: DragEvent) => {
            if (!canMove || !event.dataTransfer.types.includes(REORDER)) {
              return;
            }
            event.preventDefault();
            setOver(index);
          }}
          onDragOver={(event: DragEvent) => {
            if (!canMove || !event.dataTransfer.types.includes(REORDER)) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
          }}
          onDragStart={(event: DragEvent) => {
            if (!canMove) {
              return;
            }
            event.dataTransfer.setData(REORDER, String(index));
            event.dataTransfer.effectAllowed = "move";
            dragged.current = true;
            setHold(index);
          }}
          onDrop={(event: DragEvent) => {
            const raw = event.dataTransfer.getData(REORDER);
            finish();
            if (!raw || onReorder === undefined) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onReorder(Number(raw), index);
          }}
        >
          <button
            aria-label="Open image"
            className={cn(onOpen && "cursor-pointer")}
            onClick={() => {
              if (dragged.current) {
                dragged.current = false;
                return;
              }
              if (onOpen === undefined) {
                return;
              }
              onOpen(item.key);
            }}
            type="button"
          >
            <img
              alt=""
              className="pointer-events-none h-14 w-auto rounded-md outline outline-black/10 dark:outline-white/10"
              draggable={false}
              src={item.src}
            />
          </button>
          {onRemove ? (
            <Button
              aria-label="Remove image"
              className="press absolute top-0.5 right-0.5 size-4 rounded-full opacity-0 group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(item.key);
              }}
              size="icon-xs"
              type="button"
              variant="secondary"
            >
              <HugeiconsIcon className="size-2.5" icon={Cancel01Icon} />
            </Button>
          ) : null}
        </div>
      ))}
      {onAdd ? (
        <Button
          aria-label="Add images"
          className="press h-14 w-10 shrink-0"
          onClick={onAdd}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon className="size-3.5" icon={ImageAdd01Icon} />
        </Button>
      ) : null}
    </div>
  );
};
