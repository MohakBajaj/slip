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
      <g transform="scale(1.454545)">
        <mask id="jot-tray-cut" maskUnits="userSpaceOnUse">
          <rect fill="white" height="22" width="22" />
          <g fill="black" transform="translate(15 12) rotate(-45)">
            <rect height="6.5" width="1.2" x="-0.6" y="-6.5" />
            <circle r="0.9" />
          </g>
        </mask>
        <g mask="url(#jot-tray-cut)">
          <path
            d="M4 4H15V16L12 19H4ZM12 19V16H15"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="miter"
            strokeWidth="2"
          />
          <path
            d="M0-6L3-1L1.8 5.2Q1.8 5.7 1.3 5.7H-1.3Q-1.8 5.7-1.8 5.2L-3-1Z"
            fill="currentColor"
            stroke="none"
            transform="translate(15 12) rotate(-45)"
          />
        </g>
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
