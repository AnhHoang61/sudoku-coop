# Deploy Sudoku Co-op len GitHub Pages.
# Chay SAU khi da `gh auth login`.
#   .\deploy.ps1                     -> repo ten sudoku-coop
#   .\deploy.ps1 -RepoName my-game   -> doi ten repo
#   .\deploy.ps1 -UserSite           -> deploy vao <user>.github.io (URL goc, khong co /sudoku-coop)

param(
  [string]$RepoName = 'sudoku-coop',
  [switch]$UserSite
)

# 'Continue' chu khong 'Stop': PowerShell 5.1 boc stderr cua native exe (gh, git)
# thanh ErrorRecord, voi 'Stop' thi moi canh bao vo hai cung lam script chet.
$ErrorActionPreference = 'Continue'
$gh  = 'C:\Program Files\GitHub CLI\gh.exe'
$git = 'D:\git\cmd\git.exe'
$env:PATH = "$env:PATH;D:\git\cmd;C:\Program Files\GitHub CLI"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Die($msg)  { Write-Host "`nLOI: $msg" -ForegroundColor Red; exit 1 }

Set-Location $PSScriptRoot

# --- 1. Kiem tra da login chua ---
Step 'Kiem tra dang nhap GitHub'
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Die "Chua dang nhap. Chay truoc:  gh auth login`n     Chon: GitHub.com -> HTTPS -> Y -> Login with a web browser"
}
$user = (gh api user --jq .login)
if ([string]::IsNullOrWhiteSpace($user)) { Die 'Khong doc duoc username.' }
Ok "Da login: $user"

if ($UserSite) { $RepoName = "$user.github.io" }

# --- 2. Git identity (lay tu tai khoan GitHub neu chua co) ---
Step 'Kiem tra git identity'
$name  = (git config --global user.name)
$email = (git config --global user.email)
if ([string]::IsNullOrWhiteSpace($name)) {
  $ghName = (gh api user --jq '.name // .login')
  git config --global user.name $ghName
  $name = $ghName
}
if ([string]::IsNullOrWhiteSpace($email)) {
  # noreply email cua GitHub: khong lo lot email that ra commit log
  $id = (gh api user --jq .id)
  $email = "$id+$user@users.noreply.github.com"
  git config --global user.email $email
}
Ok "$name <$email>"

# --- 3. Commit ---
Step 'Tao commit'
if (-not (Test-Path .git)) { git init -q }
git add -A
git symbolic-ref HEAD refs/heads/main 2>$null | Out-Null
$staged = (git diff --cached --name-only)
if ([string]::IsNullOrWhiteSpace($staged)) {
  Ok 'Khong co thay doi moi, dung commit cu.'
} else {
  git commit -q -m "Sudoku Co-op: choi cung nhau qua P2P"
  Ok "Da commit $(($staged -split "`n").Count) file"
}

# --- 4. Tao repo tren GitHub (neu chua co) ---
Step "Kiem tra repo $user/$RepoName"
gh repo view "$user/$RepoName" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Ok 'Repo da ton tai, dung lai.'
  $remotes = (git remote)
  if ($remotes -notcontains 'origin') {
    git remote add origin "https://github.com/$user/$RepoName.git"
  } else {
    git remote set-url origin "https://github.com/$user/$RepoName.git"
  }
} else {
  Write-Host '    Repo chua co, dang tao (PUBLIC - can thiet de GitHub Pages hoat dong o goi free)...'
  gh repo create $RepoName --public --source . --remote origin --description "Choi Sudoku cung nhau giua PC va tablet, ket noi P2P"
  if ($LASTEXITCODE -ne 0) { Die 'Tao repo that bai.' }
  Ok 'Da tao repo public.'
}

# --- 5. Push ---
Step 'Push len GitHub'
git push -u origin main
if ($LASTEXITCODE -ne 0) { Die 'Push that bai. Xem thong bao loi phia tren.' }
Ok 'Push xong.'

# --- 6. Bat GitHub Pages ---
Step 'Bat GitHub Pages'
# Kiem tra Pages da bat chua bang cach DOC lai, khong tin exit code cua POST.
# Bug cu: POST that bai nhung script van in "Pages da bat".
& $gh api "repos/$user/$RepoName/pages" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  & $gh api "repos/$user/$RepoName/pages" -X POST -H 'Accept: application/vnd.github+json' `
      -f 'source[branch]=main' -f 'source[path]=/' 2>$null | Out-Null
  Start-Sleep -Seconds 3
}
$pagesUrl = (& $gh api "repos/$user/$RepoName/pages" --jq .html_url 2>$null)
if ([string]::IsNullOrWhiteSpace($pagesUrl) -or $pagesUrl -like '*Not Found*') {
  $pagesUrl = if ($UserSite) { "https://$user.github.io/" } else { "https://$user.github.io/$RepoName/" }
  Write-Host '    Chua doc duoc trang thai Pages qua API.' -ForegroundColor Yellow
  Write-Host "    Vao https://github.com/$user/$RepoName/settings/pages de bat tay neu can." -ForegroundColor Yellow
} else {
  Ok "Pages da bat."
}

Write-Host "`n============================================" -ForegroundColor Green
Write-Host " XONG. Trang cua ban:" -ForegroundColor Green
Write-Host " $pagesUrl" -ForegroundColor White
Write-Host "============================================" -ForegroundColor Green
Write-Host "`nLan build dau mat khoang 1-2 phut. Neu vao thay 404 thi cho chut roi tai lai."
Write-Host "Mo tren PC -> Tao phong -> Copy link -> mo link do tren may tinh bang.`n"
