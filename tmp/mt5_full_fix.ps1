# Step 1: Kill MetaTrader 5
Write-Host "Step 1: Closing MetaTrader 5..."
$mt5 = Get-Process -Name terminal64 -ErrorAction SilentlyContinue
if ($mt5) {
    Stop-Process -Name terminal64 -Force
    Write-Host "  MT5 closed. Waiting 3 seconds for config to be written..."
    Start-Sleep -Seconds 3
} else {
    Write-Host "  MT5 is not running."
}

# Step 2: Edit terminal.ini
Write-Host "Step 2: Editing terminal.ini..."
$iniPath = "C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\config\terminal.ini"
$content = Get-Content $iniPath -Encoding Unicode

$newContent = @()
$inExperts = $false
$addedUrl = $false
$addedAllow = $false

foreach ($line in $content) {
    if ($line -match '^\[Experts\]') {
        $inExperts = $true
        $newContent += $line
        continue
    }
    
    # When we hit the next section after [Experts], inject missing keys
    if ($inExperts -and $line -match '^\[') {
        if (-not $addedAllow) { $newContent += "AllowWebRequests=1" }
        if (-not $addedUrl) { $newContent += "WebRequestsURL=http://localhost:3000;http://127.0.0.1:3000" }
        $inExperts = $false
        $newContent += $line
        continue
    }

    if ($inExperts) {
        if ($line -match '^AllowWebRequests=') {
            $newContent += "AllowWebRequests=1"
            $addedAllow = $true
        } elseif ($line -match '^WebRequestsURL=') {
            $newContent += "WebRequestsURL=http://localhost:3000;http://127.0.0.1:3000"
            $addedUrl = $true
        } else {
            $newContent += $line
        }
    } else {
        $newContent += $line
    }
}

# If [Experts] was never found, add it at the end
$hasExperts = $content | Where-Object { $_ -match '^\[Experts\]' }
if (-not $hasExperts) {
    $newContent += ""
    $newContent += "[Experts]"
    $newContent += "AllowWebRequests=1"
    $newContent += "WebRequestsURL=http://localhost:3000;http://127.0.0.1:3000"
}

# If [Experts] was the last section (no next section found)
if ($inExperts) {
    if (-not $addedAllow) { $newContent += "AllowWebRequests=1" }
    if (-not $addedUrl) { $newContent += "WebRequestsURL=http://localhost:3000;http://127.0.0.1:3000" }
}

$newContent | Out-File $iniPath -Encoding Unicode -Force
Write-Host "  Config updated."

# Verify
$check = Get-Content $iniPath -Encoding Unicode | Select-String "WebRequestsURL"
Write-Host "  Verification: $check"

# Step 3: Restart MetaTrader 5
Write-Host "Step 3: Restarting MetaTrader 5..."
Start-Process "C:\Program Files\MetaTrader 5\terminal64.exe"
Write-Host "Done! MT5 should now allow WebRequests to localhost:3000"
