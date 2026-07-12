# Claude Code instructions — IMG Studio

Đọc theo thứ tự trước khi làm việc:

1. `AGENTS.md`
2. `docs/current-state.md`
3. Tài liệu chuyên đề liên quan trong `docs/`

Giữ local-first workflow, không in secret/token/OAuth identity. Grok Image/Video hiện đi direct xAI qua pool tự đồng bộ; Gemini/GPT Image chưa chuyển direct. Mọi kết luận deploy phải dựa trên test/build và kiểm tra production thật.
