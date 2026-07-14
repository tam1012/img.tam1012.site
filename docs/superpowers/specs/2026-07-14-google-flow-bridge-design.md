# Google Flow/Whisk Bridge cho IMG Studio

## 1. Mục tiêu

Xây dựng một hệ thống cho phép IMG Studio sử dụng nhiều tài khoản Google AI Pro để tạo ảnh và video qua Google Flow/Whisk, với các yêu cầu:

- Anh chỉ cần đăng nhập tài khoản Google trên máy Windows và bấm một nút để thêm hoặc cập nhật tài khoản.
- Sau khi thêm, hệ thống tiếp tục chạy 24/7 trên VPS ngay cả khi máy Windows đã tắt.
- Mọi request ưu tiên đi theo đường `IMG Studio -> CPA -> Google Media Bridge`.
- Nếu kiểm thử chứng minh một loại request bị CPA làm sai, chỉ loại model đó được chuyển sang đường fallback `IMG Studio -> Google Media Bridge`.
- Không làm thay đổi hoặc gây gián đoạn các model/provider đang hoạt động trong CPA và IMG Studio.
- Credential, cookie, Bearer token và danh tính tài khoản không xuất hiện trong log, database IMG Studio hoặc Git.

## 2. Kết quả khảo sát đã xác minh

### 2.1. OAuth Antigravity không dùng lại được cho Flow

OAuth Flow và OAuth Antigravity đều trả access token họ `ya29`, nhưng khác OAuth client và khác scope:

- Flow cần `https://www.googleapis.com/auth/aisandbox`.
- Antigravity hiện có `cloud-platform`, `cclog`, `experimentsandconfigs` và các scope hồ sơ cơ bản.

Refresh token Antigravity không thể tự nâng thêm scope `aisandbox`, nên pool Antigravity hiện tại không được dùng làm credential Flow.

### 2.2. Cơ chế xác thực Flow

- Trang Flow cấp Bearer mới qua `GET /fx/api/auth/session`.
- Request tạo ảnh/video gửi Bearer tới `aisandbox-pa.googleapis.com`.
- Request tạo media không phụ thuộc trực tiếp vào Cookie header, nhưng session trình duyệt là nguồn để lấy Bearer mới.
- Mỗi request tạo media còn cần reCAPTCHA Enterprise token ngắn hạn trong payload.
- Vì vậy, lưu HAR/cookie rồi replay cố định trên VPS không phải giải pháp 24/7 bền vững.

### 2.3. Luồng ảnh và video đã quan sát

- Ảnh: `flowMedia:batchGenerateImages` trả kết quả đồng bộ, gồm metadata và URL ảnh.
- Video từ văn bản: `video:batchAsyncGenerateVideoText` trả media job; client polling `video:batchCheckAsyncVideoGenerationStatus` cho đến `SCHEDULED -> ACTIVE -> SUCCESSFUL`.
- Job video phải giữ nguyên cùng tài khoản từ lúc tạo đến lúc polling và tải kết quả.
- Payload Flow chứa project ID, session ID, batch/media/workflow ID và reCAPTCHA token; các giá trị này là dữ liệu runtime, không phải cấu hình tĩnh để người dùng nhập tay.

## 3. Phạm vi phiên bản đầu

### 3.1. Chức năng người dùng

Phiên bản đầu hỗ trợ bốn tác vụ:

1. Tạo ảnh từ văn bản.
2. Tạo video từ văn bản.
3. Tạo video từ một ảnh tham chiếu/khung bắt đầu.
4. Tạo video từ ảnh bắt đầu và ảnh kết thúc.

Các tác vụ chỉnh sửa ảnh nâng cao, nhân vật, storyboard, âm thanh và các tính năng Flow khác không nằm trong phiên bản đầu.

### 3.2. Chức năng quản trị tài khoản

Giao diện quản trị phải có:

- Thêm tài khoản Google.
- Cập nhật đăng nhập cho tài khoản đã hết phiên.
- Kiểm tra khả dụng mà không tạo media tính phí nếu có thể.
- Tạm dừng/kích hoạt tài khoản.
- Xóa tài khoản sau bước xác nhận.
- Hiển thị trạng thái ẩn danh: khỏe, đang dùng, cooldown, hết phiên, bị vô hiệu hóa.
- Hiển thị lần kiểm tra gần nhất, lỗi đã làm sạch và số job gần đây; không hiển thị token/cookie.

## 4. Kiến trúc tổng thể

