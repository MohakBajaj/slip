import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";

import { isImageName } from "../../../shared/images";
import type { ImagePayload } from "../../../shared/images";

export const isImageFile = (file: File): boolean =>
  file.type.startsWith("image/") || isImageName(file.name);

export const hasImageFiles = (data: DataTransfer | null): boolean => {
  if (!data) {
    return false;
  }
  if (!data.types.includes("Files")) {
    return false;
  }
  if (data.files.length === 0) {
    return true;
  }
  return [...data.files].some(isImageFile);
};

export const filesFromList = (list: FileList | File[]): File[] =>
  [...list].filter(isImageFile);

export const filesFromClipboard = (data: DataTransfer | null): File[] => {
  if (!data) {
    return [];
  }
  const files = filesFromList(data.files);
  if (files.length > 0) {
    return files;
  }
  return [...data.items]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .flatMap((item) => {
      const file = item.getAsFile();
      return file && isImageFile(file) ? [file] : [];
    });
};

const fileName = (file: File): string => {
  if (isImageName(file.name)) {
    return file.name;
  }
  return `${file.name || "image"}.png`;
};

export const filesToPayloads = async (
  files: File[]
): Promise<ImagePayload[]> => {
  const images = files.filter(isImageFile);
  return await Promise.all(
    images.map(async (file) => ({
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: fileName(file),
    }))
  );
};

export interface PendingImage {
  file: File;
  id: string;
  url: string;
}

export const pendingFromFiles = (files: File[]): PendingImage[] =>
  files.filter(isImageFile).map((file) => ({
    file,
    id: crypto.randomUUID(),
    url: URL.createObjectURL(file),
  }));

export const forgetPending = (items: PendingImage[]): void => {
  for (const item of items) {
    URL.revokeObjectURL(item.url);
  }
};

interface DragProps {
  onDragEnter: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

export const useFileDrop = (
  onFiles: (files: File[]) => void,
  enabled = true
): { over: boolean; props: DragProps } => {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const reset = (): void => {
    depth.current = 0;
    setOver(false);
  };

  return {
    over,
    props: {
      onDragEnter: (event) => {
        if (!(enabled && hasImageFiles(event.dataTransfer))) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        depth.current += 1;
        setOver(true);
      },
      onDragLeave: (event) => {
        if (!enabled) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) {
          setOver(false);
        }
      },
      onDragOver: (event) => {
        if (!(enabled && hasImageFiles(event.dataTransfer))) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      },
      onDrop: (event) => {
        if (!enabled) {
          return;
        }
        const files = filesFromList(event.dataTransfer.files);
        reset();
        if (files.length === 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onFiles(files);
      },
    },
  };
};

export const useDraggingFiles = (): boolean => {
  const [on, setOn] = useState(false);

  useEffect(() => {
    let depth = 0;
    const enter = (event: globalThis.DragEvent): void => {
      if (!hasImageFiles(event.dataTransfer)) {
        return;
      }
      depth += 1;
      setOn(true);
    };
    const leave = (): void => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setOn(false);
      }
    };
    const end = (): void => {
      depth = 0;
      setOn(false);
    };
    const over = (event: globalThis.DragEvent): void => {
      if (!hasImageFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", end);
      window.removeEventListener("dragend", end);
    };
  }, []);

  return on;
};
