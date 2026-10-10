# 重新登录脚本：打开浏览器扫码登录后，自动保存登录态
# 增强：
#   1. 浏览器窗口置顶显示（避免被遮挡看不到扫码窗口）
#   2. 通过 BurntToast / 系统通知告知用户
#   3. 写日志到 relogin.log 便于排查
#   4. 可被 update_saishi.js 自动调用（spawnSync 阻塞）
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 9225
$ud = Join-Path $env:TEMP "saishi_login"
$logFile = Join-Path $dir "relogin.log"

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

New-Item -ItemType Directory -Force -Path $ud | Out-Null

# 系统通知（10 秒后自动消失，足够让用户注意到）
try {
  $notify = New-Object -ComObject Wscript.Shell
  $null = $notify.Popup("腾讯文档登录态已失效，请在弹出的浏览器中扫码登录`n（5 分钟内未完成将放弃）", 10, "九州战马·自动导入", 0x40)
} catch {}

Write-Log "启动 Edge 调试模式 + 文档登录页"
$url = "https://docs.qq.com/smartsheet/DQlZpdE1QRFhST0dF"
$msedge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $msedge)) {
  $msedge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
}
Start-Process $msedge -ArgumentList "--remote-debugging-port=$port",("--user-data-dir="+$ud),"--no-first-run",$url -WindowStyle Normal

# 等浏览器起来后再置顶 + 给用户 2 秒反应时间
Start-Sleep -Seconds 6
$proc = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -match "remote-debugging-port=$port" } | Select-Object -First 1
if ($proc) {
  try {
    # 用 WScript.Shell.AppActivate 激活窗口到前台
    $shell = New-Object -ComObject Wscript.Shell
    $null = $shell.AppActivate(([int]$proc.ProcessId))
  } catch {}
}

Write-Log "调用 capture_cookies.js 等待扫码..."
node (Join-Path $dir "capture_cookies.js") $port (Join-Path $dir "cookies.txt") 2>&1 | ForEach-Object { Write-Log ("  capture: " + $_) }
$code = $LASTEXITCODE

# 关闭浏览器
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -match "remote-debugging-port=$port" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if ($code -eq 0) {
  Write-Log "成功！cookies.txt 已更新"
  try { (New-Object -ComObject Wscript.Shell).Popup("登录成功，自动导入将继续", 5, "九州战马·自动导入", 0x40) | Out-Null } catch {}
} else {
  Write-Log "失败！5 分钟内未完成扫码"
  try { (New-Object -ComObject Wscript.Shell).Popup("登录超时，自动导入将退出", 5, "九州战马·自动导入", 0x10) | Out-Null } catch {}
}
