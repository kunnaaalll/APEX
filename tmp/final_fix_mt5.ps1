$terminalIniPath = "C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\config\terminal.ini"
$desiredUrlLine = "WebRequestsURL=http://localhost:3000;http://127.0.0.1:3000"

# Read all lines with Unicode encoding
$lines = Get-Content $terminalIniPath -Encoding Unicode
$newLines = @()
$foundUrlLine = $false

foreach ($line in $lines) {
    if ($line -match '^WebRequestsURL=') {
        $newLines += $desiredUrlLine
        $foundUrlLine = $true
    } else {
        $newLines += $line
    }
}

# If not found, we should ideally find [Experts] and add it under it
if (-not $foundUrlLine) {
    # This is a fallback, but the line was found before (just mangled)
    $newLines += $desiredUrlLine
}

# Write back with Unicode encoding
$newLines | Out-File $terminalIniPath -Encoding Unicode -Force
Write-Host "Success: Updated WebRequestsURL line directly."
