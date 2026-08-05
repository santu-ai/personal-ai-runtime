"""Tests for WorkItem State Manager."""
import pytest

from app.core.runtime.work_item_engine import WorkItemStatus, state_manager


class TestStateManager:
    def test_valid_transitions(self):
        assert state_manager.validate_transition(WorkItemStatus.PENDING, WorkItemStatus.RUNNING)
        assert state_manager.validate_transition(WorkItemStatus.RUNNING, WorkItemStatus.COMPLETED)
        assert state_manager.validate_transition(WorkItemStatus.RUNNING, WorkItemStatus.BLOCKED)
        assert state_manager.validate_transition(WorkItemStatus.RUNNING, WorkItemStatus.WAITING_APPROVAL)
        assert state_manager.validate_transition(WorkItemStatus.RUNNING, WorkItemStatus.FAILED)
        assert state_manager.validate_transition(WorkItemStatus.BLOCKED, WorkItemStatus.PENDING)
        assert state_manager.validate_transition(WorkItemStatus.BLOCKED, WorkItemStatus.CANCELLED)
        assert state_manager.validate_transition(WorkItemStatus.FAILED, WorkItemStatus.PENDING)
        assert state_manager.validate_transition(WorkItemStatus.PENDING, WorkItemStatus.CANCELLED)

    def test_invalid_transitions(self):
        with pytest.raises(ValueError):
            state_manager.validate_transition(WorkItemStatus.COMPLETED, WorkItemStatus.RUNNING)
        with pytest.raises(ValueError):
            state_manager.validate_transition(WorkItemStatus.CANCELLED, WorkItemStatus.RUNNING)
        with pytest.raises(ValueError):
            state_manager.validate_transition(WorkItemStatus.COMPLETED, WorkItemStatus.PENDING)
        with pytest.raises(ValueError):
            # domain FSM no longer has retrying — Lane A owns operational retry
            state_manager.validate_transition(WorkItemStatus.RUNNING, WorkItemStatus("retrying"))

    def test_terminal_states(self):
        assert state_manager.is_terminal(WorkItemStatus.COMPLETED)
        assert state_manager.is_terminal(WorkItemStatus.CANCELLED)
        assert not state_manager.is_terminal(WorkItemStatus.RUNNING)
        assert not state_manager.is_terminal(WorkItemStatus.PENDING)

    def test_active_states(self):
        assert state_manager.is_active(WorkItemStatus.PENDING)
        assert state_manager.is_active(WorkItemStatus.RUNNING)
        assert state_manager.is_active(WorkItemStatus.BLOCKED)
        assert state_manager.is_active(WorkItemStatus.WAITING_APPROVAL)
        assert not state_manager.is_active(WorkItemStatus.COMPLETED)

    def test_transition_with_event_bus(self):
        entity_id = "test-task-1"
        result = state_manager.transition(
            entity_id, "work_item", WorkItemStatus.PENDING, WorkItemStatus.RUNNING,
        )
        assert result == WorkItemStatus.RUNNING


class TestScheduledExecutionTransitionValidation:
    """ScheduledExecution.transition_to uses the Lane A FSM (not domain WorkItemStatus)."""

    def test_valid_transition_succeeds(self):
        from app.core.runtime.scheduled_execution import ScheduledExecution
        item = ScheduledExecution(event_type="X")
        item.transition_to("running")
        assert item.status == "running"
        assert item.started_at is not None

    def test_invalid_transition_raises(self):
        from app.core.runtime.scheduled_execution import ScheduledExecution
        item = ScheduledExecution(event_type="X", status="completed")
        with pytest.raises(ValueError):
            item.transition_to("running")

    def test_running_to_retrying_succeeds(self):
        from app.core.runtime.scheduled_execution import ScheduledExecution
        item = ScheduledExecution(event_type="X", status="running")
        item.transition_to("retrying")
        assert item.status == "retrying"
        # retrying → pending is the recovery path used by Scheduler._recover
        item.transition_to("pending")
        assert item.status == "pending"

    def test_domain_only_status_rejected(self):
        from app.core.runtime.scheduled_execution import ScheduledExecution
        item = ScheduledExecution(event_type="X", status="running")
        with pytest.raises(ValueError):
            item.transition_to("waiting_approval")  # type: ignore[arg-type]
