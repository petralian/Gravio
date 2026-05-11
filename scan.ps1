$roots = @(
  "$env:APPDATA\Claude",
  "$env:APPDATA\Cursor",
  "$env:LOCALAPPDATA\Cursor",
  "$env:USERPROFILE\.cursor",
  "$env:USERPROFILE\.config\Cursor"
)

Write-Host "--- Scanning Roots ---"
foreach ($root in $roots) {
    if (Test-Path $root) {
        Write-Host "Existing Root: $root"
        Get-ChildItem -Path $root -Include *.json, *.jsonc, *.yaml, *.yml, *.toml, *.md, *.txt -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
            $file = $_.FullName
            try {
                $content = Get-Content $file -ErrorAction SilentlyContinue
                if ($content) {
                    $lineNum = 1
                    foreach ($line in $content) {
                        if ($line -match "40_Projects" -and ($line -match "obsidian" -or $line -match "mcp")) {
                             Write-Host "${file}:${lineNum}:${line}"
                        }
                        $lineNum++
                    }
                }
            } catch {}
        }
    }
}

Write-Host "--- Targeted Checks ---"
$claudeConfig = "$env:APPDATA\Claude\claude_desktop_config.json"
$settingsJson = "$env:APPDATA\Cursor\User\settings.json"

if (Test-Path $claudeConfig) {
    Write-Host "Checking $claudeConfig"
    Select-String -Path $claudeConfig -Pattern "40_Projects"
}
if (Test-Path $settingsJson) {
     Write-Host "Checking $settingsJson"
     Select-String -Path $settingsJson -Pattern "40_Projects"
}

$globalStorageDir = "$env:APPDATA\Cursor\User\globalStorage\"
if (Test-Path $globalStorageDir) {
    Write-Host "Checking recent globalStorage files..."
    Get-ChildItem -Path $globalStorageDir -Filter "*.json" -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 50 | ForEach-Object {
        Select-String -Path $_.FullName -Pattern "40_Projects" -ErrorAction SilentlyContinue
    }
}
