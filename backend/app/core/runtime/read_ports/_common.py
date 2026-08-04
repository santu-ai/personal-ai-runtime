"""read_ports 共享的 Kernel 访问器。"""

from __future__ import annotations

import logging

logger = logging.getLogger("app.core.runtime.read_ports")


def kernel():
    """在调用时解析 Kernel（支持测试补丁 / RuntimeContainer.reset）。"""
    from app.core.runtime.kernel_instance import kernel as k
    return k
