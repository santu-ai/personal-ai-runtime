"""Score a project-brief eval case after a model reply.

The deterministic suite already checks retrieval. These rates describe the
reply: whether quotes sit in the source text, whether a miss case invented an
amount, and whether a contradiction case says the amounts disagree.
"""

from __future__ import annotations

from app.product.project_brief import _amount_keys

_DISAGREE = ("不一致", "矛盾", "互相冲突", "相互冲突")


def brief_visible_text(brief: dict) -> str:
    parts: list[str] = [
        str(brief.get("summary") or ""),
        str(brief.get("content") or ""),
    ]
    parts.extend(str(item) for item in (brief.get("limitations") or []))
    for finding in brief.get("findings") or []:
        if isinstance(finding, dict):
            parts.append(str(finding.get("text") or ""))
            parts.append(str(finding.get("quote") or ""))
    return "\n".join(part for part in parts if part)


def score_case(
    *,
    case_id: str,
    source_text: str,
    collector_gaps: list[str],
    included_empty: bool,
    parsed: bool,
    quality_evidence: str = "",
    brief_text: str = "",
) -> dict:
    gaps = "\n".join(collector_gaps)
    expects_conflict = case_id.startswith("contra-") and "金额不一致" in gaps
    contradiction_applicable = case_id.startswith("contra-")
    mentions = any(phrase in brief_text for phrase in _DISAGREE)
    source_amounts = _amount_keys(source_text)
    model_amounts = _amount_keys(brief_text)
    if expects_conflict:
        echoed = len(source_amounts) >= 2 and source_amounts <= model_amounts
        contradiction_handled = mentions or echoed
    else:
        contradiction_handled = not mentions
    miss_applicable = case_id.startswith("miss-") and (
        included_empty or "没有看到" in gaps
    )
    invented = bool(model_amounts - source_amounts)
    return {
        "id": case_id,
        "parsed": parsed,
        "evidence_supported": parsed and quality_evidence == "pending",
        "miss_applicable": miss_applicable,
        "invented_amount": invented,
        "contradiction_applicable": contradiction_applicable,
        "contradiction_handled": contradiction_handled,
    }


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round(numerator / denominator, 4)


def _is_holdout(row: dict) -> bool:
    return str(row.get("id") or "").startswith("holdout-")


def _support_fields(parsed: list[dict], prefix: str) -> dict:
    supported = [row for row in parsed if row["evidence_supported"]]
    miss_rows = [row for row in parsed if row["miss_applicable"]]
    missed = [row for row in miss_rows if row["invented_amount"]]
    contra = [row for row in parsed if row["contradiction_applicable"]]
    handled = [row for row in contra if row["contradiction_handled"]]
    return {
        f"{prefix}parsed": len(parsed),
        f"{prefix}evidence_support_rate": _rate(len(supported), len(parsed)),
        f"{prefix}miss_rate": _rate(len(missed), len(miss_rows)),
        f"{prefix}contradiction_handled_rate": _rate(len(handled), len(contra)),
        f"{prefix}unsupported_ids": [
            row["id"] for row in parsed if not row["evidence_supported"]
        ],
    }


def summarize(rows: list[dict]) -> dict:
    parsed = [row for row in rows if row["parsed"]]
    tracked = [row for row in parsed if not _is_holdout(row)]
    holdout = [row for row in parsed if _is_holdout(row)]
    supported = [row for row in parsed if row["evidence_supported"]]
    miss_rows = [row for row in parsed if row["miss_applicable"]]
    missed = [row for row in miss_rows if row["invented_amount"]]
    contra = [row for row in parsed if row["contradiction_applicable"]]
    handled = [row for row in contra if row["contradiction_handled"]]
    tracked_fields = _support_fields(tracked, "tracked_")
    holdout_fields = _support_fields(holdout, "holdout_")
    return {
        "cases": len(rows),
        "parsed": len(parsed),
        "unparseable": len(rows) - len(parsed),
        "evidence_support_rate": _rate(len(supported), len(parsed)),
        "miss_rate": _rate(len(missed), len(miss_rows)),
        "contradiction_handled_rate": _rate(len(handled), len(contra)),
        "miss_cases": len(miss_rows),
        "contradiction_cases": len(contra),
        "unsupported_ids": [row["id"] for row in parsed if not row["evidence_supported"]],
        "missed_ids": [row["id"] for row in missed],
        "contradiction_missed_ids": [
            row["id"] for row in contra if not row["contradiction_handled"]
        ],
        "tracked_parsed": tracked_fields["tracked_parsed"],
        "tracked_evidence_support_rate": tracked_fields["tracked_evidence_support_rate"],
        "tracked_unsupported_ids": tracked_fields["tracked_unsupported_ids"],
        "holdout_parsed": holdout_fields["holdout_parsed"],
        "holdout_evidence_support_rate": holdout_fields["holdout_evidence_support_rate"],
        "holdout_unsupported_ids": holdout_fields["holdout_unsupported_ids"],
    }
