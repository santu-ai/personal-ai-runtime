"""Unit tests for Computer Use MCP server (import-safe, no hardware required)."""
from __future__ import annotations

import json

import pytest

from app.core.harness.builtin_tools.computer_use import ComputerUseServer
from app.core.harness.mcp_hub import ToolInvokeError


def _force_missing_deps(server: ComputerUseServer) -> None:
    def _mss():
        raise RuntimeError("Computer Use requires 'mss' library. Install: pip install mss")

    def _pyautogui():
        raise RuntimeError(
            "Computer Use requires 'pyautogui' library. Install: pip install pyautogui"
        )

    server._ensure_mss = _mss  # type: ignore[method-assign]
    server._ensure_pyautogui = _pyautogui  # type: ignore[method-assign]


class TestComputerUseServer:
    def test_init(self):
        s = ComputerUseServer()
        assert s._screenshot_module is None
        assert s._pyautogui is None

    def test_screenshot_without_mss(self):
        s = ComputerUseServer()
        _force_missing_deps(s)
        with pytest.raises(ToolInvokeError, match="mss"):
            s.screenshot()

    def test_click_without_pyautogui(self):
        s = ComputerUseServer()
        _force_missing_deps(s)
        with pytest.raises(ToolInvokeError, match="pyautogui"):
            s.click(100, 100)

    def test_type_empty_text(self):
        s = ComputerUseServer()

        class FakePyautogui:
            FAILSAFE = True

            @staticmethod
            def typewrite(text, interval=0.05):
                return None

            @staticmethod
            def hotkey(*_args):
                return None

        try:
            s._pyautogui = FakePyautogui()
            with pytest.raises(ToolInvokeError, match="Empty"):
                s.type_text("")
        finally:
            s._pyautogui = None

    def test_type_cjk_uses_clipboard_paste(self, monkeypatch):
        s = ComputerUseServer()
        pasted: list[str] = []

        class FakePyautogui:
            FAILSAFE = True

            @staticmethod
            def typewrite(text, interval=0.05):
                raise AssertionError("typewrite must not be used for CJK")

            @staticmethod
            def hotkey(*args):
                pasted.append("+".join(args))

        monkeypatch.setattr(s, "_set_clipboard", lambda text: None)
        try:
            s._pyautogui = FakePyautogui()
            result = json.loads(s.type_text("你好"))
            assert result["status"] == "ok"
            assert result["method"] == "clipboard_paste"
            assert pasted
        finally:
            s._pyautogui = None

    def test_server_singleton(self):
        from app.core.harness.builtin_tools.computer_use import computer_use_server

        assert isinstance(computer_use_server, ComputerUseServer)

    def test_screenshot_full_vs_primary(self):
        s = ComputerUseServer()
        _force_missing_deps(s)
        with pytest.raises(ToolInvokeError):
            s.screenshot("full")
        with pytest.raises(ToolInvokeError):
            s.screenshot("primary")


@pytest.mark.parametrize(
    ("method", "args", "kwargs"),
    [
        ("type_text", ("hello",), {}),
        ("move", (100, 100), {}),
        ("scroll", (3,), {}),
        ("press_key", ("enter",), {}),
        ("screen_size", (), {}),
        ("screenshot", ("unknown",), {}),
        ("click", (0, 0), {"button": "right"}),
        ("click", (0, 0), {"button": "middle"}),
        ("move", (50, 50), {"duration": 1.0}),
        ("scroll", (-3,), {}),
        ("press_key", ("ctrl+v",), {}),
        ("type_text", ("x",), {"interval": 0.1}),
    ],
)
def test_methods_error_without_deps(method, args, kwargs):
    """Missing pyautogui/mss must fail closed for all input variants."""
    s = ComputerUseServer()
    _force_missing_deps(s)
    with pytest.raises(ToolInvokeError):
        getattr(s, method)(*args, **kwargs)
