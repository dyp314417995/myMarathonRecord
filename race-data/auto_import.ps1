# ============================================================
# 赛事数据自动更新 + 上传脚本
# 用法:
#   powershell -File race-data\auto_import.ps1          # 增量拉取（表格没变就退出）
#   powershell -File race-data\auto_import.ps1 -Force    # 强制全量拉取
#   powershell -File race-data\auto_import.ps1 -Invoke   # 上传后触发云函数导入
# 前置: .codex\tcb-credentials.ps1 已配置腾讯云 API 密钥，云存储 races_import.json 已存在
# ============================================================
param(
  [switch]$Force,     # 强制全量拉取（忽略 rev 判断）
  [switch]$Invoke     # 上传后触发 importRaceSheet 云函数导入
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Node = 'D:\software\node\node.exe'
$TcbCli = 'D:\software\node-v14.21.0-win-x64\node_global\node_modules\@cloudbase\cli\bin\tcb'
$EnvId = 'cloud1-d5gy0iuiba5f9300f'
$JsonPath = Join-Path $PSScriptRoot 'races_import.json'
$CloudFileID = 'cloud://cloud1-d5gy0iuiba5f9300f.636c-cloud1-d5gy0iuiba5f9300f-1430408608/races_import.json'

# 长期方案：用腾讯云 API 密钥免登录（不随 2 小时登录态过期）
$SecretFile = Join-Path $ProjectRoot '.codex\tcb-credentials.ps1'
if (-not (Test-Path $SecretFile)) {
  Write-Host "缺少密钥文件: $SecretFile" -ForegroundColor Red
  Write-Host "请在 .codex\tcb-credentials.ps1 中配置 TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY" -ForegroundColor Yellow
  exit 1
}
. $SecretFile

# 自愈（v2.7 关键修复）：清理本项目过期的 CLI 临时登录态缓存
# 背景：CLI 在 %USERPROFILE%\.config\.cloudbase\projects\<项目>\auth.json 缓存临时密钥，
#   该文件优先于 API 密钥（环境变量 + 全局 auth.json），其 accessTokenExpired 过期后
#   CLI 刷新失败并报"无有效身份信息"，导致 10 点定时任务上传环节挂掉。
#   每次运行前检测并删除已过期的缓存，CLI 自动回落到全局长期密钥。
$projAuthDir = Join-Path $env:USERPROFILE '.config\.cloudbase\projects'
if (Test-Path $projAuthDir) {
  Get-ChildItem $projAuthDir -Recurse -Filter 'auth.json' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $cred = (Get-Content $_.FullName -Raw | ConvertFrom-Json).credential
      if ($cred.accessTokenExpired -and ([long]$cred.accessTokenExpired) -lt [DateTimeOffset]::Now.ToUnixTimeMilliseconds()) {
        Remove-Item $_.FullName -Force
        Write-Host ("已清理过期 CLI 登录态缓存: " + $_.FullName) -ForegroundColor Yellow
      }
    } catch {}
  }
}

Set-Location $ProjectRoot

Write-Host '=== [1/3] 拉取腾讯文档 ===' -ForegroundColor Cyan
if ($Force) {
  & $Node (Join-Path $PSScriptRoot 'update_saishi.js') --force
} else {
  & $Node (Join-Path $PSScriptRoot 'update_saishi.js')
}
if ($LASTEXITCODE -ne 0) { Write-Host '拉取失败' -ForegroundColor Red; exit 1 }

Write-Host '=== [2/3] 转换生成 JSON ===' -ForegroundColor Cyan
& $Node (Join-Path $PSScriptRoot 'csv-to-races.js')
if ($LASTEXITCODE -ne 0) { Write-Host '转换失败' -ForegroundColor Red; exit 1 }
if (-not (Test-Path $JsonPath)) { Write-Host 'races_import.json 不存在' -ForegroundColor Red; exit 1 }

Write-Host '=== [3/3] 上传到云存储 ===' -ForegroundColor Cyan
& $Node $TcbCli storage upload $JsonPath 'races_import.json' -e $EnvId --times 3
if ($LASTEXITCODE -ne 0) { Write-Host '上传失败' -ForegroundColor Red; exit 1 }
Write-Host ("已上传: " + $CloudFileID) -ForegroundColor Green

if ($Invoke) {
  Write-Host '=== 触发云函数导入 ===' -ForegroundColor Cyan
  $param = '{\"storageFileID\":\"' + $CloudFileID + '\"}'
  & $Node $TcbCli fn invoke importRaceSheet -e $EnvId --params $param --json
}

Write-Host '=== 完成 ===' -ForegroundColor Green

