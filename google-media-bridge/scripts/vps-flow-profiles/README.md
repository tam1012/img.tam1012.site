# Flow profiles trên VPS (reauth tại chỗ)

Mỗi account Flow có **1 Chromium user-data-dir** trên VPS. Login tay qua **Guacamole desktop**, reauth bằng 1 lệnh SSH — không cần máy local.

## Thư mục

```text
/home/ubuntu/flow-profiles/
  flow-01-vantam1012/
  flow-02-babyinmyl0v3/
  flow-03-lovanmuon87/
  flow-04-mrvantam/
  flow-05-selenabk/
  tools/          # script open + reauth
```

Map: `tools/flow-profiles.json`

## Cách dùng

### 1) Lần đầu — login qua Guacamole

SSH:

```bash
/home/ubuntu/flow-profiles/tools/open-profile.sh flow-02
# hoặc: open-profile.sh 2
```

Rồi mở **Guacamole desktop VPS**, cửa sổ Chromium sẽ hiện Flow:

1. Login **đúng email** account đó  
2. Vào được `labs.google/fx/tools/flow`  
3. Đóng Chromium  

### 2) Đẩy session vào bridge

```bash
/home/ubuntu/flow-profiles/tools/reauth.sh flow-02
```

Kỳ vọng: `XONG — Dang nhap lai / flow-02 / healthy`

### 3) Kiểm tra

```bash
# từ máy Anh
cd google-flow-enroller && npm run status
# hoặc trên VPS
docker exec google-media-bridge node /tmp/...  # hoặc list-accounts
```

## Ghi chú

- Profile **không** nằm trong Chrome multi-profile mặc định; mỗi folder = 1 user-data-dir (remote debugging được).
- Runtime bridge vẫn dùng storageState trong SQLite; profile VPS chỉ để **enroll/reauth**.
- Nếu reauth báo hết giờ session → login lại bằng `open-profile.sh`.
- Tắt Chromium profile đó trước khi `reauth.sh` (tránh khoá profile).
- Public key: `/home/ubuntu/flow-bridge-secrets/flow-enrollment-public.pem`  
  Apply: `docker exec` + `apply-enrollment.cjs` (admin key chỉ trong container).

## Local dự phòng

Máy Anh vẫn có `google-flow-enroller/mo-profile-lan-dau.bat` + `reauth-tu-profile.bat` nếu VPS login bị Google chặn.
