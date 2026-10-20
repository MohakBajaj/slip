import { CircleCheck, Pin } from "lucide-react";

import type { Slip } from "../../../shared/types";

export const SlipMark = ({
  marked = false,
  slip,
}: {
  marked?: boolean;
  slip: Slip;
}) => {
  if (slip.done) {
    return <CircleCheck className="size-3.5" />;
  }
  if (slip.pin) {
    return <Pin className="size-3.5" />;
  }
  if (marked) {
    return <span className="bg-primary block size-3.5 rounded-full" />;
  }
  return (
    <span className="border-muted-foreground/80 group-hover/mark:border-foreground/50 block size-3.5 rounded-full border transition-[border-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]" />
  );
};
