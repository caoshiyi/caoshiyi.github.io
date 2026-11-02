#!/usr/bin/env python3
"""Build the blog from Markdown files in blog/posts/.

Add a post by creating blog/posts/my-title.md:

    ---
    title: Title of the post
    date: 2026-11-01
    summary: One sentence for the index.
    ---

    The body is Markdown. Then run:

        python3 blog/build.py

Files whose names start with _ are skipped.
"""

from __future__ import annotations

import html
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSTS = Path(__file__).resolve().parent / "posts"
BLOG = Path(__file__).resolve().parent
INDEX = ROOT / "index.html"

HEAD_LINKS = """
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Great+Vibes&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
"""

THEME = """
    <script>
        (function () {
            var html = document.documentElement;
            var saved = null;
            try { saved = localStorage.getItem("theme"); } catch (e) {}
            var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
            var dark = saved ? saved === "dark" : prefersDark;
            html.setAttribute("data-theme", dark ? "dark" : "light");
        })();
    </script>
"""


def parse_front_matter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        raise ValueError("missing front matter")
    parts = text.split("---", 2)
    if len(parts) < 3:
        raise ValueError("front matter was not closed")
    meta = {}
    for line in parts[1].strip().splitlines():
        if not line.strip() or ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"').strip("'")
    return meta, parts[2].strip()


def inline(text: str) -> str:
    pieces = re.split(r"(`[^`]+`)", text)
    out = []
    for piece in pieces:
        if piece.startswith("`") and piece.endswith("`"):
            out.append("<code>" + html.escape(piece[1:-1]) + "</code>")
            continue
        escaped = html.escape(piece)
        escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
        escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", escaped)
        escaped = re.sub(
            r"\[([^\]]+)\]\(([^)]+)\)",
            lambda m: f'<a href="{html.escape(m.group(2), quote=True)}">{m.group(1)}</a>',
            escaped,
        )
        out.append(escaped)
    return "".join(out)


def markdown_to_html(src: str) -> str:
    src = src.replace("\r\n", "\n")
    blocks = re.split(r"\n```", src)
    html_blocks = []
    for i, block in enumerate(blocks):
        if i % 2 == 1:
            code = block.split("\n", 1)[1] if "\n" in block else ""
            html_blocks.append("<pre><code>" + html.escape(code.rstrip("\n")) + "</code></pre>")
            continue
        html_blocks.append(render_prose(block))
    return "\n".join(part for part in html_blocks if part)


def render_prose(src: str) -> str:
    lines = src.split("\n")
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("### "):
            out.append(f"<h3>{inline(line[4:].strip())}</h3>")
            i += 1
            continue
        if line.startswith("## "):
            out.append(f"<h2>{inline(line[3:].strip())}</h2>")
            i += 1
            continue
        figure = re.match(r"^!\[([^\]]*)\]\(([^)\s]+)\)\s*$", line.strip())
        if figure:
            caption, src = figure.groups()
            alt = html.escape(re.sub(r"[*`]", "", caption), quote=True)
            out.append(
                f'<figure><img src="{html.escape(src, quote=True)}" alt="{alt}" loading="lazy">'
                + (f"<figcaption>{inline(caption)}</figcaption>" if caption else "")
                + "</figure>"
            )
            i += 1
            continue
        if line.startswith("> "):
            quote = []
            while i < len(lines) and lines[i].startswith("> "):
                quote.append(lines[i][2:])
                i += 1
            out.append("<blockquote><p>" + inline(" ".join(quote)) + "</p></blockquote>")
            continue
        if re.match(r"^[-*] ", line):
            items = []
            while i < len(lines) and re.match(r"^[-*] ", lines[i]):
                items.append("<li>" + inline(lines[i][2:].strip()) + "</li>")
                i += 1
            out.append("<ul>" + "".join(items) + "</ul>")
            continue
        if re.match(r"^\d+\. ", line):
            items = []
            while i < len(lines) and re.match(r"^\d+\. ", lines[i]):
                items.append("<li>" + inline(re.sub(r"^\d+\. ", "", lines[i]).strip()) + "</li>")
                i += 1
            out.append("<ol>" + "".join(items) + "</ol>")
            continue
        para = [line.strip()]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{2,3} |> |[-*] |\d+\. |!\[)", lines[i]):
            para.append(lines[i].strip())
            i += 1
        out.append("<p>" + inline(" ".join(para)) + "</p>")
    return "\n".join(out)


def load_posts() -> list[dict]:
    POSTS.mkdir(exist_ok=True)
    posts = []
    for path in sorted(POSTS.glob("*.md")):
        if path.name.startswith("_"):
            continue
        meta, body = parse_front_matter(path.read_text(encoding="utf-8"))
        if "title" not in meta or "date" not in meta:
            raise SystemExit(f"{path.name} needs title and date")
        slug = path.stem
        posts.append({
            "slug": slug,
            "title": meta["title"],
            "date": meta["date"],
            "summary": meta.get("summary", ""),
            "html": markdown_to_html(body),
            "path": path,
        })
    posts.sort(key=lambda p: p["date"], reverse=True)
    for post in posts:
        datetime.strptime(post["date"], "%Y-%m-%d")
    return posts


