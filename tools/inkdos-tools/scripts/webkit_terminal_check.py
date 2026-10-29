#!/usr/bin/env python3
"""Python terminal typing in WebKit (Safari's engine), iPad profile with touch and an XeOS-like profile: the terminal
opened directly, and from the InkDOS Home (Terminal button, panel frame). Types 6*7 and Enter, reports the output and
where the focus is. Diagnostics only."""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

TOOLS = 'https://inkdos-tools.github.io/InkDOS-tools/'
INKDOS = 'https://vfydr2m9wk-ops.github.io/InkDOS/'
XEOS_UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) '
           'Version/18.2 Safari/605.1.15')


def ready(frame) -> None:
    frame.wait_for_function('() => globalThis.pyodide && globalThis.pyodide.FS', timeout=180000)
    frame.wait_for_timeout(1500)


def try_typing(log, name, page, frame) -> None:
    try:
        box = frame.locator('.terminal').bounding_box()
        page.touchscreen.tap(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.wait_for_timeout(500)
        focus = frame.evaluate("() => { const a = document.activeElement; return a ? a.tagName + '.' + a.className : 'none'; }")
        page.keyboard.type('6*7')
        page.keyboard.press('Enter')
        page.wait_for_timeout(2000)
        tail = frame.evaluate("() => document.querySelector('.terminal').innerText.slice(-120)")
        log.append(f'[{name}] focus after tap: {focus} | ' + ('OK: 42 printed' if '\n42' in tail else 'FAILED: ' + repr(tail[-80:])))
    except Exception as error:  # noqa: BLE001
        log.append(f'[{name}] FAILED: {str(error)[:300]}')


def main() -> int:
    log: list[str] = []
    with sync_playwright() as pw:
        browser = pw.webkit.launch()
        profiles = {
            'ipad': dict(pw.devices['iPad (gen 7) landscape']),
            'xeos': dict(viewport={'width': 1180, 'height': 820}, has_touch=True, is_mobile=False,
                         service_workers='block', user_agent=XEOS_UA, locale='pt-BR'),
        }
        for pname, profile in profiles.items():
            context = browser.new_context(**profile)
            page = context.new_page()
            page.on('pageerror', lambda e, n=pname: log.append(f'[{n}] pageerror: {str(e)[:200]}'))
            page.goto(TOOLS + 'python/', wait_until='load')
            ready(page)
            try_typing(log, f'{pname}/direct', page, page.main_frame)
            context.close()
            context = browser.new_context(**profile)
            context.add_init_script('window.open = () => null;')
            page = context.new_page()
            page.goto(INKDOS, wait_until='load')
            page.locator('[data-quick-tool="python"]').tap()
            frame = None
            for _ in range(120):
                frame = next((f for f in page.frames if '/python/' in f.url), None)
                if frame:
                    break
                page.wait_for_timeout(500)
            if not frame:
                log.append(f'[{pname}/home-panel] FAILED: no terminal frame')
            else:
                ready(frame)
                try_typing(log, f'{pname}/home-panel', page, frame)
            context.close()
        browser.close()
    print('\n'.join(log))
    return 0


if __name__ == '__main__':
    sys.exit(main())
