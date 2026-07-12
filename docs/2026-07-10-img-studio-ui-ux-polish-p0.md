# Plan: IMG Studio UI/UX Polish (P0 + P1 selected)

- **Date:** 2026-07-10
- **Site:** https://imgstudio.site (legacy `img.tam1012.site` redirect)
- **Repo (VPS):** `/home/ubuntu/img-studio`
- **Scope:** UI/UX only — không đổi pricing, auth, billing logic, provider routing, hay DB schema trừ khi bắt buộc cho UI state
- **Goal:** Giảm cognitive load, gọn mobile, bớt lộ technical/ops ra mặt user — giữ dark zinc, task-first, paid flow hiện có
- **Executor:** Claude Code local (hoặc agent) implement theo checklist; verify trên desktop + mobile viewport

---

## 0. Context & nguyên tắc

### 0.1 Hiện trạng (đã review live admin 2026-07-10)

**Nên giữ (không phá):**
- Dark zinc theme (`#09090b`, border zinc-800, blue CTA)
- Prompt-first generate (textarea lớn, Ctrl+Enter, lịch sử prompt)
- Giá / số dư / admin free badge trước khi bấm tạo
- Edit: drag-drop + paste ảnh
- Gallery: lightbox, pagination, multi-select, soft/hard delete (typed `XOA`)
- Billing: gói nạp + ledger + PayOS
- Admin: search/sort users, wallet adjust, block, site notice
- Login tabs + show/hide password + identifier email/SĐT

**Điểm yếu chính:**
1. Header quá tải trên mobile (7 nav + account chip + logout wrap 2–3 hàng)
2. Generate/Edit control row quá “form kỹ thuật” (nhiều native `<select>`)
3. Settings lộ API key plaintext
4. Video page cognitive load cao (model id raw, account id, mode/resolution nhảy theo model)
5. Confirm/delete dùng `window.confirm` / `prompt` native — lệch dark UI

### 0.2 Nguyên tắc implement

1. **Thay đổi nhỏ, có thể verify** — từng PR/commit theo phase; không rewrite toàn app.
2. **Không đổi API contract** trừ khi UI cần field display-only (label) đã có sẵn.
3. **Giữ class Tailwind hiện có** — không thêm design system lớn.
4. **Desktop không bị phá** khi fix mobile.
5. **Admin-only controls** ẩn với user thường (đã có pattern `role === "admin"`).
6. **A11y tối thiểu:** focus trap modal, Esc đóng, `aria-label` cho icon buttons.
7. **Backup trước khi sửa file lớn:** copy file → `backups/ui-ux-20260710/`.

### 0.3 File map chính

| Area | Files |
|---|---|
| Shell / nav | `src/components/Header.tsx`, `src/components/AppShell.tsx`, `src/components/SiteFooter.tsx` |
| Generate | `src/app/generate/page.tsx` |
| Edit | `src/app/edit/page.tsx` |
| Video | `src/app/video/page.tsx` |
| Gallery | `src/app/gallery/page.tsx` |
| Billing | `src/app/billing/page.tsx` |
| Settings | `src/app/settings/page.tsx` |
| Admin | `src/app/admin/page.tsx` |
| Login | `src/app/login/page.tsx` |
| Global CSS | `src/app/globals.css` |
| Shared UI (mới) | `src/components/ui/Modal.tsx`, `src/components/ui/ConfirmDialog.tsx`, `src/components/AccountMenu.tsx`, `src/components/MobileNav.tsx` (tạo mới) |

---

## 1. Phase A — Shared foundations (làm trước)

### A1. Thư mục component UI dùng chung

**Lý do:** Modal/confirm lặp ở Gallery, Settings, Admin, Video. Native `confirm/prompt` xấu và khó style.

**Cách làm:**

1. Tạo `src/components/ui/Modal.tsx`
   - Props: `open`, `onClose`, `title?`, `children`, `footer?`, `size?: "sm"|"md"|"lg"`
   - Overlay: `fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm`
   - Panel: `bg-zinc-900 border border-zinc-800 rounded-xl max-w-* w-full mx-4`
   - Behavior:
     - `useEffect` listen `Escape` → `onClose`
     - Click overlay → `onClose` (trừ khi `disableOverlayClose`)
     - Body scroll lock khi open (`document.body.style.overflow = "hidden"`)
     - Focus first focusable khi open

