export interface MenuEntry {
  accelerator?: string;
  enabled?: boolean;
  id?: string;
  label?: string;
  submenu?: MenuEntry[];
  type?: "normal" | "separator";
}
