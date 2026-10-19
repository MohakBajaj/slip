export const NOTE_SOURCE = "note";

/** Trimmed note body, or null when the input should not be saved. */
export const noteBody = (raw: string): string | null => {
  const content = raw.trim();
  if (content.length === 0) {
    return null;
  }
  return content;
};
