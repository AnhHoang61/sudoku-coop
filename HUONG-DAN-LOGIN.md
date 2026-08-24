# Hướng dẫn tự đăng nhập GitHub

Có 2 cách. Cách 1 dễ hơn, thử trước.

---

## Cách 1 — Đăng nhập qua browser (khuyến nghị)

### Bước 1: Mở PowerShell mới

Quan trọng: phải là cửa sổ **mới**, vì `gh` vừa được cài xong, cửa sổ cũ chưa nhận.

Bấm `Win + X` → chọn **Terminal** (hoặc **Windows PowerShell**).

### Bước 2: Kiểm tra gh chạy được

```powershell
gh --version
```

Thấy `gh version 2.98.0` là ổn. Nếu báo "not recognized", dùng đường dẫn đầy đủ ở mọi lệnh bên dưới:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" --version
```

### Bước 3: Đăng nhập

```powershell
cd C:\Users\AnhHoangPC\sudoku-coop
.\login.ps1
```

Hoặc chạy trực tiếp:

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

### Bước 4: Làm theo màn hình

Terminal sẽ hiện:

```
! First copy your one-time code: A1B2-C3D4
Press Enter to open github.com in your browser...
```

1. **Copy mã** `A1B2-C3D4` (mã của bạn sẽ khác).
2. Bấm **Enter** — browser tự mở trang `github.com/login/device`.
3. Nếu browser không tự mở, tự vào: https://github.com/login/device
4. **Dán mã** vào ô, bấm **Continue**.
5. Đăng nhập GitHub (mật khẩu + 2FA nếu có).
6. Bấm nút xanh **Authorize github**.

Quay lại terminal thấy dòng này là xong:

```
✓ Authentication complete.
✓ Logged in as <tên-của-bạn>
```

---

## Cách 2 — Dùng Personal Access Token

Dùng khi Cách 1 lỗi, hoặc browser không mở được.

### Bước 1: Tạo token

Vào: https://github.com/settings/tokens/new

Điền:

| Ô | Giá trị |
|---|---|
| Note | `sudoku-deploy` |
| Expiration | `30 days` |
| Scopes | tick `repo` và `workflow` |

Kéo xuống cuối, bấm **Generate token**.

Token hiện ra dạng `ghp_xxxxxxxxxxxx`. **Copy ngay** — đóng trang là không xem lại được.

### Bước 2: Đưa token cho gh

```powershell
"ghp_dan_token_cua_ban_vao_day" | gh auth login --hostname github.com --git-protocol https --with-token
```

Thay `ghp_dan_token_cua_ban_vao_day` bằng token thật.

### Bước 3: Kiểm tra

```powershell
gh auth status
```

---

## Kiểm tra đã login chưa

```powershell
gh api user --jq .login
```

In ra username của bạn là thành công.

---

## Sau khi login xong

```powershell
cd C:\Users\AnhHoangPC\sudoku-coop
.\deploy.ps1
```

Script tự làm hết: commit, tạo repo, push, bật GitHub Pages, in ra link game.

Muốn game ở địa chỉ gốc `https://<username>.github.io/` thì thêm `-UserSite`:

```powershell
.\deploy.ps1 -UserSite
```

---

## Lỗi thường gặp

**`gh: not recognized`**
Cửa sổ PowerShell cũ chưa nhận PATH mới. Mở cửa sổ mới, hoặc dùng `& "C:\Program Files\GitHub CLI\gh.exe"`.

**`.\login.ps1 cannot be loaded because running scripts is disabled`**
Windows chặn chạy script. Mở khoá cho user hiện tại:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```
Bấm `Y`. Hoặc chạy một lần không cần đổi setting:
```powershell
powershell -ExecutionPolicy Bypass -File .\login.ps1
```

**Mã hết hạn (code expired)**
Mã chỉ sống vài phút. Chạy lại lệnh login để lấy mã mới.

**Bấm Authorize rồi mà terminal vẫn treo**
Bấm `Ctrl + C`, chạy lại. Đôi khi device flow không nhận được callback.

---

## Về bảo mật

- Mật khẩu và mã 2FA chỉ nhập trong **browser**, trên trang github.com. Không nhập vào terminal, không đưa cho tôi.
- Token là chuỗi bí mật, tương đương mật khẩu. Đừng dán vào chat, đừng commit vào repo.
- Token nên đặt hạn 30 ngày thay vì "No expiration".
- Dùng xong muốn thu hồi quyền: https://github.com/settings/applications → tab **Authorized OAuth Apps** → GitHub CLI → Revoke.
- Đăng xuất ở máy: `gh auth logout`
