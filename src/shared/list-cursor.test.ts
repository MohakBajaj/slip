import { describe, expect, test } from "bun:test";

import { moveListCursor } from "./list-cursor";
import type { ListCursor } from "./list-cursor";

const ids = ["a", "b", "c", "d"];

const at = (focused: string, marked: string[] = []): ListCursor => ({
  anchor: null,
  focused,
  marked,
});

describe("list cursor", () => {
  test("shift move keeps the first row as the anchor", () => {
    const down = moveListCursor(ids, at("a"), 1, true);
    const further = moveListCursor(ids, down, 1, true);
    expect(down.marked).toEqual(["a", "b"]);
    expect(further.anchor).toBe("a");
    expect(further.focused).toBe("c");
    expect(further.marked).toEqual(["a", "b", "c"]);
  });

  test("a plain move or click starts the next range over", () => {
    const extended = moveListCursor(
      ids,
      moveListCursor(ids, at("a"), 1, true),
      1,
      true
    );
    const moved = moveListCursor(ids, extended, 1, false);
    expect(moved.anchor).toBeNull();
    expect(moved.focused).toBe("d");
    const again = moveListCursor(ids, moved, -1, true);
    expect(again.marked).toEqual(["c", "d"]);

    const clicked = { ...extended, anchor: null, focused: "b" };
    const fromClick = moveListCursor(ids, clicked, 1, true);
    expect(fromClick.anchor).toBe("b");
    expect(fromClick.marked).toEqual(["b", "c"]);
  });

  test("moving keeps an existing selection", () => {
    const selected = at("a", ["a", "c"]);
    const down = moveListCursor(ids, selected, 1, false);
    const up = moveListCursor(ids, down, -1, false);
    expect(down.focused).toBe("b");
    expect(down.marked).toEqual(["a", "c"]);
    expect(up.focused).toBe("a");
    expect(up.marked).toEqual(["a", "c"]);
  });
});
