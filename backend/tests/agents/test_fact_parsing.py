"""parse_facts_from_text 的单元测试。

这是记忆抽取共用的纯解析函数：本地(Ollama)与云端(failover)两条路径
都靠它把 LLM 返回文本拆成逐条事实，行为必须保持一致。
"""

from app.core.agents.fact_parsing import parse_facts_from_text


def test_parses_one_fact_per_line():
    assert parse_facts_from_text("喜欢 Python\n住在上海") == ["喜欢 Python", "住在上海"]


def test_strips_bullet_markers():
    assert parse_facts_from_text("- 喜欢 Python\n  - 住在上海") == ["喜欢 Python", "住在上海"]


def test_drops_blank_and_whitespace_lines():
    assert parse_facts_from_text("喜欢 Python\n\n   \n住在上海") == ["喜欢 Python", "住在上海"]


def test_empty_text_returns_empty_list():
    assert parse_facts_from_text("") == []
    assert parse_facts_from_text("   ") == []


def test_strips_leading_trailing_whitespace_per_line():
    assert parse_facts_from_text("  喜欢 Python  \n  住在上海  ") == ["喜欢 Python", "住在上海"]
