"""记忆抽取共用纯函数。

本地(Ollama)与云端(failover)两个记忆抽取路径各自组装 prompt，
但把 LLM 返回文本解析为"逐条事实"的规则完全一致，统一收口于此。
"""

from __future__ import annotations


def parse_facts_from_text(text: str) -> list[str]:
    """把 LLM 返回的文本解析为事实列表。

    模型输出约定：每条事实占一行，允许以 "- " 开头的行（无 bullet 要求
    时模型也常带）。过滤空行与仅空白行。
    """
    return [line.strip("- ").strip() for line in text.split("\n") if line.strip()]
