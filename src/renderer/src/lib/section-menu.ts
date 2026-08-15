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
  if (id === null) {
    return;
  }
  if (id === "use") {
    act.use();
    return;
  }
  if (id === "rename") {
    act.rename();
    return;
  }
  if (id === "select") {
    act.select();
    return;
  }
  if (id === "copy-list") {
    act.copyList();
    return;
  }
  if (id === "copy-prompt") {
    act.copyPrompt();
    return;
  }
  if (id === "done") {
    act.done();
    return;
  }
  if (id === "archive") {
    act.archive();
    return;
  }
  if (id === "merge") {
    act.merge();
    return;
  }
  if (id === "dissolve") {
    act.dissolve();
  }
};
