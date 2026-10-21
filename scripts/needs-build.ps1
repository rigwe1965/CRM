# Used by start-crm-fast.bat. Exit code 0 = the production build in .next is current, 1 = it has to be (re)built.
#
# The build is stale when:
#  - there is no marker (start-crm-fast.bat writes .next\fast-build-done after a successful build), or
#  - any file that goes into the app is newer than the marker, or
#  - something else wrote into .next after the build (the dev server shares that folder and replaces the
#    production files when it runs).
$root = Split-Path $PSScriptRoot -Parent
$marker = Join-Path $root ".next\fast-build-done"
if (-not (Test-Path $marker)) { exit 1 }
$built = (Get-Item $marker).LastWriteTime

# Single files are read with Get-Item: in Windows PowerShell 5.1, "Get-ChildItem <file> -Recurse" walks the whole
# parent folder (node_modules included) and takes half a minute.
$files = "prisma\schema.prisma", "package.json", "package-lock.json", "next.config.mjs",
  "tailwind.config.ts", "postcss.config.mjs", "tsconfig.json" |
  ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ } | ForEach-Object { Get-Item $_ }
$sources = Get-ChildItem (Join-Path $root "src") -Recurse -File -ErrorAction SilentlyContinue
if (@($files) + @($sources) | Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1) { exit 1 }

$cache = Join-Path $root ".next\cache"
if (Get-ChildItem (Join-Path $root ".next") -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { -not $_.FullName.StartsWith($cache) -and $_.LastWriteTime -gt $built.AddMinutes(2) } |
    Select-Object -First 1) { exit 1 }

exit 0
