"""Clipboard & OCR MCP Server — read clipboard text and OCR image files."""

import json
import subprocess

from app.core.harness.mcp_hub import (
    OUTCOME_TOOL_EXECUTION_FAILURE,
    ToolInvokeError,
)


class ClipboardOCRServer:
    """Clipboard operations and image-file text recognition (opt-in advanced)."""

    def get_clipboard_text(self) -> str:
        """Get current clipboard text content."""
        try:
            import tkinter as tk
            root = tk.Tk()
            root.withdraw()
            text = root.clipboard_get()
            root.destroy()
            return json.dumps({"content": text[:5000], "length": len(text)})
        except Exception:
            try:
                result = subprocess.run(
                    ["powershell", "Get-Clipboard"],
                    capture_output=True, text=True, timeout=5,
                )
            except Exception as e:
                raise ToolInvokeError(
                    OUTCOME_TOOL_EXECUTION_FAILURE,
                    f"Clipboard read failed (GUI/X11 required): {e}",
                ) from e
            if result.returncode != 0:
                err = (result.stderr or result.stdout or "Get-Clipboard failed").strip()
                raise ToolInvokeError(OUTCOME_TOOL_EXECUTION_FAILURE, err)
            text = result.stdout or ""
            return json.dumps({"content": text[:5000], "length": len(text)})

    def ocr_file(self, path: str) -> str:
        """Perform OCR on an image file."""
        try:
            import pytesseract
            from PIL import Image

            img = Image.open(path)
            text = pytesseract.image_to_string(img)
            return json.dumps({"file": path, "text": text[:3000], "length": len(text)})
        except ImportError as e:
            raise ToolInvokeError(
                OUTCOME_TOOL_EXECUTION_FAILURE, f"Dependency missing: {e}",
            ) from e
        except Exception as e:
            raise ToolInvokeError(OUTCOME_TOOL_EXECUTION_FAILURE, str(e)) from e


clipboard_ocr_server = ClipboardOCRServer()
