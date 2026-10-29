#!/usr/bin/env python3
"""Split PDF in WebKit (Safari's engine), iPad profile with touch, on the published sites. Follows every way a user
reaches the tool: the PDF toolkit start page; and from the InkDOS Home with new tabs blocked (as in a web desktop such
as XeOS on iPad, where the tool opens in the InkDOS panel frame), both through the toolkit start page and through the
direct Split PDF entry. Each path picks a two-page PDF and checks that the tool shows it. Diagnostics only."""
from __future__ import annotations

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

TOOLS = 'https://inkdos-tools.github.io/InkDOS-tools/'
INKDOS = 'https://vfydr2m9wk-ops.github.io/InkDOS/'
OUT = Path('webkit-report')
BLOCK_POPUPS = 'window.open = () => null;'
XEOS_UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) '
           'Version/18.2 Safari/605.1.15')  # as reported by XeOS on iPad


def two_page_pdf(path: Path) -> None:
    objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>']
    out, offs = b'%PDF-1.4\n', []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += f'{i} 0 obj\n{o}\nendobj\n'.encode()
    x = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode() + b''.join(f'{o:010d} 00000 n \n'.encode() for o in offs)
    out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n'.encode()
    path.write_bytes(out)


def report(log: list[str], name: str, frame, pdf: Path) -> None:
    """On the Split PDF page (top page or frame): pick the PDF and say whether the tool shows it."""
    log.append(f'[{name}] on {frame.url}')
    try:
        frame.wait_for_selector('#file-input', state='attached', timeout=30000)
        frame.set_input_files('#file-input', str(pdf))
        frame.wait_for_function("() => /2 pages/.test(document.body.innerText)", timeout=30000)
        log.append(f'[{name}] OK: the file shows (2 pages); url {frame.url}')
    except Exception as error:  # noqa: BLE001 - diagnostics
        text = ''
        try:
            text = frame.evaluate('() => document.body.innerText.slice(0, 300)').replace('\n', ' | ')
        except Exception:  # noqa: BLE001
            pass
        log.append(f'[{name}] FAILED: {str(error)[:300]} :: url {frame.url} :: text {text}')


def watch(page, log: list[str], name: str) -> None:
    page.on('pageerror', lambda e: log.append(f'[{name}] pageerror: {str(e)[:300]}'))
    page.on('console', lambda m: log.append(f'[{name}] console.{m.type}: {m.text[:200]}') if m.type == 'error' else None)
    page.on('framenavigated', lambda f: log.append(f'[{name}] navigated: {"top" if f == page.main_frame else "frame"} {f.url}'))
    page.on('crash', lambda: log.append(f'[{name}] PAGE CRASHED'))


def tap_split_card(frame) -> None:
    card = frame.locator('a.tool-card[href*="split-pdf"]').first
    card.wait_for(state='attached', timeout=30000)
    card.scroll_into_view_if_needed()
    card.tap()


def tool_frame(page):
    for _ in range(60):
        for f in page.frames:
            if f != page.main_frame and 'bentopdf' in f.url:
                return f
        page.wait_for_timeout(500)
    return None


