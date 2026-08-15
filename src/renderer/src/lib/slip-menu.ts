import type { MenuEntry } from "../../../shared/menu";
import type { Slip } from "../../../shared/types";

export const slipMenuEntries = ({
  canSelectTo,
  manyMarked,
  marked,
  sections,
  setArchived,
  setDone,
  slip,
}: {
  canSelectTo: boolean;
  manyMarked: boolean;
  marked: boolean;
  sections: string[];
  setArchived: boolean;
  setDone: boolean;
  slip: Slip;
}): MenuEntry[] => {
  const useSet = manyMarked && marked;
  const imageOnly = slip.images.length > 0 && slip.content.trim().length === 0;
  let copyLabel = "Copy";
  if (useSet) {
    copyLabel = "Copy Selected as List";
  } else if (imageOnly) {
    copyLabel = slip.images.length > 1 ? "Copy Images" : "Copy Image";
  }

  const copyId = useSet ? "copy-list" : "copy";
  const sectionItems: MenuEntry[] = [
    { id: "section:", label: "Inbox" },
    ...sections.map((name) => ({
      id: `section:${name}`,
      label: name,
    })),
  ];

  let doneLabel = slip.done ? "Mark as Not Done" : "Mark as Done";
  if (useSet) {
    doneLabel = setDone ? "Reopen Selected" : "Mark Selected as Done";
  }
  let archiveLabel = slip.archived ? "Move to Inbox" : "Archive";
  if (useSet) {
    archiveLabel = setArchived ? "Restore Selected" : "Archive Selected";
  }

  return [
    { accelerator: "Return", id: copyId, label: copyLabel },
    {
      label: "Copy as",
      submenu: [
        { id: "copy-ref", label: "@ reference" },
        { id: "copy-path", label: "File path" },
        {
          id: "copy-prompt",
          label: useSet ? "Selected as prompt" : "As prompt",
        },
      ],
    },
    {
      accelerator: "X",
      id: "mark",
      label: marked ? "Remove from Selection" : "Add to Selection",
    },
    ...(canSelectTo ? [{ id: "select-to", label: "Select to Here" }] : []),
    { id: "done", label: doneLabel },
    {
      id: "pin",
      label: slip.pin ? "Unpin" : "Pin",
    },
    ...(useSet ? [{ id: "merge", label: "Merge Selected" }] : []),
    { type: "separator" },
    {
      label: useSet ? "Move Selected to Section" : "Move to Section",
      submenu: sectionItems,
    },
    {
      accelerator: "Command+E",
      id: "archive",
      label: archiveLabel,
    },
  ];
};

export const handleSlipMenu = (
  id: string | null,
  slip: Slip,
  act: {
    copy: (item: Slip) => void;
    copyList: () => void;
    copyPath: (itemId: string) => void;
    copyPrompt: (itemIds: string[]) => void;
    copyRef: (itemId: string) => void;
    merge: () => void;
    patch: (ids: string[], next: Partial<Slip>) => void;
    pick: (itemId: string, mods: { meta: boolean; shift: boolean }) => void;
    scope: string[];
    setArchived: boolean;
    setDone: boolean;
  }
): void => {
  if (id === null) {
    return;
  }
  if (id === "copy") {
    act.copy(slip);
    return;
  }
  if (id === "copy-list") {
    act.copyList();
    return;
  }
  if (id === "copy-ref") {
    act.copyRef(slip.id);
    return;
  }
  if (id === "copy-path") {
    act.copyPath(slip.id);
    return;
  }
  if (id === "copy-prompt") {
    act.copyPrompt(act.scope);
    return;
  }
  if (id === "mark") {
    act.pick(slip.id, { meta: true, shift: false });
    return;
  }
  if (id === "select-to") {
    act.pick(slip.id, { meta: false, shift: true });
    return;
  }
  if (id === "done") {
    act.patch(act.scope, { done: !act.setDone });
    return;
  }
  if (id === "pin") {
    act.patch(act.scope, { pin: !slip.pin });
    return;
  }
  if (id === "merge") {
    act.merge();
    return;
  }
  if (id === "archive") {
    act.patch(act.scope, { archived: !act.setArchived });
    return;
  }
  if (id.startsWith("section:")) {
    act.patch(act.scope, { section: id.slice(8) });
  }
};
