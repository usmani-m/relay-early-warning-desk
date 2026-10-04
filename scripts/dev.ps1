# Starts the backend (new window) and the frontend (this window) for local development.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { Write-Error "No venv found at $python. Create it first (see README)."; exit 1 }

Start-Process powershell -WorkingDirectory $root -ArgumentList @(
  "-NoExit", "-Command", "& '$python' -m uvicorn backend.main:app --reload --port 8000"
)

Set-Location (Join-Path $root "frontend")
if (-not (Test-Path "node_modules")) { npm install }
Write-Host "Frontend: http://localhost:5173  (backend window: http://localhost:8000/docs)"
npm run dev
