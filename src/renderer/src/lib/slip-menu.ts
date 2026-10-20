import type { MenuEntry } from "../../../shared/menu";
import { menuAccelerator } from "../../../shared/shortcuts";
import type { Shortcuts } from "../../../shared/shortcuts";
import type { Slip } from "../../../shared/types";

export const slipMenuEntries = ({
  canSelectTo,
  manyMarked,
  marked,
  sections,
  setArchived,
  setDone,
  shortcuts,
  slip,
}: {
  canSelectTo: boolean;
  manyMarked: boolean;
  marked: boolean;
  sections: string[];
  setArchived: boolean;
  setDone: boolean;
  shortcuts: Shortcuts;
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

  const key = (id: keyof Shortcuts): string => menuAccelerator(shortcuts[id]);

  return [
    { accelerator: key("copy"), id: copyId, label: copyLabel },
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
      accelerator: key("toggleMark"),
      id: "mark",
      label: marked ? "Remove from Selection" : "Add to Selection",
    },
    ...(canSelectTo ? [{ id: "select-to", label: "Select to Here" }] : []),
    { accelerator: key("done"), id: "done", label: doneLabel },
    {
      accelerator: key("pin"),
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
      accelerator: key("archive"),
      id: "archive",
      label: archiveLabel,
    },
    {
      accelerator: key("delete"),
      id: "delete",
      label: useSet ? "Delete Selected" : "Delete",
    },
    ...(useSet
      ? []
      : [
          { type: "separator" as const },
          { accelerator: key("edit"), id: "edit", label: "Edit" },
        ]),
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
    edit: (item: Slip) => void;
    merge: () => void;
    patch: (ids: string[], next: Partial<Slip>) => void;
    pick: (itemId: string, mods: { meta: boolean; shift: boolean }) => void;
    remove: (ids: string[]) => void;
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
  if (id === "edit") {
    act.edit(slip);
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
  if (id === "delete") {
    act.remove(act.scope);
    return;
  }
  if (id.startsWith("section:")) {
    act.patch(act.scope, { section: id.slice(8) });
  }
};