def chrome(title: str, description: str, depth: str, current: str) -> str:
    home = f"{depth}index.html"
    blog = f"{depth}blog/"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{html.escape(title)}</title>
    <meta name="author" content="Shiyi Cao">
    <meta name="description" content="{html.escape(description)}">
    <link rel="icon" type="image/png" href="{depth}images/logo%203.png">
    <link rel="stylesheet" href="{depth}stylesheet.css?v=7">
    <link rel="alternate" type="application/rss+xml" title="Shiyi Cao" href="{depth}blog/feed.xml">
{HEAD_LINKS}
{THEME}
</head>
<body>
    <nav class="nav">
        <div class="nav-inner">
            <a class="brand" href="{home}">Shiyi Cao</a>
            <div class="nav-links">
                <a href="{home}#research">Research</a>
                <a href="{home}#news">News</a>
                <a href="{home}#publications">Publications</a>
                <a href="{home}#open-source">Open source</a>
                <a href="{home}#talks">Talks</a>
                <a href="{blog}"{" aria-current=\"page\"" if current == "blog" else ""}>Blog</a>
            </div>
            <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Toggle dark mode">
                <svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
                <svg class="icon-moon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
            </button>
        </div>
    </nav>
"""


def footer(depth: str) -> str:
    return f"""
    <footer class="footer">
        <div class="wrap footer-row">
            <span class="cn">曹诗怡</span>
            <span>© {datetime.now().year} Shiyi Cao</span>
            <div class="footer-links">
                <a href="mailto:shiyicao314@gmail.com">Email</a>
                <a href="https://github.com/caoshiyi">GitHub</a>
                <a href="https://scholar.google.com/citations?user=NR59_v4AAAAJ">Scholar</a>
            </div>
        </div>
    </footer>
    <script src="{depth}site.js?v=7"></script>
</body>
</html>
"""


def render_index(posts: list[dict]) -> str:
    if posts:
        items = []
        for post in posts:
            items.append(
                f'<a class="post-link" href="{html.escape(post["slug"])}.html">'
                f'<time datetime="{post["date"]}">{format_date(post["date"])}</time>'
                f'<div><h3>{html.escape(post["title"])}</h3>'
                f'<p>{html.escape(post["summary"])}</p></div></a>'
            )
        body = '<div class="writing-list">' + "\n".join(items) + "</div>"
    else:
        body = '<p class="empty">No posts yet.</p>'
    return (
        chrome("Blog · Shiyi Cao", "Notes by Shiyi Cao.", "../", "blog")
        + f"""
    <main class="wrap section">
        <header class="section-head">
            <h2>Blog</h2>
        </header>
        {body}
    </main>
"""
        + footer("../")
    )


def render_post(post: dict) -> str:
    pretty = format_date(post["date"])
    return (
        chrome(
            f'{post["title"]} · Shiyi Cao',
            post["summary"] or post["title"],
            "../",
            "post",
        )
        + f"""
    <article class="post">
        <p class="post-kicker"><a href="index.html">Blog</a></p>
        <h1>{html.escape(post["title"])}</h1>
        <time datetime="{post["date"]}">{pretty}</time>
        <div class="post-body">
{post["html"]}
        </div>
    </article>
"""
        + footer("../")
    )


def format_date(iso: str) -> str:
    dt = datetime.strptime(iso, "%Y-%m-%d")
    return f"{dt.strftime('%b')} {dt.day}, {dt.year}"


def home_snippet(posts: list[dict]) -> str:
    if not posts:
        return '        <p class="empty">No posts yet.</p>\n'
    lines = ['        <div class="writing-list">']
    for post in posts[:3]:
        lines.append(
            f'            <a class="post-link" href="blog/{html.escape(post["slug"])}.html">'
            f'<time datetime="{post["date"]}">{format_date(post["date"])}</time>'
            f'<div><h3>{html.escape(post["title"])}</h3>'
            f'<p>{html.escape(post["summary"])}</p></div></a>'
        )
    lines.append("        </div>")
    return "\n".join(lines) + "\n"


def update_home(posts: list[dict]) -> None:
    text = INDEX.read_text(encoding="utf-8")
    start = "<!-- blog-latest:start -->"
    end = "<!-- blog-latest:end -->"
    if start not in text or end not in text:
        raise SystemExit("index.html is missing blog markers")
    pre, rest = text.split(start, 1)
    _, post = rest.split(end, 1)
    INDEX.write_text(pre + start + "\n" + home_snippet(posts) + "        " + end + post, encoding="utf-8")


def write_feed(posts: list[dict]) -> None:
    items = []
    for post in posts:
        link = f"https://shiyicao.com/blog/{post['slug']}.html"
        items.append(
            "<item>"
            f"<title>{html.escape(post['title'])}</title>"
            f"<link>{link}</link>"
            f"<guid>{link}</guid>"
            f"<pubDate>{datetime.strptime(post['date'], '%Y-%m-%d').strftime('%a, %d %b %Y 00:00:00 +0000')}</pubDate>"
            f"<description>{html.escape(post['summary'])}</description>"
            "</item>"
        )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0"><channel>'
        "<title>Shiyi Cao</title>"
        "<link>https://shiyicao.com/blog/</link>"
        "<description>Notes by Shiyi Cao.</description>"
        + "".join(items)
        + "</channel></rss>\n"
    )
    (BLOG / "feed.xml").write_text(xml, encoding="utf-8")


def main() -> None:
    posts = load_posts()
    keep = {f"{post['slug']}.html" for post in posts}
    for old in BLOG.glob("*.html"):
        if old.name != "index.html" and old.name not in keep:
            old.unlink()
    (BLOG / "index.html").write_text(render_index(posts), encoding="utf-8")
    for post in posts:
        (BLOG / f"{post['slug']}.html").write_text(render_post(post), encoding="utf-8")
    write_feed(posts)
    if INDEX.exists():
        update_home(posts)
    print(f"built {len(posts)} post(s)")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
