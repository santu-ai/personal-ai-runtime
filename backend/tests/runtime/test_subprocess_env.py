"""Tests for shared minimal subprocess environment helper."""

import sys

from app.core.harness.subprocess_env import minimal_subprocess_env


def test_minimal_env_excludes_secrets(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "secret")
    monkeypatch.setenv("EMAIL_PASS", "secret")
    monkeypatch.setenv("PATH", "/usr/bin")
    env = minimal_subprocess_env()
    assert env["PATH"] == "/usr/bin"
    assert "LLM_API_KEY" not in env
    assert "EMAIL_PASS" not in env


def test_minimal_env_extra_overlay(monkeypatch):
    monkeypatch.setenv("PATH", "/bin")
    env = minimal_subprocess_env(extra={"BRAVE_API_KEY": "k", "EMPTY": ""})
    assert env["BRAVE_API_KEY"] == "k"
    assert "EMPTY" not in env


def test_windows_env_keeps_npx_cache_paths(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("PATH", r"C:\bin")
    monkeypatch.setenv("APPDATA", r"C:\Users\test\AppData\Roaming")
    monkeypatch.setenv("LOCALAPPDATA", r"C:\Users\test\AppData\Local")

    env = minimal_subprocess_env()

    assert env["APPDATA"].endswith("Roaming")
    assert env["LOCALAPPDATA"].endswith("Local")
