import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

const filtered = (sections: string[], typed: string): string[] => {
  const query = typed.trim().toLowerCase();
  if (query.length === 0) {
    return sections;
  }
  return sections.filter((name) => name.toLowerCase().includes(query));
};

const isNew = (sections: string[], typed: string): boolean => {
  const named = typed.trim();
  if (named.length === 0 || named.toLowerCase() === "inbox") {
    return false;
  }
  return !sections.some((name) => name.toLowerCase() === named.toLowerCase());
};

const Choice = ({
  current,
  label,
  onPick,
}: {
  current: boolean;
  label: string;
  onPick: () => void;
}) => (
  <button
    className={cn(
      "hover:bg-muted w-full rounded-md px-2 py-1 text-left text-xs",
      current ? "text-primary" : ""
    )}
    onClick={onPick}
    type="button"
  >
    {label}
  </button>
);

const Menu = ({
  creating,
  onPick,
  sections,
  value,
}: {
  creating: string;
  onPick: (name: string) => void;
  sections: string[];
  value: string;
}) => (
  <div className="no-scrollbar scroll-fade flex max-h-56 flex-col overflow-y-auto p-1">
    {creating.length > 0 ? (
      <Choice
        current={false}
        label={`Create “${creating}”`}
        onPick={() => {
          onPick(creating);
        }}
      />
    ) : null}
    {sections.map((name) => (
      <Choice
        current={name === value}
        key={name}
        label={name}
        onPick={() => {
          onPick(name);
        }}
      />
    ))}
    <div className="bg-border my-1 h-px" />
    <Choice
      current={value.length === 0}
      label="Inbox"
      onPick={() => {
        onPick("");
      }}
    />
  </div>
);

const MenuPopup = ({
  children,
  float,
  trigger,
}: {
  children: ReactNode;
  float: RefObject<HTMLDivElement | null>;
  trigger: HTMLElement | null;
}) => {
  if (trigger === null) {
    return null;
  }
  const box = trigger.getBoundingClientRect();
  const width = Math.min(208, window.innerWidth - 20);
  let { left } = box;
  if (left + width > window.innerWidth - 10) {
    left = window.innerWidth - 10 - width;
  }
  if (left < 10) {
    left = 10;
  }
  return createPortal(
    <div
      className="bg-popover fixed z-50 rounded-[10px] shadow-md ring-1 ring-black/10"
      ref={float}
      style={{
        bottom: window.innerHeight - box.top + 4,
        left,
        width,
      }}
    >
      {children}
    </div>,
    document.body
  );
};

const useDismiss = (open: boolean, onClose: () => void) => {
  const root = useRef<HTMLDivElement>(null);
  const float = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onDoc = (event: MouseEvent): void => {
      const { target } = event;
      if (!(target instanceof Node)) {
        return;
      }
      if (root.current !== null && root.current.contains(target)) {
        return;
      }
      if (float.current !== null && float.current.contains(target)) {
        return;
      }
      onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, open]);
  return { float, root };
};

const stopEnter = (event: {
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
}): void => {
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
  }
};

export const SectionPicker = ({
  onChange,
  placeholder,
  sections,
  tone = "bar",
  value,
}: {
  onChange: (name: string) => void;
  placeholder: string;
  sections: string[];
  tone?: "bar" | "chip";
  value: string;
}) => {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const close = useCallback((): void => {
    setOpen(false);
    setTyped("");
  }, []);
  const { float, root } = useDismiss(open, close);
  const trigger = useRef<HTMLElement | null>(null);
  const choices = filtered(sections, typed);
  const creating = isNew(sections, typed) ? typed.trim() : "";

  const handlePick = (name: string): void => {
    onChange(name);
    close();
  };

  const handleEnter = (): void => {
    const named = typed.trim();
    if (named.length > 0 && named.toLowerCase() !== "inbox") {
      onChange(named);
    } else if (named.toLowerCase() === "inbox") {
      onChange("");
    }
    close();
  };

  const popup = open ? (
    <MenuPopup float={float} trigger={trigger.current}>
      {tone === "chip" ? (
        <input
          autoFocus
          className="border-input placeholder:text-muted-foreground mx-1 mt-1 h-7 w-[calc(100%-0.5rem)] rounded-lg border bg-transparent px-2 text-xs outline-none"
          onChange={(event) => {
            setTyped(event.target.value);
          }}
          onKeyDown={(event) => {
            stopEnter(event);
            if (event.key === "Enter") {
              handleEnter();
            }
          }}
          placeholder="Find or create a section"
          value={typed}
        />
      ) : null}
      <Menu
        creating={creating}
        onPick={handlePick}
        sections={choices}
        value={value}
      />
    </MenuPopup>
  ) : null;

  if (tone === "chip") {
    return (
      <div className="relative flex h-6 items-center" ref={root}>
        <button
          className={cn(
            "press relative flex h-6 items-center rounded-full px-2 text-[10px] leading-none after:absolute after:-inset-1.5 after:content-['']",
            value.length > 0
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => {
            setOpen((next) => !next);
            setTyped("");
          }}
          ref={(node) => {
            trigger.current = node;
          }}
          type="button"
        >
          {value || placeholder}
        </button>
        {popup}
      </div>
    );
  }

  return (
    <div className="relative min-w-0 flex-1" ref={root}>
      <input
        className="border-input placeholder:text-muted-foreground h-7 w-full rounded-lg border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--primary),transparent_70%)]"
        onChange={(event) => {
          setTyped(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setTyped("");
          setOpen(sections.length > 0);
        }}
        onKeyDown={(event) => {
          stopEnter(event);
          if (event.key === "Enter") {
            handleEnter();
          }
        }}
        placeholder={value || placeholder}
        ref={(node) => {
          trigger.current = node;
        }}
        value={typed}
      />
      {popup}
    </div>
  );
};
