const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

export function extractYoutubeVideoUrl(pageUrl: string): string | null {
  let url: URL;

  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }

  let videoId: string | null = null;

  if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else {
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts[0] === "shorts") {
        videoId = pathParts[1] ?? null;
      }
    }
  }

  return videoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    : null;
}
