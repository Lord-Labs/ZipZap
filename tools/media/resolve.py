"""Fixed metadata-only bootstrap; the parent owns the process job before release."""
import sys

if sys.stdin.buffer.read(1) != b"1":
    raise SystemExit(1)

import pathlib
import runpy

root = pathlib.Path(__file__).resolve().parent
source = sys.argv[1]
sys.path.insert(0, str(root / "yt-dlp"))
sys.argv = [
    "yt-dlp", "--ignore-config", "--no-cache-dir", "--no-plugin-dirs",
    "--no-playlist", "--skip-download", "--no-warnings", "--quiet",
    "--no-js-runtimes", "--js-runtimes", f"node:{root / 'node' / 'node.exe'}",
    "--no-remote-components", "--socket-timeout", "10", "--retries", "0",
    "--extractor-retries", "0", "--proxy", "",
    "--format", "best[protocol=https][ext=mp4][vcodec!=none][acodec!=none][has_drm!=?true]",
    "--print", "%(.{id,title,url,ext,protocol,vcodec,acodec,width,height,filesize,format_id,has_drm,is_live})j",
    "--", source,
]
runpy.run_path(str(root / "yt-dlp"), run_name="__main__")