2. Tạo `src/components/ui/ConfirmDialog.tsx` dựa trên Modal
   - Props:
     ```ts
     {
       open: boolean;
       title: string;
       description?: string;
       confirmLabel?: string;      // default "Xác nhận"
       cancelLabel?: string;       // default "Huỷ"
       tone?: "default" | "danger";
       requireText?: string;       // e.g. "XOA" cho hard delete
       loading?: boolean;
       onConfirm: () => void | Promise<void>;
       onCancel: () => void;
     }
     ```
   - Nếu `requireText`: hiện input, disable confirm đến khi gõ đúng (trim, case-sensitive như hiện tại `"XOA"`)
   - Tone danger: nút confirm `bg-red-600 hover:bg-red-500`

3. Export barrel optional: `src/components/ui/index.ts` (không bắt buộc)

**Verify:**
- Story tối thiểu: mở modal từ 1 trang test tạm hoặc dev log; Esc/overlay đóng OK.
- Không regression build: `npm run build` (hoặc `npm run lint` nếu build nặng).

**Rollback:** xoá 2 file mới; chưa wire vào pages thì zero impact.

---

### A2. Helper mask secret

**Lý do:** Settings hiện full API key trên list.

**Cách làm:**

1. Tạo `src/lib/mask.ts` (hoặc thêm vào file util hiện có nếu có):
   ```ts
   export function maskSecret(value: string, opts?: { head?: number; tail?: number }): string {
     if (!value) return "";
     if (value.length <= 8) return "••••••••";
     const head = opts?.head ?? 3;
     const tail = opts?.tail ?? 4;
     return `${value.slice(0, head)}••••${value.slice(-tail)}`;
   }
   ```
2. Chỉ dùng cho **display**. Không đụng API response nếu server đã trả full key (v1 plaintext in DB — ngoài scope security rewrite; UI mask là lớp bảo vệ nhìn thấy).

**Verify:** unit mental check: `"sk-abc1234567890xyz"` → `"sk-••••0xyz"` (tuỳ head/tail chọn).

---

## 2. Phase B — Header / Navigation (P0 #1, #2)

### B1. Desktop: gọn account area

**Lý do:** Chip `Admin · Admin miễn phí` + nút Đăng xuất rời rạc; admin có 7 link horizontal chật.

**Cách làm trong `Header.tsx`:**

1. Giữ `NAV_LINKS` core cho mọi user:
   - Tạo ảnh `/generate`
   - Chỉnh sửa `/edit`
   - Tạo video `/video`
   - Thư viện `/gallery`
   - Nạp tiền `/billing`

2. Tách admin links ra khỏi top nav chính:
   - `Cài đặt` `/settings`
   - `Admin` `/admin`
   - Chỉ hiện trong **Account menu** (hoặc dropdown “Quản trị”) khi `role === "admin"`

3. Thay block account + logout bằng `AccountMenu`:
   - Trigger button: tên ngắn (truncate 16–20 ký tự) + caret
   - Dropdown panel (absolute right-0):
     - Dòng số dư: user → `12.000đ · 120 ảnh · 2 video`; admin → `Admin · miễn phí`
     - Link: Nạp tiền
     - Nếu admin: Cài đặt, Admin
     - Divider
     - Đăng xuất (danger text)
   - Click outside / Esc đóng

4. Active state nav: giữ exact match; optional improve:
   ```ts
   pathname === link.href || pathname.startsWith(link.href + "/")
   ```

5. Sticky header giữ; giảm `flex-wrap` chaos:
   - `nav` desktop: `hidden md:flex`
   - Không để account chip full text dài trên 1 dòng nav

**Verify desktop ≥768px:**
- 5 nav items + logo + account menu
- Admin vẫn vào được Settings/Admin qua menu
- Logout vẫn work

### B2. Mobile: bottom tab + hamburger/account

**Lý do:** Screenshot mobile generate — nav chiếm gần nửa màn trước prompt.

**Cách làm:**

1. Tạo `src/components/MobileNav.tsx` (bottom fixed):
   - 4–5 tab chính:
     - Tạo `/generate`
     - Sửa `/edit`
     - Video `/video`
     - Thư viện `/gallery`
     - Thêm (mở sheet: Nạp tiền, Cài đặt?, Admin?, Đăng xuất)
   - Style: `fixed bottom-0 inset-x-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur`
   - Active: text zinc-100 + indicator
   - Safe area: `pb-[env(safe-area-inset-bottom)]`

2. `AppShell.tsx`:
   - Thêm padding bottom mobile khi có MobileNav: `pb-16 md:pb-0` trên content wrapper
   - Render `<MobileNav />` chỉ `md:hidden` (CSS) hoặc conditional client width — ưu tiên CSS `md:hidden` để tránh hydration flash nếu có thể

