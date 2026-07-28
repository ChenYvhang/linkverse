"""Unified HTTP client: timeout + exponential backoff retry for all outbound calls.

Used by every external integration (YouTube, vision model, DeepSeek) so that
timeout/retry/backoff behavior is defined exactly once, per project rule:
"所有外部调用：超时、重试、退避、限流、缓存，一个不能少".
"""
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

import requests

from pipeline.common.logging import get_logger

logger = get_logger("http")

CONNECT_TIMEOUT = 5
READ_TIMEOUT = 30
MAX_RETRIES = 3
BACKOFF_BASE_SECONDS = 2  # 2s, 4s, 8s — free-tier vision API needs real recovery time on 429


def request_with_retry(method: str, url: str, **kwargs) -> requests.Response:
    """requests call with fixed timeout and exponential backoff on failure.

    Retries on network errors, timeouts, and 5xx/429 responses.
    Raises the last exception (or returns the last response) if all retries fail,
    so callers can decide to skip-and-log rather than silently substitute data.
    """
    kwargs.setdefault("timeout", (CONNECT_TIMEOUT, READ_TIMEOUT))
    last_exc = None
    last_response = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.request(method, url, **kwargs)
            if response.status_code == 429 or response.status_code >= 500:
                last_response = response
                raise requests.HTTPError(f"retryable status {response.status_code}")
            return response
        except (requests.RequestException,) as exc:
            last_exc = exc
            if attempt == MAX_RETRIES:
                break
            sleep_s = BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
            logger.warning(
                "request failed (attempt %d/%d) for %s: %s — retrying in %ss",
                attempt, MAX_RETRIES, url, exc, sleep_s,
            )
            time.sleep(sleep_s)
    if last_response is not None:
        return last_response
    raise last_exc


def get_json(url: str, **kwargs) -> dict:
    response = request_with_retry("GET", url, **kwargs)
    response.raise_for_status()
    return response.json()


def post_json(url: str, **kwargs) -> dict:
    response = request_with_retry("POST", url, **kwargs)
    response.raise_for_status()
    return response.json()


def post_json_once(url: str, **kwargs) -> dict:
    """Single attempt, no internal retry — for callers that apply their own
    retry loop around a wall-clock timeout (see call_with_wall_clock_timeout),
    so a slow attempt doesn't get retried 3x *inside* an already-retried call.
    """
    kwargs.setdefault("timeout", (CONNECT_TIMEOUT, READ_TIMEOUT))
    response = requests.request("POST", url, **kwargs)
    response.raise_for_status()
    return response.json()


def get_bytes(url: str, **kwargs) -> bytes:
    response = request_with_retry("GET", url, **kwargs)
    response.raise_for_status()
    return response.content


def call_with_wall_clock_timeout(func, timeout_seconds: float, *args, **kwargs):
    """Run func(*args, **kwargs) with a hard wall-clock deadline.

    requests' `timeout=(connect, read)` only bounds the gap between bytes, not
    total call time — a server that trickles data (or a slow proxy) can stall
    a call far past that timeout while individual reads keep succeeding. This
    wraps the call in a worker thread and gives up waiting after
    timeout_seconds regardless, so a single request can't hang the pipeline
    for minutes.

    Deliberately NOT a `with ThreadPoolExecutor(...) as pool:` block: the
    executor's __exit__ calls shutdown(wait=True), which blocks until the
    submitted call finishes — silently defeating the timeout it's supposed to
    enforce. shutdown(wait=False) here lets us give up and return control to
    the caller immediately; the abandoned worker thread finishes on its own
    (Python's atexit hook will still join it at interpreter shutdown, so the
    process won't exit until it does, but the calling code isn't blocked).
    """
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(func, *args, **kwargs)
    try:
        result = future.result(timeout=timeout_seconds)
        pool.shutdown(wait=False)
        return result
    except FutureTimeoutError:
        pool.shutdown(wait=False)
        raise TimeoutError(f"{func.__name__} exceeded wall-clock timeout of {timeout_seconds}s")
