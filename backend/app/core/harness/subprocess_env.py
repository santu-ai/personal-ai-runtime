"""构建子进程最小化环境，防止凭据经工具子进程泄漏。

shell 工具与外部 MCP server 通过 stdio 派生子进程；若直接继承父进程
完整环境，LLM_API_KEY、EMAIL_PASS 等密钥会被一并带入工具子进程。
"""

from __future__ import annotations

import os
import sys

# 工具正常运行所需的定位/临时目录/身份变量；刻意排除凭据类变量。
_BASE_KEYS = (
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TZ",
)

_WIN_KEYS = (
    "SYSTEMROOT",
    "USERPROFILE",
    "COMSPEC",
    "PATHEXT",
)


def minimal_subprocess_env(*, extra: dict[str, str] | None = None) -> dict[str, str]:
    """返回经白名单过滤的环境，供 ``subprocess.run`` / MCP stdio 使用。

    ``extra`` 最后应用，用于注入 MCP server 各自所需的凭据（取自 settings）。
    """
    env: dict[str, str] = {}
    for key in _BASE_KEYS:
        val = os.environ.get(key)
        if val:
            env[key] = val
    if sys.platform == "win32":
        for key in _WIN_KEYS:
            val = os.environ.get(key)
            if val:
                env[key] = val
    if "PATH" not in env:
        env["PATH"] = os.environ.get("PATH", "")
    if extra:
        for key, val in extra.items():
            if val:
                env[key] = val
    return env
