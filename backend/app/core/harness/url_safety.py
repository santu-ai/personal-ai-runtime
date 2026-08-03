"""HTTP 抓取类工具的 URL 安全检查——SSRF 防护。

两层防御：

1. ``validate_http_url`` —— 请求前的 URL 校验（scheme、hostname、DNS）。
   ``shell.py`` 的 curl/wget 及抓取工具的首道闸门使用它。

2. ``create_ssrf_safe_async_client`` —— DNS 钉扎传输层：把每次出站连接
   固定到「请求时解析并校验」的 IP 上，消除校验钩子与 httpx 自行解析之间
   的 TOCTOU/DNS-rebinding 窗口。若不做钉扎，恶意权威解析器可在 TTL=0
   时先给校验钩子返回公网 IP，再在 httpx 真正建连时改指 127.0.0.1 /
   169.254.169.254。
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from typing import Any
from urllib.parse import urlparse

import httpx


class UnsafeUrlError(ValueError):
    """目标 URL 命中禁止的主机或 scheme。"""


def _is_blocked_ip(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """判断某 IP 是否禁止出站访问。

    IPv4-mapped IPv6（``::ffff:x.x.x.x``）需按内嵌的 IPv4 地址再判一次——
    部分平台在映射形态上报告的标志位不可靠。
    """
    mapped = getattr(addr, "ipv4_mapped", None)
    if mapped is not None:
        return _is_blocked_ip(mapped)
    if (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    ):
        return True
    return False


def _resolve_and_check(hostname: str) -> list[str]:
    """解析 ``hostname`` 并返回全部公网 IP 字符串。

    主机被禁或无法解析时抛 UnsafeUrlError。所有返回地址都单独校验——
    只要一个主机名混合了公网与私网记录，就整体拒绝。

    不做跨请求 DNS 缓存：正向缓存会让预检闸门（shell curl/wget、mesh
    Playwright 参数）先放行某主机，而该主机的 A/AAAA 记录在 TTL 窗口内
    随后翻转为私网地址。
    """
    host = hostname.strip().lower().rstrip(".")
    if not host:
        raise UnsafeUrlError("Empty hostname")
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".localhost"):
        raise UnsafeUrlError(f"Blocked hostname: {hostname}")

    # 字面量 IP 直接校验，无需 DNS。
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if _is_blocked_ip(ip):
            raise UnsafeUrlError(f"Blocked IP literal: {host}")
        return [host]

    ips: list[str] = []
    try:
        for family, _, _, _, sockaddr in socket.getaddrinfo(host, None):
            if family not in (socket.AF_INET, socket.AF_INET6):
                continue
            ip_str = str(sockaddr[0])
            if _is_blocked_ip(ipaddress.ip_address(ip_str)):
                raise UnsafeUrlError(
                    f"Hostname {hostname!r} resolves to blocked address {ip_str}"
                )
            if ip_str not in ips:
                ips.append(ip_str)
    except socket.gaierror as exc:
        raise UnsafeUrlError(f"Could not resolve {hostname!r}: {exc}") from exc

    if not ips:
        raise UnsafeUrlError(f"Hostname {hostname!r} has no usable records")
    return ips


async def resolve_and_check_async(hostname: str) -> list[str]:
    """异步封装——把阻塞式 DNS 移出事件循环。"""
    return await asyncio.to_thread(_resolve_and_check, hostname)


def _hostname_blocked(hostname: str) -> bool:
    """预检用的向后兼容布尔封装。"""
    try:
        _resolve_and_check(hostname)
    except UnsafeUrlError:
        return True
    return False


def _validate_url_parts(url: str) -> tuple[str, str]:
    """解析并校验 scheme/凭据/hostname 存在性，返回 (归一化 URL, hostname)。"""
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise UnsafeUrlError(f"Unsupported URL scheme: {parsed.scheme or '(none)'}")

    hostname = parsed.hostname
    if not hostname:
        raise UnsafeUrlError("URL missing hostname")

    if parsed.username or parsed.password:
        raise UnsafeUrlError("URLs with embedded credentials are not allowed")

    return parsed.geturl(), hostname


def validate_http_url(url: str) -> str:
    """校验出站 HTTP(S) 抓取 URL，返回归一化 URL 字符串。

    执行 scheme/凭据检查与「预检」DNS 解析。这是非 httpx 工具（``shell.py``
    的 curl/wget）的正确闸门；httpx 调用方还需用
    ``create_ssrf_safe_async_client`` 把连接在 socket 层固定到已解析 IP。
    """
    normalized, hostname = _validate_url_parts(url)
    if _hostname_blocked(hostname):
        raise UnsafeUrlError(f"Blocked hostname: {hostname}")
    return normalized


async def validate_http_url_async(url: str) -> str:
    """``validate_http_url`` 的异步变体——DNS 经 ``asyncio.to_thread``。"""
    normalized, hostname = _validate_url_parts(url)
    try:
        await resolve_and_check_async(hostname)
    except UnsafeUrlError as exc:
        raise UnsafeUrlError(f"Blocked hostname: {hostname}") from exc
    return normalized


def _pin_url_to_ip(url: str, ip: str) -> str:
    """把 ``url`` 的主机改写为字面量 ``ip``，保留端口。

    IPv6 字面量按 RFC 3986 加方括号（``[2001:db8::1]``），避免地址中的
    冒号被误判为端口分隔符。Host 头（用于 TLS SNI 与虚拟主机路由）由
    ``_restore_host_header`` 单独恢复，让源站仍看到原始域名。
    """
    parsed = urlparse(url)
    # 识别 IPv6 字面量（含冒号且未加括号）。
    if ":" in ip and not ip.startswith("["):
        host_part = f"[{ip}]"
    else:
        host_part = ip
    if parsed.port:
        netloc = f"{host_part}:{parsed.port}"
    else:
        netloc = host_part
    return parsed._replace(netloc=netloc).geturl()


def _restore_host_header(request: httpx.Request, original_host: str) -> None:
    """恢复 Host 为原始主机名，保证 TLS SNI / 虚拟主机路由正确。"""
    request.headers["Host"] = original_host


class SSRFSafeTransport(httpx.AsyncBaseTransport):
    """把每个请求钉扎到经校验解析 IP 的异步传输层。

    按请求解析可关闭 DNS-rebinding 窗口：请求时校验的 IP 与 socket 实际
    连接的 IP 一致。任一解析结果在连接前都会经 ``_is_blocked_ip`` 检查。
    """

    def __init__(self, **kwargs: Any) -> None:
        # follow_redirects 归 httpx.AsyncClient 管，不属于传输层。
        kwargs.pop("follow_redirects", None)
        self._inner = httpx.AsyncHTTPTransport(**kwargs)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise UnsafeUrlError(f"Unsupported URL scheme: {parsed.scheme or '(none)'}")
        if parsed.username or parsed.password:
            raise UnsafeUrlError("URLs with embedded credentials are not allowed")

        hostname = parsed.hostname
        if not hostname:
            raise UnsafeUrlError("URL missing hostname")

        ips = await resolve_and_check_async(hostname)
        pinned_ip = ips[0]
        # Host 头保留原始端口，非标准端口的 HTTP 虚拟主机路由才正确；
        # SNI 只关心域名，但带上端口对 TLS 无副作用。
        original_host = f"{hostname}:{parsed.port}" if parsed.port else hostname

        # 改写 URL 前先物化请求体。直接复用 ``request.stream`` 在
        # POST/PUT/PATCH 会失败——该流是单次消费的 SyncByteStream，
        # 无法重放进新 Request。传输层入口处请求体尚未被消费，此处
        # 读到 bytes 是安全的。
        body_bytes = await request.aread()

        pinned_url = _pin_url_to_ip(url, pinned_ip)
        # URL 主机是 IP 字面量时，TLS 仍需用原始主机名做 SNI 与证书校验，
        # 否则 OpenSSL 会拿 IP 对证书校验并报
        # "certificate is not valid for '<ip>'"。
        extensions = dict(request.extensions)
        if parsed.scheme == "https":
            extensions["sni_hostname"] = hostname
        pinned_request = request.__class__(
            method=request.method,
            url=pinned_url,
            headers=request.headers,
            content=body_bytes,
            extensions=extensions,
        )
        _restore_host_header(pinned_request, original_host)
        return await self._inner.handle_async_request(pinned_request)


async def _validate_redirect_target(response: httpx.Response) -> None:
    """用同一套主机校验检查重定向目标。

    钉扎传输层已对重定向的实际请求强制钉扎；此钩子额外对明显指向内网的
    重定向目标做显式、带日志的拒绝（纵深防御）。
    """
    if response.is_redirect and response.next_request is not None:
        await validate_http_url_async(str(response.next_request.url))


def create_ssrf_safe_async_client(**kwargs: Any) -> httpx.AsyncClient:
    """构建出站连接 DNS 钉扎的 httpx 客户端。

    传输层把每个请求钉扎到「请求时解析并校验」的 IP，解析器无法在
    校验与建连之间翻转记录（DNS rebinding）来把 socket 指向私网地址。
    响应钩子仍校验重定向目标，作为纵深防御。
    """
    follow_redirects = kwargs.pop("follow_redirects", True)
    transport = SSRFSafeTransport()
    hooks = dict(kwargs.pop("event_hooks", {}))
    response_hooks = [_validate_redirect_target, *hooks.get("response", [])]
    return httpx.AsyncClient(
        transport=transport,
        follow_redirects=follow_redirects,
        event_hooks={"response": response_hooks} if response_hooks else None,
        **kwargs,
    )
