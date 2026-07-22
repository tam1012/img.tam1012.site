export function getImagePriceVnd() {
  const value = Number(process.env.IMAGE_PRICE_VND || "100");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 100;
}

// Model ảnh qua Google Flow có thể đặt giá riêng (khuyến mãi kích cầu).
// Khi FLOW_IMAGE_PRICE_VND không set → dùng giá ảnh chung.
const FLOW_IMAGE_MODELS = new Set(["flow-nano-banana-2", "flow-nano-banana-pro"]);

export function getFlowImagePriceVnd() {
  const raw = process.env.FLOW_IMAGE_PRICE_VND;
  if (raw === undefined || raw === "") return getImagePriceVnd();
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : getImagePriceVnd();
}

// Gemini 3 Pro Image qua Vertex có giá đầu nguồn cao → đặt giá riêng.
// Khi GEMINI3_PRO_IMAGE_PRICE_VND không set → dùng giá ảnh chung.
const GEMINI3_PRO_IMAGE_MODELS = new Set(["gemini-3-pro-image"]);

export function getGemini3ProImagePriceVnd() {
  const raw = process.env.GEMINI3_PRO_IMAGE_PRICE_VND;
  if (raw === undefined || raw === "") return getImagePriceVnd();
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : getImagePriceVnd();
}

/** Giá 1 ảnh theo model user chọn (model hiển thị, không phải model thật sau rewrite). */
export function getImagePriceForModel(model: string | null | undefined) {
  if (model && FLOW_IMAGE_MODELS.has(model)) return getFlowImagePriceVnd();
  if (model && GEMINI3_PRO_IMAGE_MODELS.has(model)) return getGemini3ProImagePriceVnd();
  return getImagePriceVnd();
}

export function getVideoPriceVnd() {
  const value = Number(process.env.VIDEO_PRICE_VND || "1500");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1500;
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
