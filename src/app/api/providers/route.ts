import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getCurrentUser } from "@/lib/auth";
import { maxEditImagesForProvider, maxResolutionForProvider } from "@/lib/image-options";
import { listProviders, addProvider, ProviderConfig } from "@/lib/db";
import { getImagePriceForModel } from "@/lib/pricing";
import { v4 as uuidv4 } from "uuid";

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return "****" + key.slice(-4);
}

/** Field công khai cho Generate/Edit — không lộ config/key. */
function publicProvider(p: ProviderConfig) {
  return {
    id: p.id,
    name: p.name,
    is_default: p.is_default,
    max_edit_images: maxEditImagesForProvider(p),
    max_resolution: maxResolutionForProvider(p),
    price_vnd: getImagePriceForModel(p.model),
  };
}

/** Field quản trị cho Settings (admin) — key chỉ mask, không full. */
function adminProvider(p: ProviderConfig) {
  return {
    id: p.id,
    name: p.name,
    api_type: p.api_type,
    base_url: p.base_url,
    api_key: maskKey(p.api_key),
    model: p.model,
    is_default: p.is_default,
    enabled: p.enabled,
    created_at: p.created_at,
    max_edit_images: maxEditImagesForProvider(p),
    max_resolution: maxResolutionForProvider(p),
  };
}

function isApiType(value: string): value is ProviderConfig["api_type"] {
  return (
    value === "openai" ||
    value === "gemini" ||
    value === "vertex" ||
    value === "chatgpt_bridge" ||
    value === "flow"
  );
}

function isFlowImageEnabled(): boolean {
  const route = (process.env.FLOW_IMAGE_ROUTE || "disabled").trim();
  return route === "direct" || route === "cpa";
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  let providers = await listProviders();
  // Bridge chỉ dành cho admin — user thường không thấy trong dropdown.
  if (user.role !== "admin") {
    providers = providers.filter((p) => p.api_type !== "chatgpt_bridge");
  }
  // Flow providers chỉ hiện khi route ảnh đã bật.
  if (!isFlowImageEnabled()) {
    providers = providers.filter((p) => p.api_type !== "flow");
  }

  const payload = user.role === "admin"
    ? providers.map(adminProvider)
    : providers.map(publicProvider);

  return NextResponse.json({ providers: payload });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, api_type, base_url, api_key, model, is_default } = body;

    const apiType = api_type || "openai";
    if (!isApiType(apiType)) return NextResponse.json({ error: "Loại API không hợp lệ" }, { status: 400 });
    if (!name?.trim()) return NextResponse.json({ error: "Vui lòng nhập tên" }, { status: 400 });
    if (apiType === "chatgpt_bridge") {
      if (!api_key?.trim()) return NextResponse.json({ error: "Provider ChatGPT Web Bridge cần token." }, { status: 400 });
      if (!base_url?.trim()) return NextResponse.json({ error: "Provider ChatGPT Web Bridge cần Base URL." }, { status: 400 });
    } else if (apiType === "flow") {
      // Flow dùng env FLOW_BRIDGE_* / FLOW_CPA_* — không bắt buộc key trong provider.
    } else if (apiType !== "vertex" && !api_key?.trim()) {
      return NextResponse.json({ error: "Vui lòng nhập API key" }, { status: 400 });
    }
    if (!model?.trim()) return NextResponse.json({ error: "Vui lòng nhập tên model" }, { status: 400 });

    const provider: ProviderConfig = {
      id: uuidv4(),
      name: name.trim(),
      api_type: apiType,
      base_url: base_url?.trim() || "",
      api_key: apiType === "vertex" ? "" : api_key.trim(),
      model: model.trim(),
      is_default: is_default || false,
      enabled: true,
      created_at: new Date().toISOString(),
    };

    await addProvider(provider);
    return NextResponse.json({ provider: adminProvider(provider) });
  } catch {
    return NextResponse.json({ error: "Lỗi thêm provider" }, { status: 500 });
  }
}
