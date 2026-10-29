#!/usr/bin/env python3
"""Open the published tools site in WebKit (Safari's engine) with an iPad profile and report what happens:
console errors, page errors, failed requests and whether clicks on tools navigate. Diagnostics only."""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

SITE = 'https://inkdos-tools.github.io/InkDOS-tools/'
INKDOS = 'https://vfydr2m9wk-ops.github.io/InkDOS/'
OUT = Path('webkit-report')


def watch(page, log: list[str]) -> None:
    page.on('console', lambda m: log.append(f'console.{m.type}: {m.text[:400]}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: log.append(f'pageerror: {str(e)[:400]}'))
    page.on('requestfailed', lambda r: log.append(f'requestfailed: {r.url[:200]} {r.failure}'))
    page.on('framenavigated', lambda f: log.append(f'navigated: {f.url}') if f == page.main_frame else None)


def main() -> int:
    OUT.mkdir(exist_ok=True)
    log: list[str] = []
    with sync_playwright() as pw:
        browser = pw.webkit.launch()
        context = browser.new_context(**pw.devices['iPad (gen 7) landscape'])
        page = context.new_page()
        watch(page, log)
        # PDF toolkit: start page, then a tool card
        log.append('== bentopdf start page')
        page.goto(SITE + 'bentopdf/?inkdos-theme=light', wait_until='load')
        page.wait_for_timeout(6000)
        log.append(f'url after load: {page.url}; crossOriginIsolated={page.evaluate("self.crossOriginIsolated")}; '
                   f'serviceWorker controller={page.evaluate("!!(navigator.serviceWorker && navigator.serviceWorker.controller)")}')
        cards = page.locator('a.tool-card')
        log.append(f'tool cards: {cards.count()}')
        page.screenshot(path=str(OUT / 'bentopdf-start.png'))
        for name in ('merge-pdf', 'word-to-pdf', 'pdf-to-docx'):
            link = page.locator(f'a.tool-card[href*="{name}"]').first
            log.append(f'== click {name}: href={link.get_attribute("href") if link.count() else None}')
            if not link.count():
                continue
            before = page.url
            link.scroll_into_view_if_needed()
            link.click()
            page.wait_for_timeout(5000)
            log.append(f'url before={before} after={page.url}')
            page.screenshot(path=str(OUT / f'after-{name}.png'))
            page.goto(SITE + 'bentopdf/', wait_until='load')
            page.wait_for_timeout(3000)
        # a tool page opened directly
        log.append('== direct word-to-pdf')
        page.goto(SITE + 'bentopdf/word-to-pdf.html', wait_until='load')
        page.wait_for_timeout(8000)
        log.append(f'url={page.url}; crossOriginIsolated={page.evaluate("self.crossOriginIsolated")}; '
                   f'file input={page.locator("#file-input").count()}')
        page.screenshot(path=str(OUT / 'word-to-pdf.png'))
        # iPhone, as in a user's screen recording: tap the first editor cards and follow every navigation
        log.append('== iPhone: tap tool cards')
        phone_ctx = browser.new_context(**pw.devices['iPhone 15 Pro'])
        phone = phone_ctx.new_page()
        watch(phone, log)
        phone.goto(SITE + 'bentopdf/', wait_until='load')
        phone.wait_for_timeout(6000)
        log.append(f'phone url={phone.url}; isolated={phone.evaluate("self.crossOriginIsolated")}; '
                   f'cards a={phone.locator("a.tool-card").count()} div={phone.locator("div.tool-card").count()}')
        for name in ('edit-pdf', 'edit-pdf-text', 'merge-pdf', 'word-to-pdf'):
            card = phone.locator(f'a.tool-card[href$="/{name}.html"]').first
            if not card.count():
                log.append(f'no card for {name}')
                continue
            card.scroll_into_view_if_needed()
            card.tap()
            for second in range(1, 9):
                phone.wait_for_timeout(1000)
                log.append(f'  {name} +{second}s url={phone.url}')
            phone.screenshot(path=str(OUT / f'phone-{name}.png'))
            if phone.url.rstrip('/').endswith('bentopdf') is False:
                phone.goto(SITE + 'bentopdf/', wait_until='load')
                phone.wait_for_timeout(3000)
        phone_ctx.close()
        # the InkDOS Home: Advanced tools -> PDF toolkit (a new tab) and a panel tool (a frame)
        log.append('== InkDOS Home -> Advanced tools -> PDF toolkit')
        home = context.new_page()
        watch(home, log)
        home.goto(INKDOS, wait_until='load')
        home.wait_for_timeout(3000)
        home.click('#advancedToolsButton')
        home.wait_for_timeout(800)
        try:
            with context.expect_page(timeout=10000) as opened:
                home.locator('.tools-item[data-tool-id="bentopdf"]').click()
            tab = opened.value
            watch(tab, log)
            tab.wait_for_load_state('load')
            tab.wait_for_timeout(6000)
            log.append(f'new tab: {tab.url}; cards={tab.locator("a.tool-card").count()}')
            tab.locator('a.tool-card[href*="merge-pdf"]').first.click()
            tab.wait_for_timeout(5000)
            log.append(f'after card click in new tab: {tab.url}')
            tab.close()
        except Exception as error:  # noqa: BLE001 - diagnostics
            log.append(f'no new tab: {error}')
        home.screenshot(path=str(OUT / 'home-after-pdf.png'))
        # the toolkit framed by another origin (as in a web desktop or the InkDOS panel)
        log.append('== PDF toolkit framed by another origin')
        host = context.new_page()
        watch(host, log)
        host.goto(INKDOS, wait_until='load')
        host.evaluate("""src => { document.body.innerHTML = ''; const f = document.createElement('iframe');
            f.src = src; f.style.cssText = 'width:1000px;height:700px;border:0'; document.body.appendChild(f); }""",
            SITE + 'bentopdf/')
        host.wait_for_timeout(9000)
        frame = next((f for f in host.frames if '/bentopdf/' in f.url), None)
        if frame:
            log.append(f'frame: {frame.url}; cards={frame.locator("a.tool-card").count()}')
            card = frame.locator('a.tool-card[href*="merge-pdf"]').first
            if card.count():
                card.click()
                host.wait_for_timeout(6000)
                frame = next((f for f in host.frames if '/bentopdf/' in f.url), None)
                log.append(f'after card click in frame: {frame.url if frame else None}')
        host.screenshot(path=str(OUT / 'framed.png'))
        browser.close()
    text = '\n'.join(log)
    (OUT / 'report.txt').write_text(text + '\n', encoding='utf-8')
    print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
