import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { listSlips, saveNote } from "../vault";
import { parseSlip } from "./markdown-file";
import { NOTE_SOURCE, noteBody } from "./quick-note";

const vault = (): string => mkdtempSync(path.join(tmpdir(), "slip-note-"));

describe("note body", () => {
  test("blank input saves nothing", () => {
    expect(noteBody("")).toBeNull();
    expect(noteBody("   \n\t")).toBeNull();
    expect(noteBody("\n\n")).toBeNull();
  });

  test("keeps internal lines and indentation", () => {
    expect(noteBody("  first\n  second  \n")).toBe("first\n  second");
  });
});

describe("save note", () => {
  test("empty input does not write a slip", () => {
    const root = vault();
    expect(saveNote(root, "")).toBeNull();
    expect(saveNote(root, " \n\t ")).toBeNull();
    expect(readdirSync(root).filter((name) => name.endsWith(".md"))).toEqual(
      []
    );
  });

  test("multiline note reaches the vault as a note", () => {
    const root = vault();
    const raw = "first line\nsecond line";
    const slip = saveNote(root, `  ${raw}  `, "Ideas");
    expect(slip).not.toBeNull();
    if (slip === null) {
      return;
    }
    expect(slip.content).toBe(raw);
    expect(slip.source).toBe(NOTE_SOURCE);
    expect(slip.section).toBe("Ideas");
    expect(slip.page).toBe("");
    expect(slip.url).toBe("");
    expect(slip.images).toEqual([]);
    const file = path.join(root, slip.filename);
    expect(existsSync(file)).toBe(true);
    const disk = readFileSync(file, "utf8");
    expect(disk).toContain("source: note");
    expect(disk).toContain("first line\nsecond line");
    const parsed = parseSlip(slip.filename, disk);
    expect(parsed?.content).toBe(raw);
    expect(parsed?.source).toBe("note");
    expect(parsed?.id).toBe(slip.id);
    expect(parsed?.createdAt.length).toBeGreaterThan(0);
    const index = readFileSync(path.join(root, "INDEX.md"), "utf8");
    expect(index).toContain(slip.filename);
    expect(index).toContain("first line");
    const listed = listSlips(root);
    expect(listed.map((item) => item.id)).toEqual([slip.id]);
    expect(listed[0]?.source).toBe(NOTE_SOURCE);
    expect(listed[0]?.content).toBe(raw);
  });
});
