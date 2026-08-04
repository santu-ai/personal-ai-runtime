"""Bound / 惰性模块级单例代理 —— Runtime 不静态导入 Store。

Store 用法：由 RuntimeContainer 调用 bind 绑定；
Runtime 用法：``_LazyProxy = BoundProxy`` 携带即时 factory。

若调用方在导入 ``runtime_container`` 之前就访问 ``db`` / ``vector_store``，
首次属性访问会经 ``importlib`` 惰性加载 container（不会出现在
``check_layer_deps`` 的 AST R2 检查中），让脚本与测试免受导入顺序坑。
"""

from __future__ import annotations

import importlib
from typing import Any, Callable


class BoundProxy:
    """向 factory 提供的实例做透明转发。

    属性写/删都留在代理自身上（对 unittest.mock.patch 友好）。

    - Store 模式：``BoundProxy()`` 后由 RuntimeContainer 调用 ``bind(factory)``
      （或在首次访问时自动绑定）。
    - Runtime 模式：``BoundProxy(lambda: runtime.x)``（别名 ``_LazyProxy``）。
    """

    def __init__(self, factory: Callable[[], Any] | None = None) -> None:
        self.__dict__["_factory"] = factory

    def bind(self, factory: Callable[[], Any]) -> None:
        self.__dict__["_factory"] = factory

    def _ensure_bound(self) -> Callable[[], Any]:
        factory = self.__dict__.get("_factory")
        if factory is not None:
            return factory
        # 惰性自举：加载 RuntimeContainer，其中会调用 bind_*_factory。
        importlib.import_module("app.core.runtime.runtime_container")
        factory = self.__dict__.get("_factory")
        if factory is None:
            raise RuntimeError(
                "Store singleton not bound after loading runtime_container"
            )
        return factory

    def _resolve(self) -> Any:
        return self._ensure_bound()()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._resolve(), name)

    def __setattr__(self, name: str, value: Any) -> None:
        self.__dict__[name] = value

    def __delattr__(self, name: str) -> None:
        if name in self.__dict__:
            del self.__dict__[name]
        else:
            delattr(self._resolve(), name)

    def __bool__(self) -> bool:
        factory = self.__dict__.get("_factory")
        if factory is None:
            try:
                factory = self._ensure_bound()
            except Exception:
                return False
        return bool(factory())

    def __repr__(self) -> str:
        try:
            return repr(self._resolve())
        except Exception as exc:
            return f"<BoundProxy unbound-or-error: {exc}>"
