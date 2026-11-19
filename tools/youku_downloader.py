"""Download a finite, clear HLS or DASH presentation from a direct manifest URL.

Python 3.11+, aiohttp, FFmpeg on PATH. Cookies: Netscape cookies.txt.
Handles HLS master playlists, external audio, fMP4 maps, TS; static,
single-period DASH with SegmentList or SegmentTemplate/SegmentTimeline.
Byte ranges, changing initialization sections and discontinuities are rejected.
"""
import argparse
import asyncio
from contextlib import asynccontextmanager
from fractions import Fraction
from http.cookiejar import MozillaCookieJar
from math import ceil
import os
from pathlib import Path
import re
import shutil
import tempfile
from urllib.parse import urljoin, urlsplit
import xml.etree.ElementTree as ET


MAX_SEGMENTS = 100_000
MAX_MANIFEST = 8 * 1024 * 1024


def decrypt_segment(data: bytes, key: bytes) -> bytes:
    """Reserved CENC interface."""
    raise NotImplementedError("CENC decryption is not implemented.")


def check(condition, message):
    if not condition:
        raise ValueError(message)


def web_url(url):
    p = urlsplit(url)
    check(p.scheme in ("http", "https") and p.hostname and p.username is None,
          "Expected an HTTP(S) media URL without embedded credentials.")
    return url


def load_cookies(path):
    if not path:
        return []
    jar = MozillaCookieJar(str(path))
    jar.load(ignore_discard=True)
    return list(jar)


def cookie_header(url, cookies):
    p = urlsplit(url)
    host = p.hostname or ""
    if p.scheme != "https" or not (host == "youku.com" or host.endswith(".youku.com")):
        return {}
    matches = []
    for cookie in cookies:
        domain = cookie.domain.lstrip(".").lower()
        if not (domain == "youku.com" or domain.endswith(".youku.com")):
            continue
        domain_ok = host == domain or (cookie.domain_specified and host.endswith("." + domain))
        path = p.path or "/"
        path_ok = path == cookie.path or path.startswith(cookie.path.rstrip("/") + "/")
        if domain_ok and path_ok and not cookie.is_expired():
            matches.append(cookie)
    pairs = [f"{c.name}={c.value}" for c in sorted(matches, key=lambda c: -len(c.path))]
    return {"Cookie": "; ".join(pairs)} if pairs else {}


@asynccontextmanager
async def get(session, url, cookies):
    from yarl import URL
    for _ in range(8):
        async with session.get(URL(web_url(url), encoded=True), headers=cookie_header(url, cookies),
                               allow_redirects=False) as response:
            if response.status in (301, 302, 303, 307, 308):
                location = response.headers.get("Location")
                check(location, "Redirect without Location.")
                url = urljoin(url, location)
                continue
            check(response.status == 200, f"Media server returned HTTP {response.status}.")
            yield response, url
            return
    raise ValueError("Too many redirects.")


def attrs(line):
    return {k: v.strip('"') for k, v in
            re.findall(r'(?:^|,)([A-Z0-9-]+)=("[^"]*"|[^,]*)', line.split(":", 1)[1])}


def hls(text, url):
    lines = [s.strip() for s in text.splitlines() if s.strip()]
    check(lines and lines[0] == "#EXTM3U", "Invalid HLS header.")
    variants, audio, parts = [], [], []
    init = None
    for i, line in enumerate(lines):
        if line.startswith(("#EXT-X-KEY:", "#EXT-X-SESSION-KEY:")):
            check(attrs(line).get("METHOD") == "NONE", "Encrypted HLS is unsupported.")
        elif line.startswith("#EXT-X-STREAM-INF:"):
            check(i + 1 < len(lines) and not lines[i+1].startswith("#"), "Missing variant URI.")
            variants.append((attrs(line), urljoin(url, lines[i+1])))
        elif line.startswith("#EXT-X-MEDIA:"):
            a = attrs(line)
            if a.get("TYPE") == "AUDIO":
                audio.append(a)
        elif line.startswith(("#EXT-X-BYTERANGE:", "#EXT-X-GAP", "#EXT-X-DEFINE:",
                              "#EXT-X-DISCONTINUITY", "#EXT-X-I-FRAMES-ONLY")):
            raise ValueError("Unsupported HLS feature: " + line.split(":")[0])
        elif line.startswith("#EXT-X-MAP:"):
            a = attrs(line)
            check("BYTERANGE" not in a and a.get("URI"), "Unsupported HLS init map.")
            new = urljoin(url, a["URI"])
            check(not parts or init == new, "Changing HLS init map is unsupported.")
            init = new
        elif not line.startswith("#"):
            parts.append(urljoin(url, line))
    if variants:
        variant, video = max(variants, key=lambda item: int(item[0]["BANDWIDTH"]))
        group = variant.get("AUDIO")
        candidates = [a for a in audio if a.get("GROUP-ID") == group]
        check(not group or candidates, "Missing HLS audio group.")
        chosen = max(candidates, key=lambda a: a.get("DEFAULT") == "YES", default={})
        return True, [video] + ([urljoin(url, chosen["URI"])] if chosen.get("URI") else [])
    check("#EXT-X-ENDLIST" in lines and 0 < len(parts) <= MAX_SEGMENTS, "Expected finite HLS VOD.")
    return False, ([init] if init else []) + parts


