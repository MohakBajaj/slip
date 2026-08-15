import type { TrayIconId } from "../../../shared/appearance";

export const TrayGlyph = ({ id }: { id: TrayIconId }) => (
  <svg
    aria-hidden
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.8"
    viewBox="0 0 32 32"
  >
    {id === "slip" ? (
      <g transform="rotate(-10 16 16)">
        <rect height="19" rx="1.6" width="14" x="9" y="6.5" />
        <path d="M12.2 13.2h7.4M12.4 17.2h5.8" />
      </g>
    ) : null}
    {id === "shift" ? (
      <path d="M8.2 16.6 16 11.2l7.8 5.4M8.2 24 16 18.6 23.8 24" />
    ) : null}
    {id === "inbox" ? (
      <path d="M6.5 14h4.7l2 4.2h5.6l2-4.2h4.7l-2.1 10.2H8.6L6.5 14Zm9.5-6.8v9.2m-3.4-5.2L16 7.2l3.4 4" />
    ) : null}
    {id === "pin" ? (
      <>
        <circle cx="16" cy="11.2" r="5.6" />
        <path d="M16 16.6v9.8" />
        <circle cx="16" cy="10.8" fill="currentColor" r="1.3" />
      </>
    ) : null}
    {id === "dot" ? (
      <>
        <circle cx="16" cy="16" r="7.6" />
        <circle cx="16" cy="16" fill="currentColor" r="2.4" />
      </>
    ) : null}
    {id === "fold" ? (
      <path d="M9 6.5h9.6L23 11.2V25.5H9V6.5Zm9.6 0V11.2H23" />
    ) : null}
  </svg>
);