3. Header mobile (`md:hidden` path):
   - Hàng 1: Logo | balance compact | Account menu button
   - **Ẩn** full nav links trên header mobile (đã có bottom tab)

4. Balance compact mobile:
   - User: `12kđ` hoặc `120 ảnh` (chọn 1 metric chính + tap mở menu xem đủ)
   - Admin: `Admin`

**Verify mobile 390×844:**
- Prompt generate nhìn thấy above the fold (không bị nav 3 hàng chèn)
- Bottom tab không che nút “Tạo ảnh” (padding content OK)
- Không double-nav (header links + bottom) trên mobile

**Rollback:** revert Header/AppShell/MobileNav.

---

## 3. Phase C — Generate page (P0 #3 + polish)

### C1. Layout hierarchy mới

**Lý do:** User primary action = gõ prompt + tạo. Provider/quality là secondary.

**Target structure (desktop & mobile):**

```
[ Prompt textarea ]
[ Lịch sử prompt toggle ]
[ Preset chips: 1:1·1K | 9:16·2K | 16:9·4K | ... ]
[ ▸ Tuỳ chọn nâng cao ]  // collapsed mặc định trên mobile; desktop có thể expanded
    Provider | Tỷ lệ | Độ phân giải | Chất lượng | Số lượng
[ Cost bar: 100đ/ảnh · Còn N ảnh / Admin miễn phí ]
[ Primary CTA: Tạo ảnh ]
[ Error / Result ]
```

### C2. Preset chips

**Cách làm trong `generate/page.tsx`:**

1. Định nghĩa:
   ```ts
   const PRESETS = [
     { id: "sq1k", label: "Vuông 1K", aspectRatio: "1:1", resolution: "1K" },
     { id: "story2k", label: "Story 2K", aspectRatio: "9:16", resolution: "2K" },
     { id: "wide2k", label: "Ngang 2K", aspectRatio: "16:9", resolution: "2K" },
     { id: "wide4k", label: "Ngang 4K", aspectRatio: "16:9", resolution: "4K" },
   ];
   ```
2. Click preset → set aspect + resolution; highlight chip active nếu match.
3. Nếu provider `max_resolution === "2K"` và preset 4K → disable chip + title “Model tối đa 2K”.

### C3. Advanced collapse

1. State: `const [showAdvanced, setShowAdvanced] = useState(false)`  
   - Desktop optional default `true` nếu muốn giữ power-user; **đề xuất default `false` trên mọi viewport** để consistent, power user mở 1 lần.
2. Các `<Select>` hiện tại chuyển vào block advanced.
3. Provider option label: giữ name từ API; nếu name đã friendly (hiện có `gemini-3.1-flash-image (4K)`) thì OK. Nếu raw id, map display:
   - Không hardcode quá nhiều; ưu tiên `provider.name` server-side đã set.

### C4. Quality helper text

**Lý do:** “Tiêu chuẩn/Cao” không rõ có tốn thêm tiền không.

**Cách làm:**
- Dưới select Chất lượng (khi advanced mở):  
  `Cùng giá · “Cao” có thể chậm hơn, chi tiết hơn (tuỳ model).`
- Hoặc tooltip `title` trên label.

### C5. Giữ nguyên

- Ctrl+Enter, idempotency poll, partial result, download webp/jpg, reset result
- Empty provider CTA → settings
- Low balance warnings

**Verify:**
- Tạo 1 ảnh flow không đổi API body fields
- Preset đổi state đúng
- Advanced collapse không làm mất giá trị select khi đóng/mở
- Mobile: CTA không bị bottom nav che

**Rollback:** revert `generate/page.tsx`.

---

## 4. Phase D — Edit page (align Generate)

### D1. Đồng bộ control density

**Lý do:** Edit cũng hàng select dài; user upload-first.

**Cách làm:**
1. Giữ dropzone + previews trên cùng (primary).
2. Prompt textarea ngay dưới.
3. Preset aspect/resolution chips (reuse PRESETS component nếu extract được).
4. Advanced: provider, quality, (aspect/resolution nếu không dùng chip).
5. Cost bar + CTA giống generate.

### D2. Extract shared controls (optional nhưng nên)

Nếu chạm cả generate + edit:
- `src/components/ImageGenControls.tsx` props:
  - `providers`, `providerId`, `onProviderChange`
  - `aspectRatio`, `resolution`, `quality`, `count?`
  - `showCount?: boolean`
  - `maxResolution?`
  - `showAdvanced` / controlled

