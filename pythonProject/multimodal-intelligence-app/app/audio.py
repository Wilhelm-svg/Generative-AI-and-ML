"""Audio extraction from YouTube URLs using yt-dlp."""
import os
import tempfile

import yt_dlp


def extract_audio(url: str) -> bytes:
    """Download audio from a YouTube URL and return raw bytes.

    Args:
        url: A valid YouTube video URL.

    Returns:
        Audio content as bytes (mp3/m4a).

    Raises:
        ValueError: If the URL is invalid, inaccessible, or download fails.
    """
    if not url or not isinstance(url, str):
        raise ValueError("URL must be a non-empty string.")

    with tempfile.TemporaryDirectory() as tmpdir:
        output_template = os.path.join(tmpdir, "audio.%(ext)s")
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": output_template,
            "quiet": True,
            "no_warnings": True,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "128",
                }
            ],
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if info is None:
                    raise ValueError(f"Could not retrieve video info for URL: {url}")
        except yt_dlp.utils.DownloadError as exc:
            raise ValueError(f"Failed to download audio from '{url}': {exc}") from exc
        except yt_dlp.utils.ExtractorError as exc:
            raise ValueError(f"Invalid or unsupported URL '{url}': {exc}") from exc

        # Find the downloaded file
        for fname in os.listdir(tmpdir):
            fpath = os.path.join(tmpdir, fname)
            if os.path.isfile(fpath):
                with open(fpath, "rb") as f:
                    return f.read()

    raise ValueError(f"Audio extraction produced no output for URL: {url}")
