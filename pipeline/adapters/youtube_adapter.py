"""YouTube Data API v3 adapter — the sole PlatformAdapter implementation.

Compliance notes (read before touching this file):
- Only public data via the official Data API v3; no login, no captcha bypass.
- Respects API ToS; every call goes through common.http (timeout + backoff)
  and common.quota (hard unit/call caps), so we never silently overshoot.
- No contact info of any kind is collected or stored.
"""
from pipeline.adapters.platform_base import PlatformAdapter
from pipeline.common.http import get_json
from pipeline.common.logging import get_logger
from pipeline.common.quota import QuotaTracker

logger = get_logger("youtube_adapter")

BASE_URL = "https://www.googleapis.com/youtube/v3"


def _chunk(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


class YouTubeAdapter(PlatformAdapter):
    name = "youtube"

    def __init__(self, api_key: str, quota: QuotaTracker):
        if not api_key:
            raise ValueError("YOUTUBE_API_KEY is required")
        self.api_key = api_key
        self.quota = quota

    def _get(self, endpoint: str, params: dict) -> dict:
        params = {**params, "key": self.api_key}
        return get_json(f"{BASE_URL}/{endpoint}", params=params)

    def discover_seed_channels(self, seeds: list[dict], max_search_calls: int, search_type: str = "video") -> dict[str, str]:
        """search_type='video' (original): search for videos, extract the posting
        channel's id from snippet.channelId. search_type='channel' (added for the
        2000+ channel expansion, REFACTOR_PLAN.md §3.1): search for channels
        directly, id.channelId — YouTube's ranking for the two search types
        differs enough that the same keyword surfaces a different channel set,
        which is why the expansion re-queries the original keywords too instead
        of only adding new ones."""
        channel_vertical: dict[str, str] = {}
        calls_made = 0
        for seed in seeds:
            keyword, vertical = seed["keyword"], seed["vertical"]
            if calls_made >= max_search_calls:
                logger.info("hit max_search_calls=%d, stopping seed discovery", max_search_calls)
                break
            try:
                self.quota.charge("search", calls=1)
            except Exception:
                logger.warning("search.list quota/cap reached, stopping seed discovery early")
                break
            calls_made += 1
            try:
                data = self._get(
                    "search",
                    {
                        "part": "snippet",
                        "q": keyword,
                        "type": search_type,
                        "maxResults": 50,
                        "relevanceLanguage": "en" if keyword.isascii() else "zh-Hans",
                        "order": "relevance",
                    },
                )
            except Exception as exc:
                logger.warning("search.list failed for keyword=%r (type=%s): %s — skipping", keyword, search_type, exc)
                continue
            items = data.get("items", [])
            found = 0
            for item in items:
                if search_type == "channel":
                    cid = item.get("id", {}).get("channelId")
                else:
                    cid = item.get("snippet", {}).get("channelId")
                if cid and cid not in channel_vertical:
                    channel_vertical[cid] = vertical
                    found += 1
            logger.info("keyword=%r (type=%s) -> %d new channels (total %d)", keyword, search_type, found, len(channel_vertical))
        return channel_vertical

    def fetch_channel_snapshots(self, channel_ids: list[str]) -> list[dict]:
        results = []
        for batch in _chunk(channel_ids, 50):
            self.quota.charge("channels", calls=1)
            try:
                data = self._get(
                    "channels",
                    {"part": "snippet,statistics,contentDetails", "id": ",".join(batch)},
                )
            except Exception as exc:
                logger.warning("channels.list failed for batch of %d ids: %s — skipping batch", len(batch), exc)
                continue
            for item in data.get("items", []):
                snippet = item.get("snippet", {})
                stats = item.get("statistics", {})
                uploads_id = (
                    item.get("contentDetails", {})
                    .get("relatedPlaylists", {})
                    .get("uploads")
                )
                results.append(
                    {
                        "channel_id": item.get("id"),
                        "title": snippet.get("title"),
                        "description": snippet.get("description"),
                        "country": snippet.get("country"),
                        "published_at": snippet.get("publishedAt"),
                        "subscriber_count": int(stats.get("subscriberCount", 0)) if not stats.get("hiddenSubscriberCount") else None,
                        "view_count_total": int(stats.get("viewCount", 0)),
                        "video_count_total": int(stats.get("videoCount", 0)),
                        "uploads_playlist_id": uploads_id,
                    }
                )
        return results

    def fetch_uploads_video_ids(self, uploads_playlist_id: str, max_results: int = 50) -> list[str]:
        if not uploads_playlist_id:
            return []
        self.quota.charge("playlistItems", calls=1)
        try:
            data = self._get(
                "playlistItems",
                {
                    "part": "contentDetails",
                    "playlistId": uploads_playlist_id,
                    "maxResults": max_results,
                },
            )
        except Exception as exc:
            logger.warning("playlistItems.list failed for playlist=%s: %s — skipping", uploads_playlist_id, exc)
            return []
        return [
            item["contentDetails"]["videoId"]
            for item in data.get("items", [])
            if "videoId" in item.get("contentDetails", {})
        ]

    def fetch_video_details(self, video_ids: list[str]) -> list[dict]:
        results = []
        for batch in _chunk(video_ids, 50):
            self.quota.charge("videos", calls=1)
            try:
                data = self._get(
                    "videos",
                    {"part": "snippet,statistics,contentDetails", "id": ",".join(batch)},
                )
            except Exception as exc:
                logger.warning("videos.list failed for batch of %d ids: %s — skipping batch", len(batch), exc)
                continue
            for item in data.get("items", []):
                snippet = item.get("snippet", {})
                stats = item.get("statistics", {})
                content = item.get("contentDetails", {})
                thumbnails = snippet.get("thumbnails", {})
                high_thumb = thumbnails.get("high") or thumbnails.get("medium") or thumbnails.get("default")
                results.append(
                    {
                        "video_id": item.get("id"),
                        "title": snippet.get("title"),
                        "description": snippet.get("description"),
                        "published_at": snippet.get("publishedAt"),
                        "tags": snippet.get("tags", []),
                        "view_count": int(stats.get("viewCount", 0)),
                        "like_count": int(stats.get("likeCount", 0)) if "likeCount" in stats else None,
                        "comment_count": int(stats.get("commentCount", 0)) if "commentCount" in stats else None,
                        "duration": content.get("duration"),
                        "thumbnail_url": high_thumb.get("url") if high_thumb else None,
                    }
                )
        return results
