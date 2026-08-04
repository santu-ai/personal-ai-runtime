"""ChromaDB 向量存储管理 —— 用于语义搜索与记忆。"""

import json
import logging
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any, TypedDict

from app.store.bound_proxy import BoundProxy


class VectorSearchResult(TypedDict):
    id: str
    content: str
    metadata: dict[str, Any]
    distance: float | None


# 在 chromadb import 触及 posthog 之前先关闭 ChromaDB 遥测。
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("CHROMA_TELEMETRY_IMPL", "none")
os.environ.setdefault("CHROMA_TELEMETRY_ENABLED", "false")

# 可选：旧版 Chroma 会拉入 posthog；若存在则 patch 掉 capture。
try:
    import posthog  # noqa: E402
except ImportError:
    posthog = None  # type: ignore[assignment]
else:
    def _safe_capture(*args: Any, **kwargs: Any) -> None:
        return None

    posthog.capture = _safe_capture  # type: ignore[assignment]

import chromadb  # noqa: E402
from chromadb.config import Settings as ChromaSettings  # noqa: E402
from chromadb.utils.embedding_functions import DefaultEmbeddingFunction  # noqa: E402

logger = logging.getLogger(__name__)

# 钉死 Chroma 0.5.x / 1.x 自带的默认 ONNX MiniLM L6 v2 路径，
# 防止升级时悄悄切换 embedding 模型或维度。
# 类型标注为 Any：chromadb 的 stub 期望一个比 DefaultEmbeddingFunction 声明更宽的
# EmbeddingFunction 协议。
_EMBEDDING_FUNCTION: Any = DefaultEmbeddingFunction()

# Chroma 0.5.x 在面对老库留下的空 config_json_str（'{}'）时会抛 KeyError: '_type'，
# 该 JSON 是合法的 CollectionConfigurationInternal 默认配置。
_DEFAULT_COLLECTION_CONFIG_JSON = json.dumps({
    "hnsw_configuration": {
        "space": "l2",
        "ef_construction": 100,
        "ef_search": 10,
        "num_threads": 16,
        "M": 16,
        "resize_factor": 1.2,
        "batch_size": 100,
        "sync_threshold": 1000,
        "_type": "HNSWConfigurationInternal",
    },
    "_type": "CollectionConfigurationInternal",
})


def _repair_empty_collection_configs(vector_dir: str | Path) -> int:
    """将 config_json_str 为空或 '{}' 的 collection 修补为合法默认值。

    返回更新的行数。
    """
    db_path = Path(vector_dir) / "chroma.sqlite3"
    if not db_path.is_file():
        return 0

    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.execute(
            "UPDATE collections SET config_json_str = ? "
            "WHERE config_json_str IS NULL OR TRIM(config_json_str) IN ('', '{}')",
            (_DEFAULT_COLLECTION_CONFIG_JSON,),
        )
        conn.commit()
        return int(cur.rowcount or 0)
    except Exception:
        logger.warning(
            "Failed to repair Chroma collection configs at %s", db_path, exc_info=True
        )
        return 0
    finally:
        conn.close()


