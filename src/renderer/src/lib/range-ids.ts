export const rangeIds = (
  ids: string[],
  from: string | null,
  to: string
): string[] => {
  const end = ids.indexOf(to);
  if (end === -1) {
    return [to];
  }
  const start = from === null ? end : ids.indexOf(from);
  if (start < 0) {
    return [to];
  }
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return ids.slice(lo, hi + 1);
};

export const neighborId = (
  ids: string[],
  focused: string | null,
  delta: number
): string | null => {
  if (ids.length === 0) {
    return null;
  }
  if (focused === null) {
    return delta > 0 ? (ids[0] ?? null) : (ids.at(-1) ?? null);
  }
  const index = ids.indexOf(focused);
  if (index === -1) {
    return ids[0] ?? null;
  }
  return ids[index + delta] ?? focused;
};

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
