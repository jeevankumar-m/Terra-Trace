# Windows equivalent of the Makefile:  powershell -ExecutionPolicy Bypass -File tasks.ps1 <target> [args]
#   setup | synthetic | analysis [-SceneA ... -SceneB ... -Aoi ... -Id ... [-Exploratory]] | sample | api | web | test | demo
param(
    [Parameter(Position = 0)][string]$Target = "help",
    [string]$SceneA, [string]$SceneB, [string]$Aoi, [string]$Id, [switch]$Exploratory
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$py = ".venv\Scripts\python.exe"

function Synthetic {
    & $py -m tests.fixtures.synthetic --out tests/fixtures/synthetic_dev --aoi data/aoi/synthetic_dev.geojson
    & $py -m analysis.run_analysis --scene-a tests/fixtures/synthetic_dev/SYNTHETIC_DEV_SCENE_A.h5 `
        --scene-b tests/fixtures/synthetic_dev/SYNTHETIC_DEV_SCENE_B.h5 --aoi data/aoi/synthetic_dev.geojson `
        --analysis-id synthetic_dev
}

switch ($Target) {
    "setup" { python -m venv .venv; & $py -m pip install -r requirements.txt; Push-Location frontend; pnpm install; Pop-Location }
    "synthetic" { Synthetic }
    "analysis" {
        if (-not $SceneA) { Synthetic; break }
        $a = @("-m", "analysis.run_analysis", "--scene-a", $SceneA, "--aoi", $Aoi, "--analysis-id", $Id)
        if ($SceneB) { $a += @("--scene-b", $SceneB) }
        if ($Exploratory) { $a += "--force-exploratory" }
        & $py @a
    }
    "sample" {
        $dir = "data/raw/nasa_sample_lband"; New-Item -ItemType Directory -Force $dir | Out-Null
        $base = "https://nisar.asf.earthdatacloud.nasa.gov/NISAR-SAMPLE-DATA/GCOV"
        $names = @("NISAR_L2_PR_GCOV_001_030_A_019_2800_SHNA_A_20081012T060911_20081012T060925_D00404_N_F_J_001",
                   "NISAR_L2_PR_GCOV_002_030_A_019_2800_SHNA_A_20081127T061000_20081127T061014_D00404_N_F_J_001")
        foreach ($n in $names) { if (-not (Test-Path "$dir/$n.h5")) { curl.exe -L -o "$dir/$n.h5" "$base/$n/$n.h5" } }
        & $py -m analysis.run_analysis --scene-a "$dir/$($names[0]).h5" --scene-b "$dir/$($names[1]).h5" `
            --aoi data/aoi/nasa_sample_lband.geojson --analysis-id nasa_sample_lband_exploratory --force-exploratory
    }
    "api" { & $py -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir backend }
    "web" { Push-Location frontend; pnpm dev; Pop-Location }
    "test" { & $py -m pytest -q }
    "demo" { & $py -m pytest -q; Synthetic; Write-Host "Now run 'tasks.ps1 api' and 'tasks.ps1 web' in two terminals." }
    default { Get-Content $PSCommandPath -TotalCount 3 }
}
