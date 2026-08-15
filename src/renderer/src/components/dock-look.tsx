import darkIcon from "@/assets/dock-dark.png";
import lightIcon from "@/assets/dock-light.png";

export const DockLook = ({ dark }: { dark: boolean }) => (
  <img
    alt="Dock icon"
    className="size-14 rounded-[13px] shadow-[0_1px_2px_rgba(0,0,0,0.16)]"
    src={dark ? darkIcon : lightIcon}
  />
);
