# Flow Chrome profiles (máy local Anh)

Mỗi account Google Flow có **1 User Data Chrome riêng** — không dùng multi-profile trong
`...\Google\Chrome\User Data` mặc định (Chrome cấm remote-debugging ở đó; copy profile cũng mất login).

## Thư mục

Mặc định: `D:\flow-profiles\`

| Folder | Email | Alias bridge |
|---|---|---|
| `flow-01-vantam1012` | vantam1012@gmail.com | flow-01 |
| `flow-02-babyinmyl0v3` | babyinmyl0v3@gmail.com | flow-02 |
| `flow-03-lovanmuon87` | lovanmuon87@gmail.com | flow-03 |
| `flow-04-mrvantam` | mrvantam@gmail.com | flow-04 |
| `flow-05-selenabk` | selenabk@gmail.com | flow-05 |

Map JSON: `google-flow-enroller/flow-profiles.json`

## Cách dùng

### 1) Lần đầu — login tay một lần mỗi account

1. Chạy `mo-profile-lan-dau.bat`
2. Chọn 1–5
3. Chrome mở folder riêng → **đăng nhập đúng email** → vào Flow cho chắc
4. Đóng Chrome

### 2) Khi VPS báo reauth

1. Chạy `reauth-tu-profile.bat`
2. Chọn đúng số account
3. **Tắt hết Chrome** đang mở folder đó (tránh khoá profile)
4. Script bắt session + đẩy VPS (dedup theo email = reauth, không tạo account mới)
5. Chạy `xem-tai-khoan.bat` kiểm tra `healthy`

### 3) Lệnh tay (nếu cần)

```bat
cd google-flow-enroller
npm run reauth:profile -- --alias flow-02
```

## Lưu ý

- **Không** copy cookie từ Chrome multi-profile mặc định — đã thử fail.
- Session hết hạn trên profile local → mở `mo-profile-lan-dau.bat` login lại 1 lần, rồi reauth.
- Folder `D:\flow-profiles\` nằm trên máy Anh, **không** commit lên git.
- Vẫn có `them-tai-khoan.bat` (Chrome trắng + login tay) nếu profile riêng hỏng.
