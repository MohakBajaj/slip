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
import { shortcutLabel } from "../../../shared/shortcuts";
import type { Shortcuts } from "../../../shared/shortcuts";
import type { Slip } from "../../../shared/types";

export const CommandPalette = ({
  onAnnotate,
  onCheatsheet,
  onCopyList,
  onCopyPrompt,
  onDictate,
  onDraw,
  onInbox,
  onVoice,
  onMerge,
  onOpen,
  onOpenChange,
  onOpenVault,
  onSelectAll,
  onSettings,
  onUndo,
  open,
  settingsOpen,
  shortcuts,
  slips,
  subjectCount,
  undoLabel,
}: {
  onAnnotate: () => void;
  onCheatsheet: () => void;
  onCopyList: () => void;
  onCopyPrompt: () => void;
  onDictate: () => void;
  onDraw: () => void;
  onInbox: () => void;
  onVoice: () => void;
  onMerge: () => void;
  onOpen: (id: string) => void;
  onOpenChange: (open: boolean) => void;
  onOpenVault: () => void;
  onSelectAll: () => void;
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
            <CommandShortcut>
              {shortcutLabel(shortcuts.settings)}
            </CommandShortcut>
          </CommandItem>
        )}
        <CommandItem
          onSelect={() => {
            onCheatsheet();
          }}
        >
          Shortcuts
          <CommandShortcut>
            {shortcutLabel(shortcuts.cheatsheet)}
          </CommandShortcut>
        </CommandItem>
        {undoLabel === null ? null : (
          <CommandItem onSelect={onUndo}>
            Undo {undoLabel.toLowerCase()}
            <CommandShortcut>{shortcutLabel(shortcuts.undo)}</CommandShortcut>
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
        <CommandItem disabled={subjectCount === 0} onSelect={onSelectAll}>
          Select all
        </CommandItem>
        <CommandItem onSelect={onOpenVault}>Open vault</CommandItem>
        <CommandItem onSelect={onDraw}>Draw</CommandItem>
        <CommandItem onSelect={onAnnotate}>Annotate anywhere</CommandItem>
        <CommandItem onSelect={onVoice}>Voice</CommandItem>
        <CommandItem onSelect={onDictate}>Dictate anywhere</CommandItem>
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
