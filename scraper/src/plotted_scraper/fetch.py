"""Polite, cached HTTP fetching for catalog pages."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

import httpx

USER_AGENT = "PlottedCatalogBot/0.1 (student degree planner; low-volume, cached)"
CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache" / "pages"
MIN_INTERVAL_S = 1.0

_last_request = 0.0
_client: httpx.Client | None = None


def _cache_path(url: str) -> Path:
    return CACHE_DIR / (hashlib.sha256(url.encode()).hexdigest()[:24] + ".html")


def fetch(url: str, *, refresh: bool = False) -> str:
    """Return the page body, from cache when possible; at most 1 request/second."""
    global _last_request, _client
    path = _cache_path(url)
    if path.exists() and not refresh:
        return path.read_text(encoding="utf-8")

    if _client is None:
        _client = httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30, follow_redirects=True)
    for attempt in range(4):
        wait = MIN_INTERVAL_S - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        try:
            resp = _client.get(url)
            _last_request = time.monotonic()
            if resp.status_code >= 500 or resp.status_code == 429:
                raise httpx.HTTPStatusError("retryable", request=resp.request, response=resp)
            resp.raise_for_status()
            break
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            _last_request = time.monotonic()
            retryable = (
                isinstance(exc, httpx.TransportError)
                or exc.response.status_code >= 500
                or exc.response.status_code == 429
            )
            if attempt == 3 or not retryable:
                raise
            time.sleep(2 ** (attempt + 1))  # 2s, 4s, 8s

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(resp.text, encoding="utf-8")
    return resp.text
