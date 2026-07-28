"""Abstract base for creator-data platform adapters.

YouTube is the only implementation this project ships. TikTok / 抖音 / 小红书 /
B站 are deliberately left unimplemented — see web system-status page, which
lists them as "待接入". We do not stub fake implementations of those; an
adapter either exists and is real, or it doesn't exist yet.
"""
from abc import ABC, abstractmethod


class PlatformAdapter(ABC):
    name: str

    @abstractmethod
    def discover_seed_channels(self, seeds: list[dict], max_search_calls: int) -> dict[str, str]:
        """Search each {keyword, vertical} seed and return {channel_id: vertical} for first match.

        Capped at max_search_calls total search requests regardless of seed count.
        """

    @abstractmethod
    def fetch_channel_snapshots(self, channel_ids: list[str]) -> list[dict]:
        """Return channel-level snapshot dicts (subs, views, age, uploads playlist id, ...)."""

    @abstractmethod
    def fetch_uploads_video_ids(self, uploads_playlist_id: str, max_results: int = 50) -> list[str]:
        """Return up to max_results most recent video ids for a channel's uploads playlist."""

    @abstractmethod
    def fetch_video_details(self, video_ids: list[str]) -> list[dict]:
        """Return video-level detail dicts (publishedAt, viewCount, ..., thumbnail url)."""
