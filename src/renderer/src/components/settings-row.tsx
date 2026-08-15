import type { ReactNode } from "react";

export const SettingsRow = ({
  children,
  detail,
  label,
}: {
  children: ReactNode;
  detail?: string;
  label: string;
}) => (
  <div className="flex min-h-10 items-center justify-between gap-3 px-2.5">
    <div className="min-w-0">
      <p className="text-[13px] leading-none">{label}</p>
      {detail !== undefined && detail.length > 0 ? (
        <p className="text-muted-foreground mt-1 truncate text-[11px]">
          {detail}
        </p>
      ) : null}
    </div>
    {children}
  </div>
);
