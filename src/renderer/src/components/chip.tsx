import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const Chip = ({
  children,
  on,
  onClick,
}: {
  children: ReactNode;
  on: boolean;
  onClick: () => void;
}) => (
  <button
    className={cn(
      "press relative rounded-full px-2 py-0.5 text-[11px] after:absolute after:-inset-x-0.5 after:-inset-y-2 after:content-['']",
      on
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-muted-foreground"
    )}
    onClick={onClick}
    type="button"
  >
    {children}
  </button>
);
