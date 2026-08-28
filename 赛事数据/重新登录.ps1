# 重新登录脚本：打开浏览器扫码登录后，自动保存登录态
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 9225
$ud = Join-Path $env:TEMP "saishi_login"
New-Item -ItemType Directory -Force -Path $ud | Out-Null
Write-Host "正在打开浏览器... 请点击「微信登录」并用手机扫码"
Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList "--remote-debugging-port=$port",("--user-data-dir="+$ud),"--no-first-run","https://docs.qq.com/smartsheet/DQlZpdE1QRFhST0dF" -WindowStyle Normal
Start-Sleep -Seconds 4
node (Join-Path $dir "capture_cookies.js") $port (Join-Path $dir "cookies.txt")
$code = $LASTEXITCODE
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -match "remote-debugging-port=$port" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if($code -eq 0){ Write-Host "完成！现在可以运行: node update_saishi.js" } else { Write-Host "登录未完成，请重试" }
