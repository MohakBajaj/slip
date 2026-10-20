export interface ListCursor {
  anchor: string | null;
  focused: string | null;
  marked: string[];
}

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

export const moveListCursor = (
  ids: string[],
  cursor: ListCursor,
  delta: number,
  extend: boolean
): ListCursor => {
  const next = neighborId(ids, cursor.focused, delta);
  if (next === null || next === cursor.focused) {
    return cursor;
  }
  if (!extend) {
    return { anchor: null, focused: next, marked: cursor.marked };
  }
  const anchor = cursor.anchor ?? cursor.focused ?? next;
  return {
    anchor,
    focused: next,
    marked: rangeIds(ids, anchor, next),
  };
};