```text
Windows Enrollment Tool
  -> Chrome profile tạm/riêng
  -> anh đăng nhập Google Flow
  -> kiểm tra scope aisandbox và khả năng lấy session
  -> mã hóa enrollment bundle
  -> upload qua HTTPS đến Bridge Admin API

VPS
  CPA v7.2.x
    -> image compatibility adapter
    -> video adapter/plugin nếu kiểm thử đạt
       -> Google Media Bridge
          -> Account Registry
          -> Browser Worker Pool
          -> Credential/Token Broker
          -> Flow Image Adapter
          -> Flow Video Adapter
          -> Job Store
          -> Health/Cooldown Scheduler

IMG Studio
  -> CPA-first provider routes
  -> direct bridge fallback, tắt mặc định
```

Google Media Bridge là ranh giới cô lập phần API web không chính thức, browser session và reCAPTCHA khỏi CPA và IMG Studio. CPA không lưu cookie Google và IMG Studio không biết credential từng tài khoản.

## 5. Thành phần

### 5.1. Windows Enrollment Tool

Tool Windows là ứng dụng cục bộ có giao diện tối giản, không yêu cầu terminal. Luồng sử dụng:

1. Anh bấm `Thêm tài khoản`.
2. Tool mở một cửa sổ Chrome/Chromium riêng tại Flow.
3. Anh tự đăng nhập Google và hoàn thành CAPTCHA/2FA nếu Google yêu cầu.
4. Tool xác minh trang Flow hoạt động, session trả Bearer có scope `aisandbox`, và có thể tạo reCAPTCHA token.
5. Tool đóng gói profile/session tối thiểu, mã hóa bằng public key của bridge rồi upload qua HTTPS.
6. Bridge khởi tạo browser profile riêng trên VPS và chạy kiểm tra sức khỏe.
7. Tool chỉ báo `Đã thêm`, `Cần đăng nhập lại` hoặc lỗi dễ hiểu.

Nút `Cập nhật đăng nhập` dùng cùng quy trình nhưng giữ nguyên account ID, lịch sử và cấu hình cooldown.

Tool không lưu HAR mặc định. Chế độ `Xuất gói chẩn đoán` chỉ dành cho admin, tự xóa Authorization, Cookie, access token, refresh token, email, project ID, reCAPTCHA token và URL có chữ ký trước khi tạo file.

### 5.2. Google Media Bridge

Bridge chạy thành Docker service riêng, bind vào mạng nội bộ của VPS. Chỉ CPA và IMG Studio được phép gọi API media; Admin API yêu cầu khóa quản trị riêng và HTTPS.

Các module:

- `account-registry`: metadata tài khoản ẩn danh và trạng thái vận hành.
- `profile-vault`: lưu browser profile đã mã hóa, quyền file tối thiểu, không nằm trong repo.
- `browser-worker`: Chromium headless/virtual display cho từng tài khoản; duy trì phiên và tạo reCAPTCHA token đúng origin Flow.
- `token-broker`: gọi session endpoint trong browser context, kiểm tra scope và thời hạn Bearer, không trả token ra ngoài bridge.
- `image-adapter`: dựng payload ảnh và chuẩn hóa kết quả sang API nội bộ/OpenAI-compatible.
- `video-adapter`: tạo job, polling, tải file và chuẩn hóa trạng thái video.
- `scheduler`: round-robin có sức khỏe, cooldown và giới hạn concurrency theo tài khoản.
- `job-store`: lưu job state bền vững để bridge restart không làm mất job video đang chạy.
- `redacted-logger`: log account alias, request ID và mã lỗi; cấm log credential/payload nhạy cảm.

### 5.3. CPA adapter

CPA-first được triển khai theo hai lớp để giảm rủi ro:

- Ảnh: đăng ký bridge trong `openai-compatibility` với model riêng. CPA nhận `/v1/images/generations`, chọn provider bridge và chuyển request.
- Video: làm adapter/plugin riêng cho các model Flow vì CPA hiện giới hạn routing video theo model. Adapter chỉ chuyển đổi request/response, không quản lý browser hay credential.

Adapter Flow phải có namespace riêng và feature flag riêng. Không sửa alias hoặc config của provider hiện có. Nếu plugin video không tương thích ổn định với binary CPA hiện tại, video Flow dùng direct bridge fallback; ảnh vẫn tiếp tục qua CPA.

### 5.4. IMG Studio integration

IMG Studio bổ sung các provider/model riêng:

- `flow-nano-banana-2` cho ảnh.
- `flow-veo-fast` hoặc tên model xác minh được từ Flow cho video.

Provider config chỉ chứa base URL nội bộ/CPA và API key dịch vụ, không chứa Google credential. Charge/refund, ownership, storage và request log tiếp tục dùng pipeline hiện tại.

Hai feature flag độc lập:

- `FLOW_IMAGE_ROUTE=cpa|direct|disabled`
- `FLOW_VIDEO_ROUTE=cpa|direct|disabled`

Mặc định production sau canary là `cpa`. Chuyển `direct` chỉ đổi đường mạng cho model Flow, không đổi hành vi billing/storage của IMG Studio.

## 6. Data flow