**Không bắt buộc** nếu muốn diff nhỏ — copy pattern cũng được, chấp nhận nhẹ duplication.

**Verify:** paste/drag-drop vẫn work; max size/max images errors vẫn hiện.

---

## 5. Phase E — Settings API key mask (P0 #3)

### E1. List view

**File:** `src/app/settings/page.tsx`

**Lý do:** Screenshot list hiện full key — rủi ro shoulder-surf + screenshot leak.

**Cách làm:**
1. Dòng meta hiện tại kiểu:  
   `OpenAI · model · {api_key}`  
   → `OpenAI · model · {maskSecret(api_key)}`
2. Thêm nút nhỏ `Hiện` / `Ẩn` per-row (state `Set<string>` revealed ids) — chỉ client-side reveal.
3. Không log key ra console.

### E2. Edit form

1. Khi `startEdit`:
   - Option A (an toàn hơn UX): field api_key **trống** + placeholder `•••• (để trống nếu không đổi)` — **cần API PUT ignore empty key**. Kiểm tra `PUT /api/providers/[id]` trước.
   - Option B (ít đụng backend): prefill full key như hiện tại (vì admin-only page) nhưng list vẫn mask.
2. **Đề xuất:**  
   - Nếu backend đã hỗ trợ partial update / empty = keep old → dùng Option A.  
   - Nếu không: làm Option B ở vòng 1; note follow-up backend.

**Verify:**
- List không hiện full key mặc định
- Sửa provider + save vẫn work
- Set default / delete không regression

**Security note (ngoài scope nhưng ghi rõ):** key plaintext in DB/API vẫn là risk v1; mask UI không thay encrypt-at-rest.

---

## 6. Phase F — Video page (P1)

### F1. Mode-first layout

**Lý do:** Mode text/image + model constraints (Grok text-only / image-only) dễ confuse.

**Target:**

```
[ Tabs/cards lớn: Từ mô tả | Từ ảnh ]
[ Prompt ]
[ Nếu image mode: upload 1 ảnh ]
[ Model cards (không hiện raw id làm primary label) ]
[ Duration / Aspect / Resolution — chỉ option hợp lệ ]
[ Account select — ADMIN ONLY, collapsed “Nâng cao” ]
[ Cost bar ]
[ CTA Tạo video ]
[ Result + lịch sử video ]
```

### F2. Model display map

Trong `video/page.tsx`, thêm:

```ts
const MODEL_META: Record<string, { title: string; blurb: string }> = {
  "veo-3.1-generate-001": { title: "Veo 3.1", blurb: "Chất lượng cao" },
  "veo-3.1-fast-generate-001": { title: "Veo 3.1 Fast", blurb: "Nhanh hơn" },
  // ... đủ ALL_MODEL_OPTIONS
  "grok-imagine-video": { title: "Grok Video", blurb: "Text → video" },
  "grok-imagine-video-1.5-preview": { title: "Grok Video 1.5", blurb: "Ảnh → video" },
};
```

- UI card hiện `title` + `blurb`; value submit vẫn raw id.
- User non-admin: filter `PUBLIC_MODELS` như hiện tại.
- Ẩn 4K resolution với non-admin như hiện tại.

### F3. Account selector

- Chỉ render khi `isAdmin && accounts.length > 0`
- Đặt trong “Tuỳ chọn nâng cao” để user/admin nhẹ không thấy project id raw trừ khi cần

### F4. Loading copy

- Khi loading: `Đang tạo video... có thể mất 1–3 phút` (ước lượng; chỉnh theo thực tế log nếu biết)
- Giữ list videos + play thumbnail behavior

**Verify:**
- Switch model auto-adjust mode/resolution/duration (logic hiện có giữ)
- User không thấy admin-only models/accounts
- Generate API payload fields không đổi

---

## 7. Phase G — Replace native confirm/prompt (P1)

### G1. Gallery

**File:** `src/app/gallery/page.tsx`

Thay:
- `confirm("Xóa ảnh...")` single delete
- `confirm` bulk soft
- `confirm` + `prompt('Gõ XOA...')` bulk hard / hard all

Bằng `ConfirmDialog`:
- Single/soft: tone danger, no requireText
- Hard: `requireText="XOA"`, description rõ không hoàn tác / không hoàn tiền

State pattern:
```ts
type ConfirmState =
  | { type: "idle" }
  | { type: "delete_one"; img: ImageRecord }
  | { type: "bulk_soft" }
  | { type: "bulk_hard" }
  | { type: "hard_all_mine" };
```

