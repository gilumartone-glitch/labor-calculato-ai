param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [string]$Owner = "gilumartone-glitch",
  [string]$Repo = "workprice-buddy-new",
  [string]$ReleaseDir = "electron-release"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:GH_TOKEN)) {
  throw "GH_TOKEN non impostata: installer creato localmente, pubblicazione saltata."
}

if (-not (Test-Path $ReleaseDir)) {
  throw "Cartella release non trovata: $ReleaseDir"
}

$tag = "v$Version"
$apiBase = "https://api.github.com/repos/$Owner/$Repo"
$headers = @{
  Authorization = "Bearer $env:GH_TOKEN"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "Tecnofra-Lab-Publisher"
}

Write-Host "Pubblico su GitHub: $Owner/$Repo - tag $tag"

try {
  $release = Invoke-RestMethod -Method Get -Uri "$apiBase/releases/tags/$tag" -Headers $headers
  Write-Host "Release gia' esistente: aggiorno gli allegati."
} catch {
  $statusCode = $_.Exception.Response.StatusCode.value__
  if ($statusCode -ne 404) { throw }

  $body = @{
    tag_name = $tag
    target_commitish = "main"
    name = "Tecnofra Lab $Version"
    draft = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 5

  $release = Invoke-RestMethod -Method Post -Uri "$apiBase/releases" -Headers $headers -Body $body -ContentType "application/json"
  Write-Host "Release creata."
}

$files = Get-ChildItem -Path $ReleaseDir -File | Where-Object {
  $_.Extension -in @(".exe", ".blockmap", ".yml", ".yaml")
}

if (-not $files) {
  throw "Nessun file pubblicabile trovato in $ReleaseDir"
}

foreach ($file in $files) {
  $existing = @($release.assets | Where-Object { $_.name -eq $file.Name })
  foreach ($asset in $existing) {
    Invoke-RestMethod -Method Delete -Uri "$apiBase/releases/assets/$($asset.id)" -Headers $headers | Out-Null
  }

  $uploadBase = $release.uploads_url -replace "\{\?name,label\}", ""
  $uploadUrl = "$uploadBase?name=$([Uri]::EscapeDataString($file.Name))"
  Write-Host "Carico: $($file.Name)"
  Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -InFile $file.FullName -ContentType "application/octet-stream" | Out-Null
}

Write-Host "Pubblicazione completata su $Owner/$Repo."