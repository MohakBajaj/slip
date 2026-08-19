export interface ClipSnap {
  files: string[];
  html: string;
  imagePng: Buffer | null;
  text: string;
}

export interface ClipDelta {
  files: string[];
  html: string;
  imagePng: Buffer | null;
  text: string;
}

export const samePng = (left: Buffer | null, right: Buffer | null): boolean => {
  if (left === null || right === null) {
    return left === right;
  }
  return left.equals(right);
};

export const clipDelta = (before: ClipSnap, after: ClipSnap): ClipDelta => {
  const beforeFiles = new Set(before.files);
  return {
    files: after.files.filter((file) => !beforeFiles.has(file)),
    html: before.html === after.html ? "" : after.html,
    imagePng:
      after.imagePng !== null && !samePng(after.imagePng, before.imagePng)
        ? after.imagePng
        : null,
    text: before.text.trim() === after.text.trim() ? "" : after.text.trim(),
  };
};

export const clipChanged = (delta: ClipDelta): boolean =>
  delta.text.length > 0 ||
  delta.imagePng !== null ||
  delta.files.length > 0 ||
  delta.html.length > 0;
