# Ghi chú kiểm duyệt nội dung — prompt bị nhà cung cấp từ chối

> Tổng hợp ngày 2026-07-13 từ 94 request bị reject vì vi phạm chính sách nội dung của nhà cung cấp model gốc (GPT Image / OpenAI, Grok / xAI). Dữ liệu thô: `docs/rejected-prompts-20260713.csv`.
>
> Mục đích: tài liệu tham khảo để (1) hiểu vì sao request thất bại, (2) sau này nạp vào system prompt của Prompt Refine để làm dịu wording thay vì chặn cứng từ khóa.
>
> Liên quan: hướng dẫn tạo bộ ảnh nhất quán `docs/guides/creating-consistent-images.md`; mục lục `docs/README.md`.


## Nguyên tắc quan trọng nhất

Bộ kiểm duyệt của GPT Image và Grok bắt theo **ngữ nghĩa tổng thể của prompt**, KHÔNG phải dò từ khóa. Vì vậy:

- Đổi ngôn ngữ (Việt → Anh → Nga) để né **không có tác dụng** — model hiểu ý, không hiểu chữ.
- Blocklist từ khóa cứng vừa **sót** (đổi cách diễn đạt là lọt) vừa **chặn oan** (bìa truyện kinh dị, ảnh thời trang có đồ bơi).
- Cùng một từ có thể qua hoặc bị chặn tùy **ngữ cảnh xung quanh** và tùy **model** (xem mục "Độ khắt khe theo model").

## Độ khắt khe theo model

- **GPT Image (gpt-image-2) — khắt khe nhất.** Trả `safety_violations=[sexual]` / `[violence]`. Chặn cả những thứ tương đối nhẹ (mang thai + đồ bơi).
- **Grok (grok-imagine-image-quality) — khắt khe, chặn ở khâu tạo ảnh** (`Generated image rejected by content moderation`).
- Một số model khác "dễ chịu" hơn: cùng ý đồ bơi/khoe dáng mức nhẹ có thể qua nếu ngữ cảnh trung tính.

→ Hệ quả: **một từ bị chặn ở model này chưa chắc bị chặn ở model khác.** Cần phân biệt "từ luôn nguy hiểm" với "từ chỉ nguy hiểm khi ngữ cảnh gợi dục".

## Phân loại từ/ý theo mức rủi ro

### Mức 1 — Lộ liễu, gần như luôn bị chặn ở mọi model

Nhóm khỏa thân trực tiếp:
- Tiếng Việt: "khỏa thân", "bán khỏa thân", "không mặc đồ", "không mặc quần áo", "lộ ngực trần", "ngực trần", "vén áo lộ cơ thể bên dưới không mặc gì".
- Tiếng Anh: `naked`, `nude`, `topless`, `no bra`, `bottomless`, `no bottom`, `see-through shirt`, `no shirt`.

Nhóm hành vi/tư thế tình dục rõ:
- "tư thế gợi tình", "dang rộng chân chữ M", "dâm".
- `sex`, `make sex`, `ahegao`, `missionary pose`, `doggy style`, `dildo`, `erotic`, `expressions of pleasure`, `Jav dvd cover`, `shaved / clean shaved` (trong ngữ cảnh cơ thể), `open her leg`.

Nhóm trẻ vị thành niên (nguy hiểm nhất về pháp lý — tránh tuyệt đối khi gắn nội dung khoe thân/gợi dục):
- "teen", "gái ngoan", `good girl`, `18 years old` khi đi kèm nội dung khoe thân/gợi dục.

### Mức 2 — "Xám", tùy ngữ cảnh và tùy model

Đây là nhóm cần chú ý nhất: **bản thân từ không tục, nhưng dễ dính nếu đặt cạnh yếu tố khoe thân.**
- `bikini`, `micro bikini`, `sling/slingshot bikini`, `wet bikini`, `thong`, `swimwear`, "trang phục bơi", "đồ tắm hai mảnh".
- "quyến rũ", `seducingly`, `sexy`, `big breasts / big natural breasts`, "ngực cup B".
- Yếu tố khuếch đại rủi ro khi ghép vào: `wet`, `micro`, `squat`, `low camera shot up`, `pregnant` + đồ bơi, nhấn mạnh vào bộ phận cơ thể.

**Ví dụ QUA được** (dù có `bikini briefs` + `beachwear`): ảnh chụp một phụ nữ cầm máy ảnh film, biểu cảm tập trung nghiêm túc, ánh sáng tài liệu tự nhiên, nhấn vào chất liệu gỗ/vải/vườn cây — không tư thế gợi dục, không nhấn cơ thể, không gán tuổi. → **Cùng từ "bikini" nhưng ngữ cảnh trung tính thì an toàn.**

**Ví dụ BỊ CHẶN**: `"She's pregnant. She's wearing a bikini."` — rất ngắn, không có gì tục, nhưng tổ hợp mang thai + đồ bơi khiến GPT Image đánh cờ `sexual`.

### Mức 3 — Bạo lực / ghê rợn (ít, thường không cố ý)

- `gouged-out eyes held in bloody hands`, `bloodied face`, `disfigured`, `frenzied madness` → `safety_violations=[violence]`.
- Thường là bìa truyện kinh dị hợp lệ, không phải nội dung bậy. Blocklist cứng sẽ chặn oan nhóm này.

## Hướng xử lý Prompt Refine (đã nạp vào system prompt 2026-07-20)

Không dùng blocklist từ khóa. Refine (`src/lib/prompt-refine.ts` → `buildPromptRefineMessages`) dạy model:
1. Nhận diện **ý đồ** khoe thân / gợi dục / gán tuổi vị thành niên trong prompt gốc.
2. Với ý gợi dục rõ (Mức 1 / SEVERE): bỏ token lộ liễu, viết lại bản an toàn **gần subject/setting/mood**, không invent portrait lạ.
3. Với nhóm xám (Mức 2 / GREY ZONE): giữ chủ thể, neo ngữ cảnh thời trang/chân dung **cùng ngôn ngữ user**, bỏ amplifier (`wet`, `micro`, tư thế, low-angle body).
4. RISKY COMBOS: pregnant + bikini/swimwear → outfit maternity/an toàn; age cue + body focus → bỏ framing tuổi + sexualization.
5. Không over-sanitize fashion/portrait/horror-nghệ thuật/bìa truyện trừ gore sốc thuần.
6. Edit mode: chỉ sanitize phần bẩn, vẫn preserve phần không đổi.