def seconds(value):
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", value or "")
    check(m and any(m.groups()), "Expected a finite DASH duration.")
    return sum(Fraction(n or 0) * unit for n, unit in zip(m.groups(), (3600, 60, 1)))


def expand(template, values):
    def replace(match):
        if match[0] == "$$":
            return "$"
        name, width = match.groups()
        check(name in values and int(width or 0) <= 32, "Unsupported DASH template field.")
        return str(values[name]).zfill(int(width or 0))
    return re.sub(r"\$\$|\$([A-Za-z]+)(?:%0(\d+)d)?\$", replace, template)


def dash_parts(nodes, url, duration):
    rep = nodes[-1]
    options, timeline, segment_list = {}, None, None
    for node in nodes:
        url = urljoin(url, (node.findtext("BaseURL") or "").strip())
        check(node.find("SegmentBase") is None, "DASH SegmentBase is unsupported.")
        item = node.find("SegmentList")
        if item is not None:
            check(segment_list is None, "Inherited DASH SegmentList is unsupported.")
            segment_list = item
        tmpl = node.find("SegmentTemplate")
        if tmpl is not None:
            options.update(tmpl.attrib)
            if tmpl.find("SegmentTimeline") is not None:
                timeline = tmpl.find("SegmentTimeline")
    if segment_list is not None:
        check(not options, "Mixed DASH addressing is unsupported.")
        parts = []
        init = segment_list.find("Initialization")
        if init is not None:
            check(init.get("sourceURL") and "range" not in init.attrib, "Unsupported DASH init.")
            parts.append(urljoin(url, init.get("sourceURL")))
        media = segment_list.findall("SegmentURL")
        check(0 < len(media) <= MAX_SEGMENTS, "Invalid DASH segment count.")
        for s in media:
            check(s.get("media") and "mediaRange" not in s.attrib, "Unsupported DASH segment range.")
            parts.append(urljoin(url, s.get("media")))
        return parts
    check("media" in options, "Expected DASH SegmentList or SegmentTemplate.")
    values = {"RepresentationID": rep.get("id", ""), "Bandwidth": rep.get("bandwidth", "")}
    parts = [urljoin(url, expand(options["initialization"], values))] if "initialization" in options else []
    timescale = int(options.get("timescale", 1))
    check(timescale > 0, "Invalid DASH timescale.")
    first = int(options.get("startNumber", 1))
    runs = list(timeline) if timeline is not None else []
    if timeline is None:
        step = int(options.get("duration", 0))
        check(step > 0, "Missing DASH segment duration.")
        count = ceil(seconds(duration) * timescale / step)
        runs = [ET.Element("S", d=str(step), r=str(count - 1))]
    check(runs, "Empty DASH timeline.")
    number, time = first, 0
    for i, run in enumerate(runs):
        time = int(run.get("t", time))
        step, repeat = int(run.attrib["d"]), int(run.get("r", 0))
        check(step > 0 and repeat >= -1, "Invalid DASH timeline.")
        count = repeat + 1
        if repeat == -1:
            end = (int(runs[i+1].attrib["t"]) if i+1 < len(runs) else
                   seconds(duration) * timescale + int(options.get("presentationTimeOffset", 0)))
            count = ceil(Fraction(end - time, step))
        check(count > 0 and number - first + count <= MAX_SEGMENTS, "Invalid DASH segment count.")
        for _ in range(count):
            parts.append(urljoin(url, expand(options["media"], dict(values, Number=number, Time=time))))
            number += 1
            time += step
    return parts


