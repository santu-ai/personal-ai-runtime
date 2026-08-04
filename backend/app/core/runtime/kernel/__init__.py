"""Personal AI Runtime —— Kernel。

Runtime 的边界。User Space（agents、workflows、APIs、UI）只能经由
``Kernel`` 与系统交互；只有 Kernel 触碰存储。

对象模型、边界与 ABI 见 docs/01-overview/architecture.md。
"""

from .event import Event
from .kernel import Kernel

__all__ = ["Event", "Kernel"]
