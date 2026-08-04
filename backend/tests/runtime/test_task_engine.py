"""WorkItem engine 行为测试。

历史上 Task 与 WorkItem 是两套词汇；现已统一为 work_item_*。
本测试改用新 API 验证同等行为，避免依赖 task_engine 的向后兼容别名。
"""
from app.core.runtime.task_engine import (
    create_task,
    create_work_item,
    get_sub_work_items,
    get_work_item,
    list_work_items,
    update_task_status,
)


class TestTaskEngine:
    def test_create_and_get_task(self, isolated_kernel):
        task = create_task(name="Test Task", description="A test task")
        assert task["title"] == "Test Task"
        assert task["status"] == "pending"
        assert task["description"] == "A test task"

        retrieved = get_work_item(task["id"])
        assert retrieved is not None
        assert retrieved["title"] == "Test Task"

    def test_create_subtask(self, isolated_kernel):
        parent = create_task(name="Parent Task")
        child = create_task(
            name="Child Task",
            parent_task_id=parent["id"],
            priority=5,
        )
        assert child["parent_work_id"] == parent["id"]
        assert child["priority"] == 5

        subtasks = get_sub_work_items(parent["id"])
        assert len(subtasks) == 1
        assert subtasks[0]["title"] == "Child Task"

    def test_task_for_goal(self, isolated_kernel):
        task = create_task(name="Standalone Task")
        assert task["parent_goal_id"] is None

        tasks = list_work_items()
        assert any(t["id"] == task["id"] for t in tasks)

    def test_update_status(self, isolated_kernel):
        task = create_task(name="Status Test")
        updated = update_task_status(task["id"], "running")
        assert updated["status"] == "running"

        completed = update_task_status(task["id"], "completed")
        assert completed["status"] == "completed"

    def test_dependencies_met(self, isolated_kernel):
        from app.core.runtime.task_engine import are_dependencies_met
        dep = create_task(name="Dependency Task")
        update_task_status(dep["id"], "running")
        update_task_status(dep["id"], "completed")

        main_task = create_task(
            name="Main Task",
            dependencies=[dep["id"]],
        )
        assert are_dependencies_met(main_task["id"])

    def test_list_work_items(self, isolated_kernel):
        # 直接用 work_item API 验证：list_work_items 是 read 路径的真相源。
        create_work_item(title="W1", work_type="task")
        tasks = list_work_items(limit=10)
        assert isinstance(tasks, list)
        assert len(tasks) >= 1