### G2. Settings delete provider

- `confirm("Xoá provider này?")` → ConfirmDialog danger

### G3. Admin destructive actions

- Block/unblock, delete user (nếu có confirm native) → ConfirmDialog
- Wallet adjust **không** cần typed confirm; có thể giữ 1 confirm nhẹ nếu amount lớn (optional)

**Verify:**
- Hard delete vẫn chỉ chạy khi gõ đúng `XOA`
- Cancel không side-effect
- Mobile modal không tràn màn hình (max-height + scroll)

---

## 8. Phase H — Login / Billing / Admin polish nhỏ (P2 optional cùng PR hoặc sau)

### H1. Login domain banner dismiss

**File:** `src/app/login/page.tsx`

- Banner “chuyển sang imgstudio.site…”:
  - Thêm nút đóng
  - Persist `localStorage.setItem("imgstudio.hideDomainBanner", "1")`
  - Optional: chỉ hiện nếu `location.hostname` là legacy — hiện production primary đã là imgstudio.site nên banner có thể default ẩn sau dismiss

### H2. Billing admin banner

**File:** `src/app/billing/page.tsx`

- Nếu `/api/me` role admin: banner info  
  `Tài khoản admin không bị trừ tiền khi tạo ảnh/video. Gói nạp bên dưới chủ yếu để test PayOS.`

### H3. Footer

**File:** `src/components/SiteFooter.tsx` + AppShell

- Giữ Telegram contact 1 lần ở footer OK
- Không thêm contact block trùng trong từng page body (generate đã chỉ footer — OK)

### H4. Admin gallery filters (P2 — có thể tách PR)

- Filter user/provider/date khi scope=all — **cần API query support**; nếu API chưa có, ghi follow-up, đừng fake client-only trên 1 page.

---

## 9. Implementation order (khuyến nghị cho Claude Code)

Làm tuần tự, commit sau mỗi phase xanh:

| Step | Phase | Effort | Risk | Priority |
|---|---|---|---|---|
| 1 | A1 Modal + ConfirmDialog | S | Low | P0 foundation |
| 2 | A2 maskSecret | XS | Low | P0 |
| 3 | E Settings mask key | S | Low | P0 |
| 4 | B Header desktop cleanup + AccountMenu | M | Med | P0 |
| 5 | B MobileNav + AppShell padding | M | Med | P0 |
| 6 | C Generate presets + advanced | M | Low | P0 |
| 7 | D Edit align controls | S–M | Low | P1 |
| 8 | F Video mode/model cards | M | Med | P1 |
| 9 | G Wire ConfirmDialog gallery/settings/admin | M | Med | P1 |
| 10 | H Login/Billing polish | S | Low | P2 |

**Không làm trong plan này:**
- Đổi giá / wallet formula
- Encrypt provider keys at rest
- Rewrite gallery virtualized grid
- Light theme
- i18n framework
- OpenClaw/gateway changes

---

## 10. Concrete coding checklist (copy cho Claude Code)

### 10.1 Before

```bash
cd /path/to/img-studio
git status
git checkout -b ui/ux-polish-2026-07-10   # nếu dùng git
mkdir -p backups/ui-ux-20260710
cp src/components/Header.tsx backups/ui-ux-20260710/
cp src/components/AppShell.tsx backups/ui-ux-20260710/
cp src/app/generate/page.tsx backups/ui-ux-20260710/
cp src/app/edit/page.tsx backups/ui-ux-20260710/
cp src/app/video/page.tsx backups/ui-ux-20260710/
cp src/app/gallery/page.tsx backups/ui-ux-20260710/
cp src/app/settings/page.tsx backups/ui-ux-20260710/
cp src/app/login/page.tsx backups/ui-ux-20260710/
cp src/app/billing/page.tsx backups/ui-ux-20260710/
```

### 10.2 Build / run

```bash
# dev
npm run dev
# or production rebuild if deployed via docker
# docker compose build && docker compose up -d   # only if that is the deploy path
```

### 10.3 Manual QA matrix

