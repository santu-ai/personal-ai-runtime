"""通知通道——可插拔的外部投递（桌面、webhook、ntfy）。

应用内 / WebSocket 扇出留在 ``notification_bridge``（持久化 + WS）。
本模块负责 cron 摘要与 product 任务使用的*外部*通道。

需要通知也出现在应用内通知中心时，用
``NotificationRouter.notify(..., persist=True)``（取代原先分开的
``create_notification`` + ``notify`` 调用对）。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.runtime.kernel import Kernel

logger = logging.getLogger(__name__)


@dataclass
class NotificationPayload:
    title: str
    content: str
    type: str = "system"
    priority: str = "normal"  # low, normal, high


class BaseChannel:
    """抽象通知通道。"""

    async def send(self, payload: NotificationPayload) -> bool:
        raise NotImplementedError


class DesktopChannel(BaseChannel):
    """经共享 notification_bridge 传输层的桌面 / UI 提示。"""

    async def send(self, payload: NotificationPayload) -> bool:
        try:
            from app.core.runtime.notification_bridge import broadcast_event

            broadcast_event({
                "type": "desktop_notification",
                "title": payload.title,
                "content": payload.content,
                "notification_type": payload.type,
            })
            return True
        except Exception:
            logger.warning("Desktop notification failed", exc_info=True)
            return False


class WebhookChannel(BaseChannel):
    """通用 webhook 通知（取代 Telegram）。

    把 JSON POST 到用户配置的 webhook URL。
    """

    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url

    async def send(self, payload: NotificationPayload) -> bool:
        if not self.webhook_url:
            return False
        try:
            import httpx

            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    self.webhook_url,
                    json={
                        "title": payload.title,
                        "content": payload.content,
                        "type": payload.type,
                        "source": "Personal AI Runtime",
                    },
                )
                if response.status_code >= 400:
                    logger.warning(
                        "Webhook notification failed: HTTP %d", response.status_code
                    )
                    return False
                return True
        except Exception:
            logger.warning("Webhook notification failed", exc_info=True)
            return False


class NtfyChannel(BaseChannel):
    """ntfy.sh 推送通道。"""

    def __init__(self, topic: str, server: str = "https://ntfy.sh"):
        self.topic = topic
        self.server = server

    async def send(self, payload: NotificationPayload) -> bool:
        if not self.topic:
            return False
        try:
            import httpx

            url = f"{self.server}/{self.topic}"
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    url,
                    content=payload.content.encode("utf-8"),
                    headers={
                        "Title": payload.title,
                        "Priority": payload.priority,
                        "Tags": "robot",
                    },
                )
                return response.status_code < 400
        except Exception:
            logger.warning("ntfy notification failed", exc_info=True)
            return False


class NotificationRouter:
    """把通知路由到已配置通道（+ 可选应用内持久化）。"""

    def __init__(self):
        self.desktop = DesktopChannel()
        self.webhook: WebhookChannel | None = None
        self.ntfy: NtfyChannel | None = None

    def configure(
        self,
        webhook_url: str = "",
        ntfy_topic: str = "",
        ntfy_server: str = "https://ntfy.sh",
    ):
        if webhook_url:
            self.webhook = WebhookChannel(webhook_url)
        else:
            self.webhook = None

        if ntfy_topic:
            self.ntfy = NtfyChannel(ntfy_topic, ntfy_server)
        else:
            self.ntfy = None

    async def notify(
        self,
        title: str,
        content: str,
        type_: str = "system",
        priority: str = "normal",
        *,
        persist: bool = False,
        kernel: "Kernel | None" = None,
        dedup_key: str | None = None,
    ) -> dict:
        """投递给桌面 / webhook / ntfy。

        ``persist=True`` 时，还经 ``notification_bridge.push_notification``
        写应用内通知（并跳过额外桌面 WS 提示——持久化路径已广播）。
        ``dedup_key`` 只作用于持久化路径，用来按日/实体分桶，避免
        ``create_notification`` 的 type+title 幂等把后续通知折叠掉。
        """
        payload = NotificationPayload(
            title=title, content=content, type=type_, priority=priority
        )
        results: dict[str, bool] = {}

        if persist:
            from app.core.runtime.notification_bridge import push_notification

            push_notification(
                type_, title, content, kernel=kernel, dedup_key=dedup_key,
            )
            results["persisted"] = True
        else:
            results["desktop"] = await self.desktop.send(payload)

        if self.webhook:
            results["webhook"] = await self.webhook.send(payload)

        if self.ntfy:
            results["ntfy"] = await self.ntfy.send(payload)

        logger.info(
            "Notification sent: title=%s channels=%s",
            title,
            json.dumps(results),
        )
        return results


notification_router = NotificationRouter()
