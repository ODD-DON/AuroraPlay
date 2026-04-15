# Build helper for Windows (PowerShell)
# Run this from an elevated Developer x64 command prompt.

$msys = "C:\msys64\usr\bin\bash.exe"
if (-not (Test-Path $msys)) {
  Write-Host "msys2 bash not found at $msys. Install MSYS2 or run from Git Bash." -ForegroundColor Yellow
}

$cwd = (Get-Location).Path
$drive = $cwd.Substring(0,1).ToLower()
$pathWithoutDrive = $cwd.Substring(2) -replace '\\', '/'
$bashPath = "/$drive/$pathWithoutDrive"

Write-Host "Running Windows build script via MSYS2 bash..."
$bashCmd = "cd '$bashPath' && scripts/appveyor-win.sh"
& $msys -lc $bashCmd

Write-Host "When complete, copy the output folder to AuroraPlay-Win and rename chiaki.exe to AuroraPlay.exe"
Write-Host "Example commands:" -ForegroundColor Cyan
Write-Host "  mkdir AuroraPlay-Win" -ForegroundColor Cyan
Write-Host "  cp -r Chiaki/* AuroraPlay-Win/" -ForegroundColor Cyan
Write-Host "  rename AuroraPlay-Win\chiaki.exe AuroraPlay-Win\AuroraPlay.exe" -ForegroundColor Cyan
Write-Host "Then run AuroraPlay-Win\AuroraPlay.exe to test." -ForegroundColor Green
