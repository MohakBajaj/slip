import type { SlipApi } from "./index";

declare global {
  interface Window {
    slip: SlipApi;
  }
}
