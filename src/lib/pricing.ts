export function getImagePriceVnd() {
  const value = Number(process.env.IMAGE_PRICE_VND || "100");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 100;
}

export function getVideoPriceVnd() {
  const value = Number(process.env.VIDEO_PRICE_VND || "5000");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5000;
}

export function quotaFromBalance(balanceVnd: number) {
  return Math.floor(balanceVnd / getImagePriceVnd());
}

export function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value) + "đ";
}

const LEDGER_TYPE_LABELS: Record<string, string> = {
  topup_manual: "Nạp tiền",
  topup_payos: "Nạp qua PayOS",
  charge_image: "Tạo ảnh",
  refund_image: "Hoàn tiền",
  charge_video: "Tạo video",
  refund_video: "Hoàn tiền video",
  adjust_manual: "Điều chỉnh",
};

export function formatLedgerType(type: string) {
  return LEDGER_TYPE_LABELS[type] ?? type;
}