def dash(text, url):
    check("<!DOCTYPE" not in text, "DTD is unsupported.")
    root = ET.fromstring(text)
    for node in root.iter():
        node.tag = node.tag.split("}")[-1]
    periods = root.findall("Period")
    check(root.tag == "MPD" and root.get("type", "static") == "static" and len(periods) == 1,
          "Expected a static single-period MPD.")
    period = periods[0]
    selected = {}
    for group in period.findall("AdaptationSet"):
        for rep in group.findall("Representation"):
            kind = (rep.get("contentType") or group.get("contentType") or
                    rep.get("mimeType") or group.get("mimeType", "")).split("/")[0]
            if kind in ("video", "audio"):
                nodes = [root, period, group, rep]
                if any(n.find("ContentProtection") is not None for n in nodes):
                    continue
                bandwidth = int(rep.get("bandwidth", 0))
                if kind not in selected or bandwidth > selected[kind][0]:
                    selected[kind] = bandwidth, nodes
    check("video" in selected, "No clear DASH video representation.")
    if any((n.get("contentType") or n.get("mimeType", "")).split("/")[0] == "audio"
           for n in period.iter()):
        check("audio" in selected, "No clear DASH audio representation.")
    duration = period.get("duration") or root.get("mediaPresentationDuration")
    return [dash_parts(selected[k][1], url, duration) for k in ("video", "audio") if k in selected]


async def manifest(session, url, cookies):
    async with get(session, url, cookies) as (response, final_url):
        body = bytearray()
        async for block in response.content.iter_chunked(65536):
            body.extend(block)
            check(len(body) <= MAX_MANIFEST, "Manifest too large.")
        return body.decode("utf-8-sig"), final_url


async def resolve(session, url, cookies):
    text, url = await manifest(session, url, cookies)
    if not text.lstrip().startswith("#EXTM3U"):
        return dash(text, url)
    master, parts = hls(text, url)
    if not master:
        return [parts]
    tracks = []
    for child in parts:
        nested, items = hls(*(await manifest(session, child, cookies)))
        check(not nested, "Nested HLS master unsupported.")
        tracks.append(items)
    return tracks


async def download(session, urls, cookies, folder, jobs):
    pending = iter(enumerate(urls))
    async def worker():
        for i, url in pending:
            async with get(session, url, cookies) as (response, _):
                with (folder / str(i)).open("wb") as dest:
                    async for block in response.content.iter_chunked(256 * 1024):
                        dest.write(block)
                    check(dest.tell(), "Empty media segment.")
    async with asyncio.TaskGroup() as group:
        for _ in range(min(jobs, len(urls))):
            group.create_task(worker())
    target = folder / "track"
    with target.open("wb") as out:
        for i in range(len(urls)):
            part = folder / str(i)
            with part.open("rb") as src:
                shutil.copyfileobj(src, out)
            part.unlink()
    return target


async def run(args):
    import aiohttp
    ffmpeg = shutil.which("ffmpeg")
    check(ffmpeg, "Install FFmpeg and add it to PATH.")
    check(1 <= args.jobs <= 32, "Choose 1 to 32 concurrent requests.")
    check(not args.output.exists(), "Output already exists.")
    cookies = load_cookies(args.cookies)
    with tempfile.TemporaryDirectory(dir=args.output.parent) as tmp:
        folder = Path(tmp)
        cmd = [ffmpeg, "-nostdin", "-v", "error", "-xerror"]
        async with aiohttp.ClientSession(cookie_jar=aiohttp.DummyCookieJar(),
                    timeout=aiohttp.ClientTimeout(total=None, sock_connect=20, sock_read=45)) as session:
            tracks = await resolve(session, args.url, cookies)
            for i, urls in enumerate(tracks):
                sub = folder / str(i)
                sub.mkdir()
                path = await download(session, urls, cookies, sub, args.jobs)
                cmd.extend(["-protocol_whitelist", "file", "-format_whitelist",
                            "mov,mpegts,aac,mp3,matroska,ac3,eac3", "-i", str(path)])
        result = folder / "muxed.mp4"
        cmd.extend(["-map", "0:v:0", "-map", "1:a:0" if len(tracks) == 2 else "0:a:0?",
                    "-c", "copy", "-movflags", "+faststart", str(result)])
        proc = await asyncio.create_subprocess_exec(*cmd)
        try:
            check(await proc.wait() == 0, "FFmpeg mux failed.")
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
        os.link(result, args.output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Direct M3U8/MPD URL")
    parser.add_argument("output", type=Path, help="New MP4 file")
    parser.add_argument("--cookies", type=Path, help="Netscape cookie file")
    parser.add_argument("--jobs", type=int, default=8)
    try:
        asyncio.run(run(parser.parse_args()))
    except Exception as error:
        while isinstance(error, BaseExceptionGroup):
            error = error.exceptions[0]
        # Network exceptions may contain signed URLs. Print only safe diagnostics.
        detail = str(error) if type(error) in (ValueError, ModuleNotFoundError) else type(error).__name__
        raise SystemExit(detail) from None