class VectorStore:
    """管理用于 memory embedding 的 ChromaDB collection。"""

    def __init__(self):
        # 在调用期解析 settings，让测试的 reset_settings() 生效。
        from app.config import settings

        # 老库可能存在空 config_json_str；要在 PersistentClient 列举 collection
        # 之前修补（Chroma 0.5.x 要求 JSON 含 '_type'）。
        repaired = _repair_empty_collection_configs(settings.vector_dir)
        if repaired:
            logger.info(
                "Repaired %d Chroma collection config(s) in %s",
                repaired,
                settings.vector_dir,
            )

        self.client = chromadb.PersistentClient(
            path=settings.vector_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        self._init_collections()

    def _init_collections(self):
        """若 collection 不存在则创建。"""
        # 仅放描述性 metadata。不要把 hnsw:space 写进 metadata —— 在
        # Chroma 0.5.x 上它不会改变真正的 HNSW 配置（仍是 L2），只会造成误导。
        # 已有索引都使用 L2。
        self.memory_collection = self.client.get_or_create_collection(
            name="memories",
            embedding_function=_EMBEDDING_FUNCTION,
            metadata={"description": "Long-term user memories and preferences"},
        )

    def add_memory(
        self, content: str, metadata: dict | None = None, memory_id: str | None = None
    ) -> str:
        """存储一条带 embedding 的 memory，返回 embedding ID。"""
        mid = memory_id or str(uuid.uuid4())
        self.memory_collection.add(
            ids=[mid],
            documents=[content],
            metadatas=[metadata or {}],
        )
        return mid

    def index_memory(
        self, content: str, metadata: dict | None = None, memory_id: str | None = None
    ) -> str:
        """MemoryIndexPort 实现 —— 以 memory_id 为键的幂等索引。

        委托给 add_memory，但会先删除该 memory_id 的既有条目，
        避免重复索引（如 MemoryUpdated）产生重复 embedding。
        """
        if memory_id:
            try:
                self.memory_collection.delete(ids=[memory_id])
            except Exception:
                pass  # 不存在也没关系
        return self.add_memory(content, metadata=metadata, memory_id=memory_id)

    def search_memories(self, query: str, n_results: int = 5) -> list[VectorSearchResult]:
        """对相关 memory 做语义搜索。"""
        batch = self.search_memories_batch([query], n_results=n_results)
        return batch[0] if batch else []

    def search_memories_batch(
        self, queries: list[str], n_results: int = 5
    ) -> list[list[VectorSearchResult]]:
        """批量语义搜索 —— 多个 query 共一次 Chroma 往返。

        返回与 ``queries`` 对齐的列表；每个元素是对应 query 的命中列表。
        """
        if not queries:
            return []
        results = self.memory_collection.query(
            query_texts=queries,
            n_results=n_results,
        )
        return self._parse_search_results(results, len(queries))

    def _parse_search_results(self, results: Any, num_queries: int) -> list[list[VectorSearchResult]]:
        """将 ChromaDB QueryResult 解析为嵌套列表的内部辅助。"""
        batches: list[list[VectorSearchResult]] = []

        # Chroma 返回 None 或嵌套 list
        ids_by_q = results.get("ids") or []
        docs_by_q = results.get("documents") or []
        metas_by_q = results.get("metadatas") or []
        dists_by_q = results.get("distances") or []

        for q_idx in range(num_queries):
            items: list[VectorSearchResult] = []
            if q_idx < len(ids_by_q) and ids_by_q[q_idx]:
                q_ids = ids_by_q[q_idx]
                q_docs = docs_by_q[q_idx] if docs_by_q and q_idx < len(docs_by_q) else []
                q_metas = metas_by_q[q_idx] if metas_by_q and q_idx < len(metas_by_q) else []
                q_dists = dists_by_q[q_idx] if dists_by_q and q_idx < len(dists_by_q) else []

                for i in range(len(q_ids)):
                    items.append({
                        "id": q_ids[i],
                        "content": q_docs[i] if i < len(q_docs) and q_docs[i] else "",
                        "metadata": q_metas[i] if i < len(q_metas) and q_metas[i] else {},
                        "distance": q_dists[i] if i < len(q_dists) else None,
                    })
            batches.append(items)
        return batches

    def delete_memory(self, memory_id: str):
        """按 ID 删除 memory。"""
        self.memory_collection.delete(ids=[memory_id])

    def list_memory_ids(self) -> list[str]:
        """返回向量索引中全部 memory ID。"""
        result = self.memory_collection.get(include=[])
        return list(result.get("ids") or [])


vector_store = BoundProxy()


def bind_vector_store_factory(factory) -> None:
    """将模块级 ``vector_store`` 绑定到 RuntimeContainer（仅由 runtime 调用）。"""
    vector_store.bind(factory)
