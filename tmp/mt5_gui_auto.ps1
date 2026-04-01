# Automate adding WebRequest URL via MT5 GUI using SendKeys
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic

# Make sure MT5 is running
$mt5 = Get-Process -Name terminal64 -ErrorAction SilentlyContinue
if (-not $mt5) {
    Write-Host "Starting MetaTrader 5..."
    Start-Process "C:\Program Files\MetaTrader 5\terminal64.exe"
    Start-Sleep -Seconds 5
    $mt5 = Get-Process -Name terminal64 -ErrorAction SilentlyContinue
}

if (-not $mt5) {
    Write-Host "ERROR: Could not start MetaTrader 5"
    exit 1
}

Write-Host "MT5 is running. Bringing to foreground..."

# Bring MT5 window to foreground
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$hwnd = $mt5.MainWindowHandle
[Win32]::ShowWindow($hwnd, 9) # SW_RESTORE
Start-Sleep -Milliseconds 500
[Win32]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 500

# Open Tools -> Options (Ctrl+O)
Write-Host "Opening Options dialog (Ctrl+O)..."
[System.Windows.Forms.SendKeys]::SendWait("^o")
Start-Sleep -Seconds 2

# Navigate to Expert Advisors tab - it's typically the 3rd or 4th tab
# We'll press Right arrow to get to it, or use Ctrl+Tab
# First, let's try clicking the "Expert Advisors" tab
# The Options dialog tabs: Server, Charts, Trade, Expert Advisors, ...
# Press Right arrow 3 times from the first tab
Write-Host "Navigating to Expert Advisors tab..."
[System.Windows.Forms.SendKeys]::SendWait("{RIGHT}{RIGHT}{RIGHT}")
Start-Sleep -Seconds 1

Write-Host "Done! The Expert Advisors tab should now be visible."
Write-Host "Please manually:"
Write-Host "  1. Check 'Allow WebRequest for listed URL'"  
Write-Host "  2. Click the '+' button or add URL field"
Write-Host "  3. Type: http://localhost:3000"
Write-Host "  4. Click OK"
