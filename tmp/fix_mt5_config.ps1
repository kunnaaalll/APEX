$terminalIniPath = "C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\config\terminal.ini"
$urlsToAdd = @("http://localhost:3000", "http://127.0.0.1:3000")

# 1. Kill MT5 if running
Write-Host "Checking for running MT5 processes..."
$mt5Processes = Get-Process -Name terminal64 -ErrorAction SilentlyContinue
if ($mt5Processes) {
    Write-Host "Closing MetaTrader 5..."
    Stop-Process -Name terminal64 -Force
    # Wait a bit for files to be released
    Start-Sleep -Seconds 2
} else {
    Write-Host "MetaTrader 5 is not running."
}

# 2. Check if file exists
if (-not (Test-Path $terminalIniPath)) {
    Write-Host "Error: terminal.ini not found at $terminalIniPath"
    exit 1
}

# 3. Read content with Unicode encoding (UTF-16LE)
$content = Get-Content $terminalIniPath -Encoding Unicode

$newContent = @()
$foundExperts = $false
$foundWebRequestUrl = $false
$foundAllowWebRequest = $false

foreach ($line in $content) {
    if ($line -match '^\[Experts\]') {
        $foundExperts = $true
        $newContent += $line
        continue
    }
    
    if ($foundExperts -and $line -match '^\[.*\]') {
        # Moving to another section, but we were in [Experts]
        if (-not $foundAllowWebRequest) {
            $newContent += "AllowWebRequests=1"
        }
        if (-not $foundWebRequestUrl) {
            $newContent += "WebRequestsURL=$($urlsToAdd -join ';')"
        }
        $foundExperts = $false
        $newContent += $line
        continue
    }

    if ($foundExperts) {
        if ($line -match '^AllowWebRequests=') {
            $newContent += "AllowWebRequests=1"
            $foundAllowWebRequest = $true
        } elseif ($line -match '^WebRequestsURL=') {
            # Combine current and new URLs, ensuring no duplicates
            $currentValue = $line.Split('=')[1]
            $currentUrls = if ($currentValue -eq "" -or $currentValue -eq ";") { @() } else { $currentValue.Split(';') }
            
            $allUrls = ($currentUrls + $urlsToAdd) | Select-Object -Unique
            $newContent += "WebRequestsURL=$($allUrls -join ';')"
            $foundWebRequestUrl = $true
        } else {
            $newContent += $line
        }
    } else {
        $newContent += $line
    }
}

# 4. If [Experts] was never found, or we didn't finish it
if (-not $foundExperts) {
    $everFoundExperts = $content -match '^\[Experts\]'
    if (-not $everFoundExperts) {
        $newContent += ""
        $newContent += "[Experts]"
        $newContent += "AllowWebRequests=1"
        $newContent += "WebRequestsURL=$($urlsToAdd -join ';')"
    }
}

# 5. Handle trailing [Experts] section if it was at the end of file
if ($foundExperts -and -not $foundAllowWebRequest -and -not $foundWebRequestUrl) {
    $newContent += "AllowWebRequests=1"
    $newContent += "WebRequestsURL=$($urlsToAdd -join ';')"
}

# 6. Write back with Unicode encoding
$newContent | Out-File $terminalIniPath -Encoding Unicode -Force
Write-Host "Success: Updated terminal.ini with both Localhost and 127.0.0.1"
