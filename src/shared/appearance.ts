export type ThemeId = "paper" | "ink" | "midnight" | "moss" | "rose" | "mono";
export type FontId = "geist" | "system" | "serif" | "news" | "mono";
export type TrayIconId = "slip" | "shift" | "inbox" | "pin" | "dot" | "fold";

export const THEMES: {
  darkHex: string;
  id: ThemeId;
  label: string;
  lightHex: string;
  swatch: [string, string, string];
}[] = [
  {
    darkHex: "#2a2722",
    id: "paper",
    label: "Paper",
    lightHex: "#f6f1e8",
    swatch: ["#f6f1e8", "#fffaf2", "#c4843a"],
  },
  {
    darkHex: "#111111",
    id: "ink",
    label: "Ink",
    lightHex: "#f7f7f5",
    swatch: ["#f7f7f5", "#ffffff", "#1c1b19"],
  },
  {
    darkHex: "#141821",
    id: "midnight",
    label: "Midnight",
    lightHex: "#eef1f6",
    swatch: ["#eef1f6", "#f7f9fc", "#3d5a80"],
  },
  {
    darkHex: "#1a221c",
    id: "moss",
    label: "Moss",
    lightHex: "#eef3ec",
    swatch: ["#eef3ec", "#f7faf5", "#4a7a52"],
  },
  {
    darkHex: "#23181a",
    id: "rose",
    label: "Rose",
    lightHex: "#f6eef0",
    swatch: ["#f6eef0", "#fdf6f7", "#a85a64"],
  },
  {
    darkHex: "#1c1d1f",
    id: "mono",
    label: "Mono",
    lightHex: "#f2f2f3",
    swatch: ["#f2f2f3", "#fafafa", "#6b7280"],
  },
];

export const FONTS: {
  id: FontId;
  label: string;
  sample: string;
  stack: string;
}[] = [
  {
    id: "geist",
    label: "Geist",
    sample: "A captured thought",
    stack: '"Geist Variable", sans-serif',
  },
  {
    id: "system",
    label: "System",
    sample: "A captured thought",
    stack: "ui-sans-serif, system-ui, sans-serif",
  },
  {
    id: "serif",
    label: "Serif",
    sample: "A captured thought",
    stack: 'ui-serif, "Iowan Old Style", Palatino, serif',
  },
  {
    id: "news",
    label: "Newsreader",
    sample: "A captured thought",
    stack: '"Newsreader Variable", ui-serif, serif',
  },
  {
    id: "mono",
    label: "Mono",
    sample: "A captured thought",
    stack: 'ui-monospace, "SF Mono", Menlo, monospace',
  },
];

export const TRAY_ICONS: { id: TrayIconId; label: string }[] = [
  { id: "slip", label: "Slip" },
  { id: "shift", label: "Shift" },
  { id: "inbox", label: "Inbox" },
  { id: "pin", label: "Pin" },
  { id: "dot", label: "Dot" },
  { id: "fold", label: "Fold" },
];

export const isThemeId = (value: string): value is ThemeId =>
  THEMES.some((theme) => theme.id === value);

export const isFontId = (value: string): value is FontId =>
  FONTS.some((font) => font.id === value);

export const isTrayIconId = (value: string): value is TrayIconId =>
  TRAY_ICONS.some((icon) => icon.id === value);
