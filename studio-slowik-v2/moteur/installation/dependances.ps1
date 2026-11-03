# Installe les dependances du moteur dans le Python du logiciel (premier lancement ou mise a jour).
# PyTorch avec CUDA (carte NVIDIA) : versions essayees de la plus recente a la plus ancienne ; sans
# carte NVIDIA, version processeur.
param([string]$App = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$ErrorActionPreference = 'Stop'
$py = Join-Path $App 'python\python.exe'
$marque = Join-Path $App 'python\dependances-ok.txt'
$req = Join-Path $App 'moteur\requirements.txt'
Write-Host 'Studio SLOWIK Detourage : installation du moteur d''IA (une seule fois, environ 3 Go a telecharger).'
if (-not (Test-Path (Join-Path $App 'python\Scripts\pip.exe'))) {
  & $py (Join-Path $App 'python\get-pip.py') --no-warn-script-location
  if ($LASTEXITCODE) { throw 'installation de pip impossible' }
}
$nvidia = $false
try { $nvidia = [bool](Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' }) } catch { }
$ok = $false
if ($nvidia) {
  foreach ($cuda in 'cu130', 'cu128', 'cu126') {
    Write-Host "PyTorch pour carte NVIDIA ($cuda)..."
    & $py -m pip install --no-warn-script-location torch torchvision --index-url "https://download.pytorch.org/whl/$cuda"
    if (-not $LASTEXITCODE) { $ok = $true; break }
  }
}
if (-not $ok) {
  Write-Host 'PyTorch pour processeur (pas de carte NVIDIA : calcul beaucoup plus lent)...'
  & $py -m pip install --no-warn-script-location torch torchvision --index-url 'https://download.pytorch.org/whl/cpu'
  if ($LASTEXITCODE) { throw 'installation de PyTorch impossible' }
}
& $py -m pip install --no-warn-script-location -r $req
if ($LASTEXITCODE) { throw 'installation des dependances impossible' }
& $py -c "import torch; print('Carte graphique :', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'aucune (processeur)')"
Set-Content -Path $marque -Value (Get-Date -Format s)
Write-Host 'Moteur installe.'
