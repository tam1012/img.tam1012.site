# Điều khoản dịch vụ — IMG Studio

**Trang công khai:** https://imgstudio.site/terms  
**Source UI:** `src/app/terms/page.tsx`  
**Cập nhật lần cuối (nội dung):** 19/07/2026

## Tinh thần

- Nền tảng **trung gian** (aggregator), không sở hữu/vận hành model.
- **Không** áp dụng bộ lọc nội dung sáng tạo riêng; filter = Provider.
- User **tự chịu** trách nhiệm pháp lý về Input/Output.
- Charge-on-success; hoàn **Credit vào ví** khi lỗi kỹ thuật/provider fail.
- Nạp tiền: mặc định **không rút / không hoàn tiền mặt**.
- Cấm: gian lận, multi-account farm, abuse hạ tầng, share API key — không phải blacklist nội dung.

## Chỉnh so với bản nháp Anh gửi

- Provider: không liệt kê brand cứng; “danh sách model trên giao diện”.
- Khóa account: khi lặp lại / quy mô lớn gây hại Provider hoặc hạ tầng — không vì 1 lần dính filter.
- Xóa dữ liệu: không cam kết restore; có thể còn bản sao kỹ thuật tạm — không viết “không có backup tuyệt đối”.
- Cap bồi thường: request liên quan **hoặc** nạp 30 ngày gần nhất, tối đa **1.000.000đ**.
- Nạp không hoàn tiền bank (trừ lỗi thu phí / luật bắt buộc).

## Liên kết UI

- Footer app (`SiteFooter`) + footer Landing + trang `/terms` tự có footer.
- Middleware: `/terms` là public (không cần đăng nhập).

## Việc treo (không làm trong PR này)

- Checkbox “đồng ý Điều khoản” lúc đăng ký.
- Trang Privacy Policy riêng.
- Email `support@imgstudio.site` cần trỏ inbox thật.