| # | Case | Expected |
|---|---|---|
| 1 | Login admin | Vào `/generate` |
| 2 | Login user thường | Không thấy Settings/Admin top-level; không thấy admin models video |
| 3 | Mobile 390 width generate | Prompt + CTA dùng được; bottom nav không che CTA |
| 4 | Desktop generate | Preset + advanced; Ctrl+Enter; cost bar đúng |
| 5 | Generate 1 ảnh (admin free) | Success UI; download webp/jpg |
| 6 | Edit paste image | Preview + edit OK |
| 7 | Gallery single delete | Modal confirm; soft delete |
| 8 | Gallery hard bulk | Phải gõ XOA; sai thì không xoá |
| 9 | Settings list | Key masked; Hiện/Ẩn work |
| 10 | Settings edit provider | Save không phá default flag |
| 11 | Video text mode | Model cards; payload đúng |
| 12 | Video image mode | Upload required khi mode image |
| 13 | Billing | Packages vẫn tạo PayOS link |
| 14 | Admin users | Search/sort/topup vẫn OK |
| 15 | Logout | Về `/login`, API me 401 |

### 10.4 Visual acceptance

- Không horizontal scroll ngoài ý muốn ở 390px
- Contrast text zinc-400 trên zinc-900 đọc được
- Focus ring blue giữ trên input/button
- Không flash full API key trên settings list load

---

## 11. Component API sketches (để implement khớp)

### 11.1 AccountMenu

```tsx
// src/components/AccountMenu.tsx
"use client";
// props: me: MeData | null; onLogout: () => void;
// shows trigger + dropdown; includes admin links when role=admin
```

### 11.2 MobileNav

```tsx
// src/components/MobileNav.tsx
"use client";
// uses usePathname(); links: generate/edit/video/gallery + "more" sheet
// more sheet: billing, settings?, admin?, logout
```

### 11.3 ConfirmDialog usage example

```tsx
<ConfirmDialog
  open={confirm.type === "bulk_hard"}
  title="Xoá vĩnh viễn ảnh đã chọn?"
  description={`Sẽ gỡ ${selectedIds.size} ảnh khỏi server. Không hoàn tiền. Không hoàn tác.`}
  tone="danger"
  requireText="XOA"
  confirmLabel="Xoá vĩnh viễn"
  loading={bulkBusy}
  onCancel={() => setConfirm({ type: "idle" })}
  onConfirm={handleBulkHardDeleteSelected}
/>
```

---

## 12. Deploy notes (VPS img-studio)

Tuỳ cách anh đang chạy production:

1. Nếu **Docker Compose** (`/home/ubuntu/img-studio/docker-compose.yml`):
   - Build image mới sau khi code xong
   - `docker compose up -d --build` (hoặc pipeline hiện có)
   - **Không** đụng openclaw-gateway
2. Nếu **local Next standalone** / pm2: rebuild + restart service app img-studio only
3. Health check:
   - `curl -I https://imgstudio.site/login`
   - Login admin smoke QA matrix §10.3

---

## 13. Success criteria

Plan coi là **done** khi:

1. Mobile: primary create flow (prompt visible without scrolling past multi-row header)
2. Settings: API key masked by default
3. Generate: presets + advanced collapse shipped
4. No native `window.prompt` còn lại cho hard delete (Gallery)
5. Video: user-facing model titles (not only raw ids)
6. Desktop layouts không regress (max-w-3xl/6xl, dark theme)
7. QA matrix §10.3 pass với admin + ideally 1 user account

---

## 14. Out-of-scope follow-ups (ghi nợ)

- Encrypt provider API keys in DB
- Gallery admin filters (user/date/provider) + API
- Empty-state CTAs post-generate (“Chỉnh sửa ảnh này”, “Tạo biến thể”)
- Real progress % for long video jobs (cần backend job status)
- Design tokens / component library formalization
- Accessibility audit full (axe)

---

## 15. Suggested commit messages

```
ui: add Modal and ConfirmDialog primitives
ui: mask provider API keys on settings list
ui: compact header account menu; mobile bottom nav
ui: generate presets + advanced options collapse
ui: align edit controls with generate density
ui: video mode cards and friendly model labels
ui: replace native confirm/prompt in gallery and settings
ui: login banner dismiss + admin billing note
```

---

## 16. Reference notes from live review (2026-07-10)

- Domain production: `imgstudio.site`
- Admin test account used for review: `admin@img.tam1012.site` (rotate password if this plan is shared broadly)
- Main UX pain: **information density + mobile chrome**, not visual identity
- Product already solid for paid v1 internals — this plan is polish, not pivot

---

**End of plan.** Implement theo order §9; dừng hỏi owner nếu:

- Cần đổi API PUT provider để support empty api_key keep-old
- Muốn default advanced **mở** trên desktop (product preference)
- Muốn bottom tab icon set cụ thể (text-only vs icon+label)
