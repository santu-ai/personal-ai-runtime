# Personal AI Runtime — Windows PowerShell task runner (Makefile.ps1 equivalent)
param(
    [Parameter(Position = 0)]
    [string]$Task = "help"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Desktop = Join-Path $Root "desktop"

function Invoke-Backend {
    param([string[]]$PyArgs)
    $python = Join-Path $Root ".venv\Scripts\python.exe"
    if (-not (Test-Path $python)) { $python = "python" }
    Push-Location $Backend
    try {
        & $python @PyArgs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
}

function Invoke-BackendModule {
    param([string]$Module, [string[]]$ExtraArgs = @())
    Invoke-Backend -PyArgs (@("-m", $Module) + $ExtraArgs)
}

function Invoke-ModuleList {
    param([string[]]$Modules)
    foreach ($mod in $Modules) {
        Write-Host ">> python -m $mod"
        Invoke-BackendModule $mod
    }
}

$StaticModules = @(
    "scripts.check_dependency_sync",
    "scripts.check_version_sync",
    "scripts.check_capability_policy_consistency",
    "scripts.check_doc_links",
    "scripts.check_doc_table_sync",
    "scripts.check_doc_line_refs",
    "scripts.check_doc_numbers",
    "scripts.check_boundary",
    "scripts.check_layer_deps",
    "scripts.check_execution_ownership",
    "scripts.check_concept_growth",
    "scripts.check_event_schema",
    "scripts.check_unused_config",
    "scripts.check_non_sovereign_attachments",
    "scripts.check_single_process_control_plane",
    "scripts.check_dynamic_imports",
    "scripts.check_except_hygiene"
)

$RuntimeModules = @(
    "scripts.verify_alembic",
    "scripts.verify_api_mcp_smoke",
    "scripts.check_projection_provenance",
    "scripts.verify_rebuild",
    "scripts.verify_snapshot_rebuild",
    "scripts.verify_conversation_rebuild",
    "scripts.verify_goal_rebuild",
    "scripts.verify_work_items_goal_rebuild",
    "scripts.verify_export_roundtrip",
    "scripts.verify_memory_lifecycle",
    "scripts.verify_inbox_audit",
    "scripts.verify_egress",
    "scripts.verify_vector_consistency",
    "scripts.verify_memory_index_repairs",
    "scripts.verify_tool_calls_audit"
)

switch ($Task) {
    "help" {
        Write-Host @"
Available tasks:
  install              Install backend, frontend, desktop dependencies (hash lock)
  dependency-sync      Verify requirements / pyproject / lock stamps
  install-hooks        Install git hooks (or run: .\install-hooks.cmd)
  test-backend         Run backend pytest
  test-live            Run opt-in live LLM smoke (needs RUN_LIVE_LLM=1 + LLM_API_KEY)
  test-frontend        Run frontend unit tests
  lint                 Run ruff on backend
  typecheck            Run mypy on backend
  boundary             Kernel boundary guard
  layer-deps           Runtime/Product/Store/API import edge guard
  architecture-check   Concept growth / God budgets
  event-schema         Event schema version contract
  single-process-control-plane  Single control-plane guard
  dynamic-imports      Dynamic import allowlist guard
  except-hygiene       Broad except hygiene
  docs-gen / docs-gen-check  Regenerate or check generated docs
  projection-provenance  Projection ↔ event_log provenance
  rebuild-verify       Full rebuild verify
  alembic-verify       Alembic head verify
  backend-ci-static    Static guards (aligned with Makefile)
  backend-ci-runtime   Runtime verifies + pytest (aligned with Makefile)
  backend-ci-core      Static then runtime
  docker-up            docker compose up --build
  docker-down          docker compose down

Note: Unix ``make backend-ci-core`` runs static/runtime waves with -j parallel.
PowerShell runs modules sequentially for reliable exit codes; use make/WSL for parallel CI.
"@
    }
    "install" {
        Push-Location $Backend
        python -m scripts.check_dependency_sync
        if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
        python -m pip install --require-hashes -r requirements.lock
        if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
        Pop-Location
        Push-Location $Frontend; npm ci; Pop-Location
        Push-Location $Desktop; npm ci; Pop-Location
    }
    "dependency-sync" {
        Invoke-BackendModule "scripts.check_dependency_sync"
    }
    "install-hooks" {
        $hookScript = Join-Path $Root "scripts\install_hooks.ps1"
        & powershell -NoProfile -ExecutionPolicy Bypass -File $hookScript
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    "test-backend" {
        Invoke-Backend -PyArgs @("-m", "pytest", "tests/", "-q", "-m", "not live_llm")
    }
    "test-live" {
        $env:RUN_LIVE_LLM = "1"
        Invoke-Backend -PyArgs @("-m", "pytest", "tests/e2e_live/", "-v", "-m", "live_llm")
    }
    "test-frontend" {
        Push-Location $Frontend
        npx tsc --noEmit
        npm test
        Pop-Location
    }
    "lint" {
        Push-Location $Backend
        ruff check app/
        Pop-Location
    }
    "typecheck" {
        Push-Location $Backend
        python -m mypy app/ scripts/ --ignore-missing-imports
        Pop-Location
    }
    "boundary" {
        Invoke-BackendModule "scripts.check_boundary"
    }
    "layer-deps" {
        Invoke-BackendModule "scripts.check_layer_deps"
    }
    "layer-deps-inventory" {
        Invoke-BackendModule "scripts.check_layer_deps" @("--inventory")
    }
    "architecture-check" {
        Invoke-BackendModule "scripts.check_concept_growth"
    }
    "event-schema" {
        Invoke-BackendModule "scripts.check_event_schema"
    }
    "single-process-control-plane" {
        Invoke-BackendModule "scripts.check_single_process_control_plane"
    }
    "dynamic-imports" {
        Invoke-BackendModule "scripts.check_dynamic_imports"
    }
    "except-hygiene" {
        Invoke-BackendModule "scripts.check_except_hygiene"
    }
    "docs-gen" {
        Invoke-BackendModule "scripts.gen_api_docs"
        Invoke-BackendModule "scripts.gen_tool_catalog"
        Invoke-BackendModule "scripts.gen_makefile_targets"
    }
    "docs-gen-check" {
        Invoke-BackendModule "scripts.gen_api_docs" @("--check")
        Invoke-BackendModule "scripts.gen_tool_catalog" @("--check")
        Invoke-BackendModule "scripts.gen_makefile_targets" @("--check")
    }
    "projection-provenance" {
        Invoke-BackendModule "scripts.check_projection_provenance"
    }
    "rebuild-verify" {
        Invoke-BackendModule "scripts.verify_rebuild"
    }
    "alembic-verify" {
        Invoke-BackendModule "scripts.verify_alembic"
    }
    "backend-ci-static" {
        Write-Host "Running static checks..."
        Push-Location $Backend
        python -m compileall app/ -q
        if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
        ruff check app/
        if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
        python -m mypy app/ scripts/ --ignore-missing-imports
        if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
        Pop-Location
        Invoke-ModuleList $StaticModules
        & $PSCommandPath "docs-gen-check"
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Host "backend-ci-static checks passed"
    }
    "backend-ci-runtime" {
        Write-Host "Running runtime verifies..."
        Push-Location $Backend
        python -m pytest tests/ -q -m "not live_llm"
        if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
        Pop-Location
        Invoke-ModuleList $RuntimeModules
        Write-Host "backend-ci-runtime checks passed"
    }
    "backend-ci-core" {
        & $PSCommandPath "backend-ci-static"
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $PSCommandPath "backend-ci-runtime"
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Host "backend-ci-core checks passed"
    }
    "docker-up" {
        docker compose up --build
    }
    "docker-down" {
        docker compose down
    }
    default {
        Write-Error "Unknown task: $Task. Run: .\Makefile.ps1 help"
    }
}
