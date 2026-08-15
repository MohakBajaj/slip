import type { Slip } from "../../../shared/types";

export const copySlip = async (slip: Slip): Promise<void> => {
  if (slip.images.length > 0) {
    await window.slip.copyBundle(slip.content, slip.images);
    return;
  }
  await window.slip.copyText(slip.content);
};
