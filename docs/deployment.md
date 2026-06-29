# Hướng dẫn triển khai — IMG Studio

## Thông tin VPS

| Mục | Giá trị |
|---|---|
| IP | 158.178.239.119 |
| User | ubuntu |
| OS | Ubuntu ARM64 |
| SSH Key | `~/.ssh/ssh-key-2026-04-20_tamhvt.key` |
| Project dir | `/home/ubuntu/img-studio` |
| Container | `img-studio` |
| Port | 3456 |
| Domain | img.tam1012.site |
| SSL | Certbot auto-renew |

## SSH vào VPS

```bash
ssh -i "C:\Users\Ha Tam\.ssh\ssh-key-2026-04-20_tamhvt.key" ubuntu@158.178.239.119
```

## Environment Variables

File `.env` tại `/home/ubuntu/img-studio/.env`:

```env
AUTH_PASSWORD=your_password       # Mật khẩu admin (toàn quyền)
GUEST_PASSWORD=your_password      # Mật khẩu khách (giới hạn 50 ảnh/ngày)
SESSION_SECRET=random_string      # Mã hóa cookie (≥32 ký tự)
DATA_DIR=/data                    # Thư mục data (Docker volume)
```

## Deploy tự động (CI/CD)

Push code lên `main` → GitHub Actions tự động:
1. SSH vào VPS
2. `git pull origin main`
3. `docker compose build --no-cache app`
4. `docker compose up -d`

**GitHub Secret cần thiết:** `SSH_PRIVATE_KEY` (đã cấu hình)

## Deploy thủ công

```bash
# SSH vào VPS
cd ~/img-studio
git pull origin main
docker compose build --no-cache app
docker compose up -d
```

## Docker Compose

```bash
# Xem logs
docker logs img-studio --tail 50 -f

# Restart
docker compose restart

# Rebuild từ đầu
docker compose down
docker compose build --no-cache
docker compose up -d

# Xem disk usage
docker system df
```

## Nginx

Config: `/etc/nginx/sites-available/img.tam1012.site`

```bash
# Test config
sudo nginx -t

# Reload
sudo systemctl reload nginx
```

## SSL Certificate

Certbot auto-renew. Kiểm tra:

```bash
sudo certbot certificates
sudo certbot renew --dry-run
```

## Data & Backup

- Volume Docker: `img-studio_img-data`
- Mount point trong container: `/data`
- Chứa: `db.json` (metadata) + `images/` (file ảnh)

Backup:

```bash
# Tìm volume path
docker volume inspect img-studio_img-data

# Hoặc copy từ container
docker cp img-studio:/data ~/img-studio-backup-$(date +%Y%m%d)
```

## Khắc phục sự cố

### App không start
```bash
docker logs img-studio --tail 30
# Kiểm tra .env file
cat ~/img-studio/.env
```

### Port 3456 bị chiếm
```bash
sudo lsof -i :3456
docker ps | grep 3456
```

### SSL hết hạn
```bash
sudo certbot renew
sudo systemctl reload nginx
```

---

*Cập nhật lần cuối: 2026-06-22*
