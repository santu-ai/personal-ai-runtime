#!/usr/bin/env python
"""LLM Egress verification."""

from __future__ import annotations

from pathlib import Path

import sys

_BACKEND = str(Path(__file__).resolve().parents[1])
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from scripts._bootstrap import ephemeral_kernel


def main() -> int:
    violations: list[str] = []
    with ephemeral_kernel("verify_egress.db", install_singleton=True) as (_db, k):
        from app.core.runtime.egress.egress_gate import (
            audit_llm_egress,
            classify_llm_payload,
            provider_is_local,
        )

        messages = [
            {
                "role": "user",
                "content": "identity_narrative_opt_in claim_status proposed",
            }
        ]
        outbound, audit = audit_llm_egress(messages, purpose="verify")
        if not audit.get("classification"):
            violations.append("egress: missing classification")
        if "identity_surface" not in audit["classification"]["categories"]:
            violations.append("egress: expected identity_surface classification")
        if not audit.get("identity_surface_detected"):
            violations.append("egress: expected identity_surface_detected flag")
        if outbound != messages:
            violations.append("egress: audit-only path must not mutate outbound messages")

        events = k.read_events(type="EgressAudited", order="desc", limit=1)
        if not events:
            violations.append("egress: EgressAudited event not emitted")

        general, audit2 = audit_llm_egress(
            [{"role": "user", "content": "hello world"}], purpose="verify_general"
        )
        if audit2["classification"]["categories"] != ["general"]:
            violations.append(
                f"egress: general misclassified {audit2['classification']['categories']}"
            )
        if general[0]["content"] != "hello world":
            violations.append("egress: general content must pass through unchanged")

        if provider_is_local("ollama", "https://remote.example.invalid"):
            violations.append("egress: remote ollama must not be local")
        if not provider_is_local("ollama", "http://127.0.0.1:11434/v1"):
            violations.append("egress: loopback ollama must be local")
        if not provider_is_local(None, "http://localhost:11434/v1"):
            violations.append("egress: loopback host must be local without a provider type")
        labeled = classify_llm_payload(
            [{"role": "user", "content": "周五例会改到下午", "data_sources": ["email"]}],
        )
        if "email_source" not in labeled["categories"]:
            violations.append("egress: declared email source was not classified")
        unlabeled = classify_llm_payload(
            [{"role": "user", "content": "周五例会改到下午"}],
        )
        if unlabeled["categories"] != ["general"]:
            violations.append(
                f"egress: unlabeled prose misclassified {unlabeled['categories']}"
            )

    if violations:
        print("EGRESS VERIFICATION FAILED", file=sys.stderr)
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        return 1

    print("EGRESS VERIFICATION PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
