import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const BulkBar = ({
  archiveLabel,
  canMerge,
  doneLabel,
  onArchive,
  onClear,
  onCopyList,
  onCopyPrompt,
  onDone,
  onMerge,
}: {
  archiveLabel: string;
  canMerge: boolean;
  doneLabel: string;
  onArchive: () => void;
  onClear: () => void;
  onCopyList: () => void;
  onCopyPrompt: () => void;
  onDone: () => void;
  onMerge: () => void;
}) => (
  <div className="flex min-h-11 w-full min-w-0 flex-col justify-center gap-0.5 px-0.5">
    <div className="flex items-center gap-0.5">
      <Button
        className="press"
        onClick={onDone}
        size="xs"
        type="button"
        variant="ghost"
      >
        {doneLabel}
      </Button>
      <Button
        className="press"
        onClick={onArchive}
        size="xs"
        type="button"
        variant="ghost"
      >
        {archiveLabel}
      </Button>
      <Button
        className="press"
        disabled={!canMerge}
        onClick={onMerge}
        size="xs"
        type="button"
        variant="ghost"
      >
        Merge
      </Button>
    </div>
    <div className="flex items-center gap-0.5">
      <ButtonGroup>
        <Button
          className="press"
          onClick={onCopyList}
          size="xs"
          type="button"
          variant="ghost"
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
                variant="ghost"
              />
            }
          >
            <ChevronDownIcon className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-w-[min(12rem,var(--available-width))] min-w-28"
          >
            <DropdownMenuItem onClick={onCopyList}>As list</DropdownMenuItem>
            <DropdownMenuItem onClick={onCopyPrompt}>
              As prompt
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      <span className="min-w-0 flex-1" />
      <Button
        className="press"
        onClick={onClear}
        size="xs"
        type="button"
        variant="ghost"
      >
        Clear
      </Button>
    </div>
  </div>
);
