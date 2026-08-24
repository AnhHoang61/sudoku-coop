# Sudoku Co-op

Chơi Sudoku cùng nhau giữa PC và máy tính bảng. Hai máy điền chung một bảng, thấy nhau chọn ô và điền số ngay lập tức.

Không cần backend: hai thiết bị nối trực tiếp qua WebRTC (PeerJS), nên host tĩnh trên GitHub Pages là đủ.

## Cách chơi

1. Máy thứ nhất mở trang, bấm **Tạo phòng mới**, được mã 6 ký tự.
2. Máy thứ hai nhập mã đó ở tab **Vào phòng** — hoặc mở link có `#MÃ` là vào luôn.
3. Xong. Bảng, ghi chú và đồng hồ tự đồng bộ.

Số bạn điền màu xanh, số của người kia màu cam. Ô người kia đang chọn có viền cam nét đứt.

Bàn phím: `1`-`9` điền số, `⌫` xoá, `N` bật/tắt ghi chú, mũi tên di chuyển.

## Deploy lên GitHub Pages

Repo phải **public** nếu bạn dùng GitHub free.

### Cách A — dùng git (cần cài Git trước)

```bash
cd sudoku-coop
git init
git add .
git commit -m "Sudoku co-op"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

Rồi vào repo → Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/ (root)` → Save. Khoảng 1 phút sau trang chạy ở `https://<user>.github.io/<repo>/`.

### Cách B — upload qua web, không cần cài gì

1. Tạo repo mới trên github.com (để Public).
2. Bấm **uploading an existing file**, kéo thả cả thư mục `sudoku-coop` (giữ nguyên cấu trúc `css/`, `js/`).
3. Commit, rồi bật Pages như bước cuối ở Cách A.

## Chạy thử ở máy

```bash
node server.js
```

Mở `http://localhost:8080`. Muốn test từ máy tính bảng trong cùng WiFi thì dùng IP LAN của PC.

Lưu ý: WebRTC cần HTTPS khi chạy trên domain thật. GitHub Pages có HTTPS sẵn nên không phải làm gì. `localhost` được miễn trừ nên test ở máy vẫn ổn.

## Cấu trúc

```
index.html        khung trang + lobby
css/style.css     giao diện, responsive cho tablet
js/sudoku.js      sinh đề theo seed, giải, kiểm tra luật
js/net.js         kết nối P2P qua PeerJS
js/app.js         trạng thái ván, render bảng, nhập số
js/wire.js        nối UI với mạng
test-engine.js    test engine: node test-engine.js
server.js         static server để chạy thử ở máy
```

Đề Sudoku sinh từ một `seed` số nguyên. Hai máy chỉ cần đồng bộ seed là ra cùng bảng, không phải truyền cả 81 ô.

## Giới hạn

- Cả hai máy phải online cùng lúc. Đóng tab là mất ván.
- Một số mạng công ty hoặc 4G chặt có thể chặn P2P; lúc đó cần TURN server (chưa cấu hình).
- Signaling dùng server công khai miễn phí của PeerJS, đôi khi chậm vào giờ cao điểm.