### 6.1. Tạo ảnh từ văn bản

1. IMG Studio validate request và tạo record theo pipeline hiện tại.
2. IMG Studio gọi CPA bằng model `flow-nano-banana-2`.
3. CPA chuyển request tới bridge.
4. Scheduler chọn account khỏe theo round-robin.
5. Browser worker lấy Bearer hiện hành và reCAPTCHA token mới.
6. Bridge gọi Flow image endpoint.
7. Bridge tải ảnh từ URL kết quả về bộ nhớ tạm và trả binary/base64 theo contract CPA.
8. IMG Studio lưu WebP/thumbnail, hoàn tất record và charge.
9. Nếu lỗi, pipeline hiện tại đánh dấu failed và refund.

### 6.2. Tạo video từ văn bản

1. IMG Studio gửi request video tới CPA.
2. CPA video adapter tạo bridge job.
3. Bridge chọn và khóa account cho job.
4. Worker tạo Bearer/reCAPTCHA mới và gửi request async.
5. Bridge lưu account ID, media ID, project ID và trạng thái job đã mã hóa/ẩn danh phù hợp.
6. Poller dùng đúng account đó cho tới trạng thái terminal.
7. Khi thành công, bridge tải video về storage tạm và trả URL nội bộ hoặc stream cho CPA/IMG Studio.
8. Khi thất bại/timeout, bridge trả lỗi chuẩn hóa để IMG Studio refund.

### 6.3. Video từ ảnh và khung đầu-cuối

Ảnh đầu vào được IMG Studio gửi multipart tới CPA/bridge. Bridge upload/đăng ký media vào Flow bằng cùng account được chọn, sau đó dựng payload:

- Một ảnh: gắn media làm base/start frame.
- Hai ảnh: gắn start frame và end frame theo đúng thứ tự.

Toàn bộ upload, create, poll và download dùng cùng account/job lease. Bridge xóa file tạm sau khi job terminal hoặc hết retention.

## 7. Pool tài khoản và lỗi

### 7.1. Trạng thái tài khoản

- `healthy`: sẵn sàng nhận job.
- `busy`: đạt giới hạn concurrency.
- `cooldown`: lỗi quota/429 tạm thời.
- `reauth_required`: session không còn lấy được Bearer `aisandbox`.
- `blocked`: Google trả lỗi account/policy cần can thiệp thủ công.
- `disabled`: admin chủ động tắt.

### 7.2. Quy tắc routing

- Ảnh: account lỗi trước khi upstream chấp nhận request có thể thử account khác tối đa một lần.
- Video: sau khi upstream tạo media ID, tuyệt đối không chuyển account.
- 401/403 do session: đánh dấu `reauth_required`; không thử lặp vô hạn.
- 429/quota: cooldown account theo backoff có trần và thử account khỏe khác nếu job chưa được chấp nhận.
- reCAPTCHA thất bại: làm mới page/token một lần; lần hai đánh dấu worker degraded và không tiếp tục spam upstream.
- Không còn account khỏe: trả lỗi rõ `FLOW_POOL_UNAVAILABLE` để IMG Studio refund đúng một lần.

## 8. Bảo mật

- Enrollment bundle mã hóa client-side bằng public key; private key chỉ nằm trên VPS.
- Profile vault mã hóa at rest, mount riêng read-write cho bridge; CPA và IMG Studio không được mount thư mục này.
- Bridge API dùng service key riêng, bind private network và giới hạn IP/container caller.
- Admin API tách khỏi media API; thao tác xóa/replace account có audit event không chứa PII.
- Email chỉ dùng trong tool Windows để anh nhận biết trước khi upload; server lưu alias như `flow-01`. Nếu cần hiển thị, chỉ lưu hash/fingerprint hoặc email mask đã được anh chấp thuận.
- Log sanitizer kiểm tra các pattern `ya29`, Cookie, Authorization, reCAPTCHA, signed URL và trường credential trước khi ghi.
- Backup không chứa profile vault ở dạng plaintext.
- Không commit HAR, cookie, browser profile, enrollment bundle, API key hoặc file auth.
- Credential local hiện có dạng rõ trong các helper cũ phải được đưa vào một đợt thu hồi/đổi khóa riêng; không tái sử dụng chúng cho bridge.

## 9. API contract nội bộ

Bridge cung cấp contract ổn định, không để IMG Studio biết payload Flow:

```text
GET    /health
GET    /v1/models
POST   /v1/images/generations
POST   /v1/videos/generations
POST   /v1/videos/edits
GET    /v1/videos/{jobId}
GET    /v1/videos/{jobId}/content

POST   /admin/v1/enrollments
POST   /admin/v1/accounts/{id}/verify
POST   /admin/v1/accounts/{id}/disable
POST   /admin/v1/accounts/{id}/enable
DELETE /admin/v1/accounts/{id}
```

