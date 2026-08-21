import { CheckmarkCircle02Icon, PinIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { Slip } from "../../../shared/types";

export const SlipMark = ({
  marked = false,
  slip,
}: {
  marked?: boolean;
  slip: Slip;
}) => {
  if (slip.done) {
    return <HugeiconsIcon className="size-3.5" icon={CheckmarkCircle02Icon} />;
  }
  if (slip.pin) {
    return <HugeiconsIcon className="size-3.5" icon={PinIcon} />;
  }
  if (marked) {
    return <span className="bg-primary block size-3.5 rounded-full" />;
  }
  return (
    <span className="border-border group-hover/mark:border-foreground/50 block size-3.5 rounded-full border transition-[border-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]" />
  );
};
