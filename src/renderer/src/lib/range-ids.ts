import { rangeIds } from "../../../shared/list-cursor";

export { neighborId, rangeIds } from "../../../shared/list-cursor";

export const applyPick = (
  ids: string[],
  focused: string | null,
  marked: string[],
  id: string,
  mods: { meta: boolean; shift: boolean }
): { focused: string | null; marked: string[] } => {
  if (mods.meta) {
    const next = marked.includes(id)
      ? marked.filter((item) => item !== id)
      : [...marked, id];
    return { focused: id, marked: next };
  }
  if (mods.shift) {
    const anchor = focused ?? marked[0] ?? id;
    return { focused: id, marked: rangeIds(ids, anchor, id) };
  }
  return { focused: id, marked: [] };
};
