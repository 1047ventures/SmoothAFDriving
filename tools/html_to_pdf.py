"""Render a paged HTML artifact to a PDF that matches what you see on screen.

Usage:
  python tools/html_to_pdf.py page.html out.pdf [--width 960] [--selector .page]
      [--asset /_blob/<id>=path/to/image.webp ...]

Each element matching --selector becomes one PDF page, sized to the on-screen
layout (not Letter/A4), so boxes never reflow or split across pages.
"""
import argparse
import asyncio
import base64
import mimetypes
import re
import ssl
import sys
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"


def fetch(url: str) -> bytes:
    ca = Path("/root/.ccr/ca-bundle.crt")
    ctx = ssl.create_default_context(cafile=str(ca)) if ca.exists() else None
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
        return r.read()


def inline_fonts(html: str) -> str:
    """Embed Google Fonts so rendering never depends on the network."""
    def css_for(url):
        css = fetch(url.replace("&amp;", "&")).decode()
        for font_url in set(re.findall(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", css)):
            b64 = base64.b64encode(fetch(font_url)).decode()
            css = css.replace(font_url, f"data:font/woff2;base64,{b64}")
        return css

    html = re.sub(r"@import url\(['\"]?(https://fonts\.googleapis\.com/[^'\")]+)['\"]?\);?",
                  lambda m: css_for(m.group(1)), html)
    html = re.sub(r"<link[^>]+href=['\"](https://fonts\.googleapis\.com/css[^'\"]+)['\"][^>]*>",
                  lambda m: f"<style>{css_for(m.group(1))}</style>", html)
    return html


def inline_assets(html: str, assets: dict[str, Path]) -> str:
    for url, path in assets.items():
        mime = mimetypes.guess_type(path.name)[0] or "image/png"
        data = base64.b64encode(path.read_bytes()).decode()
        html = html.replace(url, f"data:{mime};base64,{data}")
    # /_blob/ URLs only resolve inside the claude.ai artifact viewer.
    missing = sorted(set(re.findall(r"/_blob/[0-9a-f]{32}", html)))
    if missing:
        sys.exit("Unmapped artifact images (pass --asset URL=local_file):\n  " + "\n  ".join(missing))
    return html


async def render(html_path: Path, out: Path, width: int, selector: str):
    async with async_playwright() as p:
        kwargs = {"executable_path": CHROME} if Path(CHROME).exists() else {}
        browser = await p.chromium.launch(args=["--no-sandbox"], **kwargs)
        page = await browser.new_page(viewport={"width": width, "height": 1000})
        # Lay out with screen styles; @media print rules are what reflowed the pages.
        await page.emulate_media(media="screen")
        await page.goto(html_path.resolve().as_uri(), wait_until="networkidle")
        await page.evaluate("document.fonts.ready")

        heights = await page.eval_on_selector_all(selector, "els => els.map(e => e.getBoundingClientRect().height)")
        if not heights:
            sys.exit(f"No elements match {selector!r}")
        h = int(max(heights)) + 1

        await page.add_style_tag(content=f"""
          @page {{ size: {width}px {h}px; margin: 0; }}
          html, body {{ margin: 0 !important; padding: 0 !important;
                       -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
          {selector} {{ width: {width}px !important; max-width: none !important;
                       height: {h}px !important; min-height: 0 !important; margin: 0 !important;
                       border-bottom: none !important; break-after: page; break-inside: avoid; }}
          {selector}:last-of-type {{ break-after: auto; }}
        """)
        await page.pdf(path=str(out), width=f"{width}px", height=f"{h}px",
                       print_background=True, prefer_css_page_size=True)
        await browser.close()
        return len(heights), width, h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--width", type=int, default=960)
    ap.add_argument("--selector", default=".page")
    ap.add_argument("--asset", action="append", default=[], metavar="URL=FILE")
    a = ap.parse_args()

    assets = {}
    for spec in a.asset:
        url, _, f = spec.partition("=")
        assets[url] = Path(f)

    html = inline_fonts(inline_assets(a.html.read_text(encoding="utf-8"), assets))
    # Artifact pages often omit a charset; file:// then decodes as Latin-1 and mangles dashes.
    html = '<meta charset="utf-8">\n' + html
    tmp = a.html.with_name(a.html.stem + ".print.html")
    tmp.write_text(html, encoding="utf-8")
    try:
        n, w, h = asyncio.run(render(tmp, a.out, a.width, a.selector))
    finally:
        tmp.unlink(missing_ok=True)
    print(f"{a.out}: {n} pages at {w}x{h}px, {a.out.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
