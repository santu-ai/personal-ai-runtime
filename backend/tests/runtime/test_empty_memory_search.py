"""空记忆库不做向量检索，避免为一次空查询加载默认 embedding。"""

from app.store.vector import VectorStore


class _EmptyCollection:
    def count(self):
        return 0

    def query(self, **kwargs):
        raise AssertionError(f"empty collection must not query: {kwargs}")


class _FilledCollection:
    def __init__(self):
        self.queries = []

    def count(self):
        return 2

    def query(self, **kwargs):
        self.queries.append(kwargs)
        return {
            "ids": [["mem-1"]],
            "documents": [["记下的一句"]],
            "metadatas": [[{"kind": "note"}]],
            "distances": [[0.2]],
        }


class _BrokenCount:
    def count(self):
        raise RuntimeError("count unavailable")

    def query(self, **kwargs):
        return {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]}


def _store(collection):
    store = VectorStore.__new__(VectorStore)
    store.memory_collection = collection
    return store


def test_empty_collection_skips_embedding_query():
    rows = _store(_EmptyCollection()).search_memories_batch(["recent goals"], n_results=5)
    assert rows == [[]]


def test_nonempty_collection_still_queries():
    collection = _FilledCollection()
    rows = _store(collection).search_memories_batch(["recent goals"], n_results=5)
    assert collection.queries[0]["query_texts"] == ["recent goals"]
    assert rows[0][0]["id"] == "mem-1"
    assert rows[0][0]["content"] == "记下的一句"


def test_count_failure_falls_back_to_query():
    rows = _store(_BrokenCount()).search_memories_batch(["recent goals"])
    assert rows == [[]]
