"""WorkItem engine 行为测试。"""
from app.core.runtime.work_item_engine import (
    create_work_item,
    get_sub_work_items,
    get_work_item,
    list_work_items,
    update_work_item_status,
)


class TestTaskEngine:
    def test_create_and_get_task(self, isolated_kernel):
        task = create_work_item(title="Test Task", description="A test task", work_type="task")
        assert task["title"] == "Test Task"
        assert task["status"] == "pending"
        assert task["description"] == "A test task"

        retrieved = get_work_item(task["id"])
        assert retrieved is not None
        assert retrieved["title"] == "Test Task"

    def test_create_subtask(self, isolated_kernel):
        parent = create_work_item(title="Parent Task", work_type="task")
        child = create_work_item(
            title="Child Task",
            work_type="task",
            parent_work_id=parent["id"],
            priority=5,
        )
        assert child["parent_work_id"] == parent["id"]
        assert child["priority"] == 5

        subtasks = get_sub_work_items(parent["id"])
        assert len(subtasks) == 1
        assert subtasks[0]["title"] == "Child Task"

    def test_task_for_goal(self, isolated_kernel):
        task = create_work_item(title="Standalone Task", work_type="task")
        assert task["parent_work_id"] is None

        tasks = list_work_items()
        assert any(t["id"] == task["id"] for t in tasks)

    def test_update_status(self, isolated_kernel):
        task = create_work_item(title="Status Test", work_type="task")
        updated = update_work_item_status(task["id"], "running")
        assert updated["status"] == "running"

        completed = update_work_item_status(task["id"], "completed")
        assert completed["status"] == "completed"

    def test_dependencies_met(self, isolated_kernel):
        from app.core.runtime.work_item_engine import are_dependencies_met
        dep = create_work_item(title="Dependency Task", work_type="task")
        update_work_item_status(dep["id"], "running")
        update_work_item_status(dep["id"], "completed")

        main_task = create_work_item(
            title="Main Task",
            work_type="task",
            dependencies=[dep["id"]],
        )
        assert are_dependencies_met(main_task["id"])

    def test_list_work_items(self, isolated_kernel):
        create_work_item(title="W1", work_type="task")
        tasks = list_work_items(limit=10)
        assert isinstance(tasks, list)
        assert len(tasks) >= 1
