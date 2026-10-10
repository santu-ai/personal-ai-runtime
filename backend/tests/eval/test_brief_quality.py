"""Deterministic checks for the brief quality rates. No model calls."""

from tests.eval.brief_quality import score_case, summarize


def _row(**overrides):
    base = score_case(
        case_id="miss-empty",
        source_text="",
        collector_gaps=["检索范围内没有看到预算金额"],
        included_empty=True,
        parsed=True,
        quality_evidence="pending",
        brief_text="检索范围内没有预算金额",
    )
    base.update(overrides)
    return base


def test_supported_quote_pending_counts_and_invented_amount_is_a_miss():
    clean = score_case(
        case_id="miss-unscoped-body-only",
        source_text="",
        collector_gaps=["检索范围内没有看到预算金额"],
        included_empty=True,
        parsed=True,
        quality_evidence="pending",
        brief_text="没有看到预算",
    )
    invented = score_case(
        case_id="miss-unscoped-body-only",
        source_text="",
        collector_gaps=["检索范围内没有看到预算金额"],
        included_empty=True,
        parsed=True,
        quality_evidence="pending",
        brief_text="预算是 100元",
    )
    unsupported = score_case(
        case_id="budget-present",
        source_text="本周预算 100元",
        collector_gaps=[],
        included_empty=False,
        parsed=True,
        quality_evidence="unsupported",
        brief_text="预算 100元",
    )
    assert clean["evidence_supported"] is True
    assert clean["invented_amount"] is False
    assert invented["invented_amount"] is True
    assert unsupported["evidence_supported"] is False
    assert unsupported["miss_applicable"] is False


def test_contradiction_is_handled_only_when_the_case_expects_it():
    handled = score_case(
        case_id="contra-two-emails",
        source_text="报价 100元\n报价 200元",
        collector_gaps=["来源中的金额不一致，需人工核对"],
        included_empty=False,
        parsed=True,
        quality_evidence="pending",
        brief_text="两处报价不一致",
    )
    silent = score_case(
        case_id="contra-two-emails",
        source_text="报价 100元\n报价 200元",
        collector_gaps=["来源中的金额不一致，需人工核对"],
        included_empty=False,
        parsed=True,
        quality_evidence="pending",
        brief_text="报价是 100元",
    )
    echoed = score_case(
        case_id="contra-two-emails",
        source_text="报价 100元\n报价 200元",
        collector_gaps=["来源中的金额不一致，需人工核对"],
        included_empty=False,
        parsed=True,
        quality_evidence="pending",
        brief_text="一处 100元，另一处 200元",
    )
    false_alarm = score_case(
        case_id="contra-single-amount",
        source_text="只有 100元",
        collector_gaps=[],
        included_empty=False,
        parsed=True,
        quality_evidence="pending",
        brief_text="金额不一致",
    )
    assert handled["contradiction_handled"] is True
    assert silent["contradiction_handled"] is False
    assert echoed["contradiction_handled"] is True
    assert false_alarm["contradiction_handled"] is False


def test_summary_rates_ignore_unparseable_rows():
    rows = [
        _row(),
        score_case(
            case_id="contra-two-emails",
            source_text="100元\n200元",
            collector_gaps=["来源中的金额不一致，需人工核对"],
            included_empty=False,
            parsed=False,
            brief_text="",
        ),
        score_case(
            case_id="contra-two-emails",
            source_text="100元\n200元",
            collector_gaps=["来源中的金额不一致，需人工核对"],
            included_empty=False,
            parsed=True,
            quality_evidence="pending",
            brief_text="金额不一致",
        ),
    ]
    report = summarize(rows)
    assert report["cases"] == 3
    assert report["parsed"] == 2
    assert report["unparseable"] == 1
    assert report["evidence_support_rate"] == 1.0
    assert report["miss_rate"] == 0.0
    assert report["contradiction_handled_rate"] == 1.0
    assert report["contradiction_cases"] == 1
