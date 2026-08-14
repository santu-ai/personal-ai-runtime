"""单实例文件锁测试（INV-W6 运行时强制）。

覆盖：
    - 同进程重入 acquire 为 no-op
    - 第二持有者（第二个文件句柄）非阻塞获取失败并抛出中文提示
    - release 后可重新获取（TestClient 反复进出 lifespan 必须稳定）

Windows 上 msvcrt.locking 只锁字节区间且锁随句柄，测试中注意先
release（解锁 + 关句柄）再断言可重新获取。
"""

import pytest

from app.store.database import (
    InstanceLock,
    InstanceLockError,
    acquire_instance_lock,
    release_instance_lock,
)


def test_reentrant_acquire_is_noop(tmp_path):
    """同一进程同一 InstanceLock 重复 acquire 不报错（no-op）。"""
    lock = InstanceLock(str(tmp_path / "a.db.lock"))
    lock.acquire()
    assert lock.held
    lock.acquire()  # 重入：no-op
    assert lock.held
    lock.release()
    assert not lock.held


def test_second_holder_rejected(tmp_path):
    """模拟第二持有者：第二个文件句柄对同一锁文件加锁必须失败。"""
    path = str(tmp_path / "b.db.lock")
    first = InstanceLock(path)
    first.acquire()
    second = InstanceLock(path)
    with pytest.raises(InstanceLockError, match="另一个后端实例"):
        second.acquire()
    assert not second.held
    # 句柄关闭顺序：先释放第一持有者（解锁 + 关句柄），第二持有者才能拿到。
    first.release()
    second.acquire()
    assert second.held
    second.release()


def test_release_then_reacquire(tmp_path):
    """release 后可重新获取（同一实例与新实例均可）。"""
    path = str(tmp_path / "c.db.lock")
    lock = InstanceLock(path)
    lock.acquire()
    lock.release()
    lock.acquire()  # 同一实例重新获取
    assert lock.held
    lock.release()

    fresh = InstanceLock(path)
    fresh.acquire()  # 新实例重新获取
    assert fresh.held
    fresh.release()


def test_module_helpers_reentrant_and_stable(tmp_path):
    """acquire_instance_lock / release_instance_lock：反复进出必须稳定。

    模拟 FastAPI TestClient 多次触发 lifespan（acquire → release 循环）。
    """
    db_path = str(tmp_path / "d.db")
    for _ in range(3):
        lock = acquire_instance_lock(db_path)
        assert lock.held
        # 同进程重复 acquire：no-op，返回同一持锁对象。
        again = acquire_instance_lock(db_path)
        assert again is lock
        release_instance_lock(db_path)
        assert not lock.held
    # 未持有时 release 为 no-op，不抛错。
    release_instance_lock(db_path)


def test_module_helper_conflict_with_direct_holder(tmp_path):
    """锁被（模拟的）另一实例持有时，acquire_instance_lock 抛 InstanceLockError。"""
    db_path = str(tmp_path / "e.db")
    holder = InstanceLock(f"{db_path}.lock")
    holder.acquire()
    try:
        with pytest.raises(InstanceLockError, match="另一个后端实例"):
            acquire_instance_lock(db_path)
    finally:
        holder.release()
    # 冲突失败后不残留 held 状态：释放原持有者即可获取。
    lock = acquire_instance_lock(db_path)
    assert lock.held
    release_instance_lock(db_path)
