# Dang nhap GitHub. Chay: .\login.ps1
# Dung duong dan day du nen khong phu thuoc PATH cua shell hien tai.

$ErrorActionPreference = 'Continue'
$gh  = 'C:\Program Files\GitHub CLI\gh.exe'
$git = 'D:\git\cmd\git.exe'

if (-not (Test-Path $gh))  { Write-Host "Khong thay gh.exe tai $gh"  -ForegroundColor Red; exit 1 }
if (-not (Test-Path $git)) { Write-Host "Khong thay git.exe tai $git" -ForegroundColor Red; exit 1 }

# Da login roi thi thoat luon
& $gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  $u = (& $gh api user --jq .login)
  Write-Host "`nDa dang nhap san voi tai khoan: $u" -ForegroundColor Green
  Write-Host "Chay tiep:  .\deploy.ps1`n"
  exit 0
}

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host " DANG NHAP GITHUB" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " Script se in ra mot MA 8 KY TU (dang XXXX-XXXX)."
Write-Host " 1. Copy ma do."
Write-Host " 2. Browser tu mo trang github.com/login/device"
Write-Host "    (neu khong tu mo, tu vao dia chi do)."
Write-Host " 3. Dan ma vao, bam Continue roi Authorize."
Write-Host ""
Write-Host " Dang nhap bang tai khoan GitHub cua BAN." -ForegroundColor Yellow
Write-Host " Nhap mat khau + 2FA trong browser, khong nhap vao day." -ForegroundColor Yellow
Write-Host ""

& $gh auth login --hostname github.com --git-protocol https --web

if ($LASTEXITCODE -ne 0) {
  Write-Host "`nDang nhap chua xong. Thu lai, hoac dung cach token trong HUONG-DAN-LOGIN.md" -ForegroundColor Red
  exit 1
}

# Cho git dung chung credential voi gh
& $gh auth setup-git 2>$null | Out-Null

$user = (& $gh api user --jq .login)
Write-Host "`n===============================================" -ForegroundColor Green
Write-Host " XONG. Da dang nhap: $user" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host "`nBuoc tiep theo:  .\deploy.ps1"
Write-Host "Muon game o https://$user.github.io/ thi chay:  .\deploy.ps1 -UserSite`n"