Endpoint video có thể được ánh xạ sang path CPA yêu cầu, nhưng bridge giữ contract trên để fallback trực tiếp không cần đổi core logic.

## 10. Quan sát vận hành

Dashboard tối thiểu hiển thị:

- Số account theo trạng thái.
- Job đang chạy, thành công, lỗi theo ảnh/video.
- Latency create/poll/download.
- Tỷ lệ 401/403, 429/quota và reCAPTCHA failure.
- Account alias đang giữ từng video job.
- Route thực tế của từng model: CPA, direct hoặc disabled.

Không hiển thị credential, raw upstream body hoặc signed media URL.

## 11. Kiểm thử

### 11.1. Automated tests

- Parser/normalizer cho payload và response Flow đã làm sạch.
- Account state machine và round-robin/cooldown.
- Video lease giữ đúng account qua create/poll/download.
- Retry chỉ xảy ra trước khi upstream chấp nhận job.
- Log redaction không lọt token/cookie/PII.
- Feature flag route CPA/direct/disabled.
- CPA adapter contract cho ảnh và video.
- IMG Studio charge/refund/idempotency không đổi.

### 11.2. Integration tests

- Browser worker lấy session Bearer có scope `aisandbox`.
- Tạo reCAPTCHA token và gọi một request ảnh thật.
- Tạo video text-to-video thật và poll đến thành công.
- Tạo video từ một ảnh.
- Tạo video từ start/end frame.
- Làm hỏng một account có chủ đích để xác minh chuyển pool và reauth state.
- Restart bridge giữa video job để xác minh resume polling.

### 11.3. Regression tests

- Các model ảnh/video hiện tại qua CPA vẫn smoke test thành công.
- Prompt Refine, xAI direct pool và Vertex video không đổi route.
- CPA restart với adapter Flow bật/tắt đều không làm mất provider cũ.
- IMG Studio build/test và production smoke theo luồng admin-only trước khi mở cho user.

## 12. Rollout và rollback

1. Xây bridge và enrollment tool local; chưa nối CPA/IMG Studio.
2. Enroll một tài khoản test, chạy bridge smoke trực tiếp.
3. Thêm image upstream vào CPA với model namespace riêng; test CPA ảnh.
4. Thử CPA video adapter trên route/model riêng; không sửa Grok/Vertex.
5. Nếu CPA video đạt contract và soak test, bật `FLOW_VIDEO_ROUTE=cpa`; nếu không, dùng `direct`.
6. Thêm provider Flow vào IMG Studio nhưng chỉ admin nhìn thấy.
7. Chạy image, text-video, image-video, start/end-video và kiểm tra charge/refund/storage.
8. Soak test tối thiểu qua nhiều lần refresh token, reCAPTCHA token và restart service.
9. Mở dần cho user.

Rollback không xóa dữ liệu:

- Đặt route model Flow thành `disabled` hoặc `direct`.
- Gỡ/disable adapter Flow trong CPA mà không đổi provider hiện tại.
- Giữ bridge/job store để hoàn tất hoặc đối soát job đã nhận.

## 13. Tiêu chí hoàn thành

- Anh thêm/cập nhật một tài khoản bằng giao diện Windows, không dùng terminal và không tự xử lý HAR.
- Sau khi máy Windows tắt, bridge trên VPS vẫn tạo được Bearer/reCAPTCHA mới và chạy 24/7.
- Pool xoay vòng nhiều tài khoản; lỗi một tài khoản không làm hỏng toàn bộ service.
- Ảnh, video từ văn bản, video từ một ảnh và video start/end chạy thành công end-to-end.
- Mọi request ưu tiên đi qua CPA; route direct chỉ dùng khi test chứng minh CPA không tương thích.
- Provider hiện tại không bị đổi route hoặc regression.
- Không có token, cookie, email đầy đủ, HAR hoặc signed URL trong repo/log/database IMG Studio.
- Feature flag cho phép tắt Flow ngay mà không rollback CPA/IMG Studio.

## 14. Rủi ro và giới hạn

- Flow/Whisk là API web nội bộ, có thể đổi endpoint/payload mà không báo trước.
- Google có thể yêu cầu đăng nhập lại, CAPTCHA hoặc chặn session khi chuyển thiết bị/IP.
- Browser worker trên VPS có chi phí RAM/CPU và cần giới hạn số browser hoạt động đồng thời.
- Việc tự động hóa phải tuân thủ điều khoản Google và quota từng tài khoản; bridge không được thiết kế để né giới hạn, CAPTCHA hoặc policy.
- Nếu session không chuyển được từ Windows sang VPS ổn định, enrollment v2 phải dùng remote browser profile trên VPS để anh đăng nhập trực tiếp qua một phiên điều khiển an toàn, thay vì cố replay cookie.
