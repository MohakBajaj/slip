import { formatForDisplay } from "@tanstack/react-hotkeys";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

import { titleOf } from "../../../shared/format";
import type { Shortcuts } from "../../../shared/shortcuts";
import type { Slip } from "../../../shared/types";

export const CommandPalette = ({
  onCopyList,
  onCopyPrompt,
  onDraw,
  onInbox,
  onVoice,
  onMerge,
  onOpen,
  onOpenChange,
  onOpenVault,
  onSettings,
  onUndo,
  open,
  settingsOpen,
  shortcuts,
  slips,
  subjectCount,
  undoLabel,
}: {
  onCopyList: () => void;
  onCopyPrompt: () => void;
  onDraw: () => void;
  onInbox: () => void;
  onVoice: () => void;
  onMerge: () => void;
  onOpen: (id: string) => void;
  onOpenChange: (open: boolean) => void;
  onOpenVault: () => void;
  onSettings: () => void;
  onUndo: () => void;
  open: boolean;
  settingsOpen: boolean;
  shortcuts: Shortcuts;
  slips: Slip[];
  subjectCount: number;
  undoLabel: string | null;
}) => (
  <CommandDialog onOpenChange={onOpenChange} open={open}>
    <CommandInput placeholder="Go somewhere, or run a command" />
    <CommandList>
      <CommandEmpty>Nothing.</CommandEmpty>
      <CommandGroup heading="Go">
        {settingsOpen ? (
          <CommandItem onSelect={onInbox}>Back to inbox</CommandItem>
        ) : (
          <CommandItem onSelect={onSettings}>
            Settings
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
        )}
        {undoLabel === null ? null : (
          <CommandItem onSelect={onUndo}>
            Undo {undoLabel.toLowerCase()}
            <CommandShortcut>
              {formatForDisplay(shortcuts.undo)}
            </CommandShortcut>
          </CommandItem>
        )}
      </CommandGroup>
      <CommandGroup heading="Actions">
        <CommandItem disabled={subjectCount === 0} onSelect={onCopyList}>
          Copy as list
        </CommandItem>
        <CommandItem disabled={subjectCount === 0} onSelect={onCopyPrompt}>
          Copy as prompt
        </CommandItem>
        <CommandItem disabled={subjectCount < 2} onSelect={onMerge}>
          Merge
        </CommandItem>
        <CommandItem onSelect={onOpenVault}>Open vault</CommandItem>
        <CommandItem onSelect={onDraw}>Draw</CommandItem>
        <CommandItem onSelect={onVoice}>Voice</CommandItem>
      </CommandGroup>
      <CommandGroup heading="Slips">
        {slips
          .filter((slip) => !slip.archived)
          .slice(0, 16)
          .map((slip) => (
            <CommandItem
              key={slip.id}
              onSelect={() => {
                onOpen(slip.id);
              }}
            >
              {titleOf(slip.content)}
            </CommandItem>
          ))}
      </CommandGroup>
    </CommandList>
  </CommandDialog>
);
