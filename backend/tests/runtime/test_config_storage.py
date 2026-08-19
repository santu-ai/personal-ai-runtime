"""Tests for storage path resolution and ghost-path detection."""

from pathlib import Path

from app.config import (
    BASE_DIR,
    Settings,
    default_mcp_local_config_path,
    resolve_project_path,
    validate_storage_paths,
)


def test_resolve_project_path_from_relative_backend_cwd(tmp_path, monkeypatch):
    """Relative ./backend/data must resolve to repo-root backend/data, not cwd-relative."""
    backend_cwd = tmp_path / "backend"
    backend_cwd.mkdir(parents=True)
    monkeypatch.chdir(backend_cwd)

    resolved = Path(resolve_project_path("./backend/data"))
    expected = (BASE_DIR / "backend" / "data").resolve()
    assert resolved == expected
    assert resolved.parts.count("backend") == 1


def test_validate_storage_paths_detects_ghost():
    ghost = str(BASE_DIR / "backend" / "backend" / "data")
    warnings = validate_storage_paths(ghost, ghost + "/personal_ai.db", ghost + "/vectors")
    assert any("ghost path" in w for w in warnings)


def test_settings_empty_data_dir_uses_default(monkeypatch):
    monkeypatch.setenv("DATA_DIR", "")
    monkeypatch.setenv("SQLITE_PATH", "")
    monkeypatch.setenv("VECTOR_DIR", "")

    s = Settings()
    assert Path(s.data_dir) == (BASE_DIR / "backend" / "data").resolve()
    assert Path(s.sqlite_path) == (BASE_DIR / "backend" / "data" / "personal_ai.db").resolve()


def test_settings_resolves_relative_data_dir(monkeypatch, tmp_path):
    backend_cwd = tmp_path / "backend"
    backend_cwd.mkdir(parents=True)
    monkeypatch.setenv("DATA_DIR", "./backend/data")
    monkeypatch.setenv("SQLITE_PATH", "")
    monkeypatch.setenv("VECTOR_DIR", "")
    monkeypatch.chdir(backend_cwd)

    s = Settings()
    assert Path(s.data_dir) == (BASE_DIR / "backend" / "data").resolve()
    assert "backend/backend" not in s.data_dir


def test_default_mcp_local_prefers_backend_file(tmp_path):
    backend_local = tmp_path / "backend-local.json"
    data_local = tmp_path / "data-local.json"
    backend_local.write_text("{}", encoding="utf-8")
    data_local.write_text("{}", encoding="utf-8")
    resolved = default_mcp_local_config_path(
        str(tmp_path), backend_local=backend_local, data_local=data_local,
    )
    assert Path(resolved) == backend_local.resolve()


def test_default_mcp_local_falls_back_to_data_dir(tmp_path):
    backend_local = tmp_path / "missing-backend.json"
    data_local = tmp_path / "data-local.json"
    data_local.write_text("{}", encoding="utf-8")
    resolved = default_mcp_local_config_path(
        str(tmp_path), backend_local=backend_local, data_local=data_local,
    )
    assert Path(resolved) == data_local.resolve()


def test_default_mcp_local_without_files_uses_backend_path(tmp_path):
    backend_local = tmp_path / "backend-local.json"
    data_local = tmp_path / "data-local.json"
    resolved = default_mcp_local_config_path(
        str(tmp_path), backend_local=backend_local, data_local=data_local,
    )
    assert Path(resolved) == backend_local.resolve()
