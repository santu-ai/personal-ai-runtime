"""FragmentSelector behaviour — tier selection, stage sets, scenario tags, dedup."""

from __future__ import annotations

from app.context_runtime import FragmentRegistry
from app.core.runtime.governance.fragment_selector import (
    BRIEF_FRAGMENT_IDS,
    CORE_TIER_FRAGMENT_IDS,
    POST_TOOL_FRAGMENT_IDS,
    FragmentSelector,
    reachable_fragment_ids,
)
from app.core.runtime.governance.query_analyzer import AnalysisResult
from app.fragments.register import register_all_fragments


def _selector() -> tuple[FragmentSelector, FragmentRegistry]:
    registry = FragmentRegistry()
    register_all_fragments(registry)
    return FragmentSelector(registry), registry


def test_priority_tier_includes_conversation_state_and_governance():
    """priority >= 80 fragments join chat stage alongside Core Tier."""
    selector, registry = _selector()
    ids = {f.id for f in selector.select(AnalysisResult(tags=set()))}

    assert set(CORE_TIER_FRAGMENT_IDS) <= ids
    assert "core.conversation_state" in ids  # priority 80
    assert "core.governance" in ids  # priority 85

    # Priority floor: mail/calendar scenario fragments stay out without tags.
    assert "mail.recent_emails" not in ids
    assert "calendar.today" not in ids

    # Confirm the floor against the live registry, not a hard-coded list.
    below = {f.id for f in registry.list_all() if f.priority < 80}
    assert below.isdisjoint({"core.conversation_state", "core.governance"})
    assert "mail.recent_emails" in below


def test_scenario_mail_maps_to_mail_fragments():
    selector, _ = _selector()
    ids = {f.id for f in selector.select(AnalysisResult(tags={"mail"}))}
    assert "mail.recent_emails" in ids
    assert "mail.email_search" in ids


def test_scenario_calendar_maps_to_calendar_fragments():
    selector, _ = _selector()
    ids = {f.id for f in selector.select(AnalysisResult(tags={"calendar"}))}
    assert "calendar.today" in ids
    assert "calendar.upcoming" in ids


def test_scenario_planning_and_review_map_to_background():
    """planning/review tags map to core.background (already in Core — no extra)."""
    selector, _ = _selector()
    for tag in ("planning", "review"):
        ids = {f.id for f in selector.select(AnalysisResult(tags={tag}))}
        assert "core.background" in ids
        assert "mail.recent_emails" not in ids


def test_unknown_tag_adds_no_scenario_fragments():
    selector, _ = _selector()
    baseline = {f.id for f in selector.select(AnalysisResult(tags=set()))}
    with_unknown = {f.id for f in selector.select(AnalysisResult(tags={"unknown_xyz"}))}
    assert with_unknown == baseline


def test_no_duplicate_ids_when_scenario_overlaps_core():
    """planning maps to core.background which is already Core Tier — seen dedups."""
    selector, _ = _selector()
    selected = selector.select(AnalysisResult(tags={"planning", "mail"}))
    ids = [f.id for f in selected]
    assert len(ids) == len(set(ids))
    assert ids.count("core.background") == 1


def test_post_tool_stage_uses_reduced_set_plus_scenario():
    selector, _ = _selector()
    ids = {
        f.id
        for f in selector.select_for_stage(
            AnalysisResult(tags={"mail"}),
            "post_tool",
        )
    }
    assert set(POST_TOOL_FRAGMENT_IDS) <= ids
    assert "mail.recent_emails" in ids
    # Priority-tier-only (governance is in POST_TOOL; conversation_state is too).
    # Core timeline/goals must NOT appear in post_tool.
    assert "core.timeline" not in ids
    assert "core.goals" not in ids


def test_brief_stage_uses_brief_set_only():
    selector, _ = _selector()
    ids = {
        f.id
        for f in selector.select_for_stage(
            AnalysisResult(tags={"mail"}),
            "brief",
        )
    }
    assert ids == set(BRIEF_FRAGMENT_IDS)
    # Scenario tags are ignored in brief stage.
    assert "mail.recent_emails" not in ids


def test_unknown_stage_falls_back_to_chat():
    selector, _ = _selector()
    chat_ids = {f.id for f in selector.select(AnalysisResult(tags={"mail"}))}
    fallback = {
        f.id
        for f in selector.select_for_stage(AnalysisResult(tags={"mail"}), "other")
    }
    assert fallback == chat_ids


def test_reachable_fragment_ids_default_and_tagged():
    _, registry = _selector()
    default = reachable_fragment_ids(registry)
    assert set(CORE_TIER_FRAGMENT_IDS) <= default
    assert "core.conversation_state" in default

    mailed = reachable_fragment_ids(registry, tags={"mail"})
    assert "mail.recent_emails" in mailed
    assert "mail.email_search" in mailed
