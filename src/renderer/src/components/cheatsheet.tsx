import { CHEATSHEET, shortcutLabel } from "../../../shared/shortcuts";
import type { Shortcuts } from "../../../shared/shortcuts";

const rowKeys = (hotkey: string, alias: string | undefined): string => {
  const main = shortcutLabel(hotkey);
  if (alias === undefined) {
    return main;
  }
  return `${main}  ${shortcutLabel(alias)}`;
};

export const Cheatsheet = ({
  onClose,
  shortcuts,
}: {
  onClose: () => void;
  shortcuts: Shortcuts;
}) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden p-2 pt-12">
    <button
      aria-label="Close shortcuts"
      className="absolute inset-0 bg-black/30"
      onClick={onClose}
      type="button"
    />
    <div className="bg-popover text-popover-foreground relative z-10 max-h-[calc(100%-1rem)] w-full max-w-sm overflow-x-hidden overflow-y-auto rounded-xl p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.12),0_16px_40px_rgba(0,0,0,0.18)]">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium">Shortcuts</p>
        <p className="text-muted-foreground font-mono text-[11px]">Esc</p>
      </div>
      <div className="flex flex-col gap-3">
        {CHEATSHEET.map((group) => (
          <section className="flex flex-col" key={group.title}>
            <p className="text-muted-foreground px-0.5 pb-1 text-[11px]">
              {group.title}
            </p>
            {group.rows.map((row) => (
              <div
                className="flex items-center justify-between gap-3 py-0.5"
                key={row.id}
              >
                <span className="min-w-0 truncate text-[13px]">
                  {row.label}
                </span>
                <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                  {rowKeys(shortcuts[row.id], row.alias)}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className="text-muted-foreground mt-3 text-[11px]">
        ⇧⌘C list · ⇧⌘P prompt · ⇧⌘M merge
      </p>
    </div>
  </div>
);
