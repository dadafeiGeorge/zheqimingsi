#!/usr/bin/env python3
"""Extract a Kindle-style EPUB into clean Markdown (stdlib only).

Usage: python scripts/extract_epub_md.py <epub> <out.md>
"""
import sys, zipfile, re, posixpath
from html.parser import HTMLParser
from html import unescape

BLOCK = {'p', 'div', 'li', 'blockquote', 'table', 'tr', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}
SKIP_TAGS = {'script', 'style', 'head'}

class Extractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.buf = []
        self.in_body = False
        self.skip = 0
        self.heading = 0

    def flush(self):
        text = re.sub(r'[ \t\u3000\r\n]+', ' ', ''.join(self.buf)).strip()
        self.buf = []
        if not text:
            return
        if self.heading:
            level = min(6, max(1, self.heading))
            self.parts.append('#' * level + ' ' + text)
        else:
            self.parts.append(text)
        self.heading = 0

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self.skip += 1
            return
        if tag == 'body':
            self.in_body = True
            return
        if not self.in_body or self.skip:
            return
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.flush()
            self.heading = int(tag[1])
        elif tag in BLOCK:
            self.flush()
        elif tag == 'br':
            self.buf.append(' ')

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
            return
        if tag == 'body':
            self.flush()
            self.in_body = False
            return
        if not self.in_body or self.skip:
            return
        if tag in BLOCK:
            self.flush()

    def handle_data(self, data):
        if self.in_body and not self.skip:
            self.buf.append(data)


def spine_docs(z, opf_path):
    opf = z.read(opf_path).decode('utf-8', 'replace')
    base = posixpath.dirname(opf_path)
    manifest = {}
    for tag in re.findall(r'<item\b[^>]*>', opf):
        attrs = dict(re.findall(r'([\w:]+)="([^"]*)"', tag))
        if 'id' in attrs and 'href' in attrs:
            manifest[attrs['id']] = attrs['href']
    order = re.findall(r'<itemref\s+[^>]*idref="([^"]+)"', opf)
    docs = []
    if order:
        for idref in order:
            href = manifest.get(idref)
            if href:
                docs.append(posixpath.join(base, href))
    else:
        docs = sorted(n for n in z.namelist() if n.lower().endswith(('.xhtml', '.html', '.htm')))
    return docs


def main():
    epub, out = sys.argv[1], sys.argv[2]
    z = zipfile.ZipFile(epub)
    container = z.read('META-INF/container.xml').decode('utf-8', 'replace')
    m = re.search(r'full-path="([^"]+)"', container)
    opf_path = m.group(1) if m else [n for n in z.namelist() if n.endswith('.opf')][0]
    docs = spine_docs(z, opf_path)
    chunks = []
    skipped = []
    for doc in docs:
        try:
            raw = z.read(doc).decode('utf-8', 'replace')
        except KeyError:
            continue
        title = re.search(r'<title>(.*?)</title>', raw, re.S)
        title = unescape(title.group(1)).strip() if title else ''
        if any(k in title for k in ('书名页', 'Table of Contents', '封面', '版权', '目录')):
            skipped.append((doc, title))
            continue
        p = Extractor()
        p.feed(raw)
        p.close()
        p.flush()
        if p.parts:
            chunks.append('\n\n'.join(p.parts))
    body = '\n\n'.join(chunks)
    body = re.sub(r'\n{3,}', '\n\n', body).strip() + '\n'
    if not body.startswith('# '):
        body = '# ' + re.sub(r'\s*\(.*', '', posixpath.basename(out).rsplit('.', 1)[0]) + '\n\n' + body
    open(out, 'w', encoding='utf-8').write(body)
    cjk = len(re.findall(r'[\u4e00-\u9fff]', body))
    heads = [ln for ln in body.split('\n') if ln.startswith('#')]
    print('docs', len(docs), 'used', len(chunks), 'skipped', skipped)
    print('cjk', cjk, 'heads', len(heads))
    print('\n'.join(heads[:30]))


if __name__ == '__main__':
    main()
