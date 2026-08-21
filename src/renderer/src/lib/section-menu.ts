import type { MenuEntry } from "../../../shared/menu";

export const sectionMenuEntries = ({
  allArchived,
  allDone,
  canMerge,
}: {
  allArchived: boolean;
  allDone: boolean;
  canMerge: boolean;
}): MenuEntry[] => [
  { id: "use", label: "Capture to This Section" },
  { id: "rename", label: "Rename Section" },
  { id: "select", label: "Select All in Section" },
  { type: "separator" },
  { id: "copy-list", label: "Copy Section as List" },
  { id: "copy-prompt", label: "Copy Section as Prompt" },
  { type: "separator" },
  {
    id: "done",
    label: allDone ? "Reopen Section" : "Mark Section as Done",
  },
  {
    id: "archive",
    label: allArchived ? "Restore Section" : "Archive Section",
  },
  ...(canMerge ? [{ id: "merge", label: "Merge Section" }] : []),
  { type: "separator" },
  { id: "dissolve", label: "Remove Section (keeps slips)" },
];

export const handleSectionMenu = (
  id: string | null,
  act: {
    archive: () => void;
    copyList: () => void;
    copyPrompt: () => void;
    dissolve: () => void;
    done: () => void;
    merge: () => void;
    rename: () => void;
    select: () => void;
    use: () => void;
  }
): void => {
  const run: Record<string, () => void> = {
    archive: act.archive,
    "copy-list": act.copyList,
    "copy-prompt": act.copyPrompt,
    dissolve: act.dissolve,
    done: act.done,
    merge: act.merge,
    rename: act.rename,
    select: act.select,
    use: act.use,
  };
  if (id !== null) {
    run[id]?.();
  }
};