def main() -> int:
    OUT.mkdir(exist_ok=True)
    pdf = OUT / 'two-pages.pdf'
    two_page_pdf(pdf)
    log: list[str] = []
    with sync_playwright() as pw:
        browser = getattr(pw, os.environ.get('BROWSER', 'webkit')).launch()
        device = pw.devices['iPad (gen 7) landscape']

        # 1. toolkit start page, tap Split PDF right away (first visit) and again on a second visit
        context = browser.new_context(**device)
        page = context.new_page()
        watch(page, log, 'start')
        for visit in (1, 2):
            page.goto(TOOLS + 'bentopdf/?inkdos-theme=light', wait_until='domcontentloaded')
            tap_split_card(page)
            page.wait_for_timeout(6000)
            log.append(f'[start] visit {visit}: url after tap {page.url}')
            if 'split-pdf' in page.url:
                report(log, f'start#{visit}', page, pdf)
            page.screenshot(path=str(OUT / f'start-{visit}.png'))
        context.close()

        # 2. InkDOS Home, new tabs blocked: quick tool "PDF tools" opens the toolkit in the panel; tap Split PDF there
        context = browser.new_context(**device)
        context.add_init_script(BLOCK_POPUPS)
        page = context.new_page()
        watch(page, log, 'home-toolkit')
        page.goto(INKDOS, wait_until='load')
        page.locator('[data-quick-tool="bentopdf"]').tap()
        frame = tool_frame(page)
        if not frame:
            log.append('[home-toolkit] FAILED: no toolkit frame in the panel')
        else:
            tap_split_card(frame)
            page.wait_for_timeout(6000)
            frame = tool_frame(page)
            log.append(f'[home-toolkit] frame url after tap {frame.url if frame else None}')
            if frame and 'split-pdf' in frame.url:
                report(log, 'home-toolkit', frame, pdf)
        page.screenshot(path=str(OUT / 'home-toolkit.png'))
        context.close()

        # 3. InkDOS Home, new tabs blocked: Advanced tools -> Split PDF opens that page in the panel directly
        context = browser.new_context(**device)
        context.add_init_script(BLOCK_POPUPS)
        page = context.new_page()
        watch(page, log, 'home-direct')
        page.goto(INKDOS, wait_until='load')
        page.evaluate("() => InkDOSAdvancedTools.openTool('split-pdf')")
        frame = tool_frame(page)
        page.wait_for_timeout(4000)
        frame = tool_frame(page)
        if frame:
            report(log, 'home-direct', frame, pdf)
        else:
            log.append('[home-direct] FAILED: no Split PDF frame in the panel')
        page.screenshot(path=str(OUT / 'home-direct.png'))
        context.close()

        # 4. InkDOS Home, new tabs allowed: Split PDF in its own tab
        context = browser.new_context(**device)
        page = context.new_page()
        watch(page, log, 'home-tab')
        page.goto(INKDOS, wait_until='load')
        with context.expect_page() as opened:
            page.evaluate("() => InkDOSAdvancedTools.openTool('split-pdf')")
        tab = opened.value
        watch(tab, log, 'home-tab:new')
        tab.wait_for_load_state('load')
        report(log, 'home-tab', tab, pdf)
        context.close()

        # 5. XeOS profile: a WebKit app view that names itself desktop Safari and has no service worker
        context = browser.new_context(viewport={'width': 1180, 'height': 820}, has_touch=True, is_mobile=False,
                                      service_workers='block', user_agent=XEOS_UA,
                                      locale='pt-BR')  # a Portuguese iPad: tool links once gained /pt/ and led to a 404
        page = context.new_page()
        watch(page, log, 'xeos')
        page.on('console', lambda m: log.append(f'[xeos] console.{m.type}: {m.text[:200]}') if m.type in ('warning', 'log') and 'VITE_' not in m.text else None)
        page.on('requestfailed', lambda r: log.append(f'[xeos] requestfailed: {r.url[:160]} {r.failure}'))
        page.on('response', lambda r: log.append(f'[xeos] HTTP {r.status}: {r.url[:160]}') if r.status >= 400 else None)
        page.on('worker', lambda w: log.append(f'[xeos] worker: {w.url[:160]}'))
        page.goto(TOOLS + 'bentopdf/', wait_until='load')
        tap_split_card(page)
        page.wait_for_timeout(6000)
        log.append(f'[xeos] url after tapping Split PDF in Portuguese: {page.url}')
        report(log, 'xeos', page, pdf)
        page.screenshot(path=str(OUT / 'xeos.png'))
        context.close()
        browser.close()
    text = '\n'.join(log)
    (OUT / 'split-report.txt').write_text(text, encoding='utf-8')
    print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
