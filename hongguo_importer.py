"""Import a local or authorized direct MP4 into a dubbing project."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def validate(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)], capture_output=True, text=True)
    if result.returncode:
        raise ValueError('Invalid media: ' + result.stderr.strip())
    info = json.loads(result.stdout)
    if 'mp4' not in info.get('format', {}).get('format_name', '').split(','):
        raise ValueError('Source is not an MP4-compatible container.')
    streams = info.get('streams', [])
    if not any(s.get('codec_type') == 'video' for s in streams):
        raise ValueError('No video stream.')
    if not any(s.get('codec_type') == 'audio' for s in streams):
        raise ValueError('No audio stream for dubbing.')
    duration = float(info.get('format', {}).get('duration', 0))
    if duration <= 0:
        raise ValueError('No valid duration.')
    return duration


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', help='Authorized direct HTTP(S) MP4 URL or local MP4 path')
    p.add_argument('--output', '-o', required=True, type=Path, help='Destination .mp4 file')
    args = p.parse_args()
    if not shutil.which('ffprobe'):
        p.error('Install FFmpeg/ffprobe and add it to PATH first.')
    output = args.output.resolve()
    if output.suffix.lower() != '.mp4':
        p.error('Output must end in .mp4.')
    if output.exists():
        p.error('Output already exists; choose another name.')
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix='.part', delete=False) as dest:
            temp = Path(dest.name)
            if urlsplit(args.source).scheme.lower() in ('http', 'https'):
                with urlopen(Request(args.source, headers={'User-Agent': 'AuthorizedMediaImporter/1.0'}), timeout=60) as response:
                    if response.headers.get_content_type() in ('text/html', 'application/json', 'text/plain'):
                        raise ValueError('URL returned a page or API response, not a direct MP4.')
                    expected = response.headers.get('Content-Length')
                    shutil.copyfileobj(response, dest, length=1024*1024)
                    if expected is not None and dest.tell() != int(expected):
                        raise ValueError('Incomplete download.')
            else:
                with Path(args.source).open('rb') as src:
                    shutil.copyfileobj(src, dest, length=1024*1024)
        duration = validate(temp)
        # Exclusive creation prevents accidental replacement of existing files.
        with output.open('xb') as dest:
            try:
                with temp.open('rb') as src:
                    shutil.copyfileobj(src, dest, length=1024*1024)
            except BaseException:
                dest.close()
                output.unlink(missing_ok=True)
                raise
        print(f'OK: {output} | {duration:.2f}s')
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


if __name__ == '__main__':
    sys.exit(main())
