$terminalIniPath = "C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\config\terminal.ini"
$urlToAdd = "http://localhost:3000"

# Check if file exists
if (-not (Test-Path $terminalIniPath)) {
    Write-Host "Error: terminal.ini not found at $terminalIniPath"
    exit 1
}

# Read content with Unicode encoding (UTF-16LE)
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
            $newContent += "WebRequestsURL=$urlToAdd"
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
            $currentUrls = $line.Split('=')[1]
            if ($currentUrls -notmatch [regex]::Escape($urlToAdd)) {
                if ($currentUrls -eq "" -or $currentUrls -eq ";") {
                    $newContent += "WebRequestsURL=$urlToAdd"
                } else {
                    $newContent += "WebRequestsURL=$currentUrls;$urlToAdd"
                }
            } else {
                $newContent += $line
            }
            $foundWebRequestUrl = $true
        } else {
            $newContent += $line
        }
    } else {
        $newContent += $line
    }
}

# If [Experts] was never found, append it
if (-not $foundExperts -and $newContent.Count -gt 0 -and $foundExperts -eq $false) {
    # Check if we ever saw Experts section
    $everFoundExperts = $content -match '^\[Experts\]'
    if (-not $everFoundExperts) {
        $newContent += ""
        $newContent += "[Experts]"
        $newContent += "AllowWebRequests=1"
        $newContent += "WebRequestsURL=$urlToAdd"
    }
}

# Write back with Unicode encoding
$newContent | Out-File $terminalIniPath -Encoding Unicode -Force
Write-Host "Success: Updated terminal.ini"
