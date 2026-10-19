# Expo 公式の --tunnel は Expo 共有 ngrok アカウントが同時セッション上限
# (ERR_NGROK_108) に張り付いていて使えないため、cloudflared のクイックトンネルで代替する。
# EXPO_PACKAGER_PROXY_URL は .env ではなく pre-dotenv の環境変数から読まれるので、
# ここでプロセス環境変数として渡す必要がある。

$ErrorActionPreference = 'Stop'

$exe = Join-Path $env:LOCALAPPDATA 'cloudflared\cloudflared.exe'
if (-not (Test-Path $exe)) {
    $dir = Split-Path $exe -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    Write-Host 'cloudflared をダウンロードしています...'
    Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $exe -UseBasicParsing
}

$log = Join-Path $env:TEMP "expo-cloudflared-$PID.log"
$proc = Start-Process -FilePath $exe `
    -ArgumentList 'tunnel', '--url', 'http://localhost:8081', '--no-autoupdate' `
    -RedirectStandardError $log -RedirectStandardOutput "$log.out" `
    -WindowStyle Hidden -PassThru

try {
    $url = $null
    foreach ($i in 1..30) {
        Start-Sleep -Seconds 2
        if (Test-Path $log) {
            $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
            if ($m) { $url = $m.Matches[0].Value; break }
        }
    }
    if (-not $url) { throw "トンネル URL を取得できませんでした。ログ: $log" }

    Write-Host ''
    Write-Host "Tunnel: $url" -ForegroundColor Green
    Write-Host ''

    $env:EXPO_PACKAGER_PROXY_URL = $url
    npx expo start @args
}
finally {
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    Remove-Item $log, "$log.out" -ErrorAction SilentlyContinue
}
