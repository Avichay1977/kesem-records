"""Read-only playback checks. No media mocks, origin spoofing, or autoplay overrides."""
from __future__ import annotations
import asyncio
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path("verification-results")
OUT.mkdir(exist_ok=True)
SITES = {"built_source": "http://127.0.0.1:4173/", "netlify_live": "https://kesem-records.netlify.app/", "chatgpt_live": "https://kesem-records.tuchmanavi77.chatgpt.site/"}
REPORT = {"created_utc": datetime.now(timezone.utc).isoformat(), "commit": os.getenv("GITHUB_SHA"), "media_mocked": False, "physical_device_tested": False, "audible_output_verified": False, "sites": {}}
SNAPSHOT = """() => { const v=document.querySelector('video'); const p=document.querySelector('#movie_player'); let data={}; try { data=p?.getVideoData?.()||{}; } catch {} return {time:v?.currentTime||0,paused:v?.paused??true,readyState:v?.readyState||0,width:v?.videoWidth||0,muted:v?.muted??null,volume:v?.volume??null,videoId:data.video_id||null,ad:!!document.querySelector('.ad-showing'),text:document.body.innerText.slice(0,1800)}; }"""

def save():
    (OUT / "report.json").write_text(json.dumps(REPORT, ensure_ascii=False, indent=2))

async def snapshot(page):
    for frame in page.frames:
        if "youtube-nocookie.com/embed/" in frame.url or "youtube.com/embed/" in frame.url:
            try:
                return frame, await frame.evaluate(SNAPSHOT)
            except Exception:
                pass
    return None, {}

async def playback(page, source, label, index):
    result = {**source, "status": "unverified", "samples": [], "navigation_unchanged": True}
    start_url = page.url
    buttons = page.locator('[data-kc-play]')
    button = buttons.nth(source["button_index"])
    card = button.locator('xpath=ancestor::*[@data-kc-release][1]')
    try:
        await button.evaluate("el=>{let a=el.parentElement;while(a){if(a.tagName==='DETAILS')a.open=true;a=a.parentElement;}}")
        await button.scroll_into_view_if_needed()
        await button.click(timeout=5000)
        deadline = time.monotonic() + 18
        clicked_native = False
        previous = None
        while time.monotonic() < deadline:
            frame, current = await snapshot(page)
            if current:
                result["samples"].append({k: v for k, v in current.items() if k != "text"})
                result["player_text"] = current.get("text", "")
                same_video = source["platform"] == "youtubePlaylist" or current.get("videoId") == source["id"]
                if previous and not current.get("ad") and not previous.get("ad") and not current.get("paused", True) and current.get("readyState", 0) >= 2 and current.get("width", 0) > 0 and same_video and current.get("videoId") == previous.get("videoId") and current["time"] - previous["time"] >= 1.2:
                    result["status"] = "video_playback_verified"
                    result["clock_advance_seconds"] = round(current["time"] - previous["time"], 3)
                    break
                if not current.get("paused", True) and not current.get("ad"):
                    previous = current
                    await asyncio.sleep(1.7)
                    continue
                if frame and current.get("paused", True) and not clicked_native:
                    for selector in [".ytp-large-play-button", ".ytp-play-button"]:
                        control = frame.locator(selector)
                        if await control.count() and await control.first.is_visible():
                            await control.first.click(timeout=2000)
                            clicked_native = True
                            break
            if not await card.locator("iframe").count():
                break
            await asyncio.sleep(0.8)
        result["navigation_unchanged"] = page.url == start_url
        result["single_active_player"] = await page.locator('[data-kc-embed] iframe').count() <= 1
        status = card.locator('[data-kc-player-status]')
        if await status.count():
            result["site_status"] = await status.inner_text()
        await card.scroll_into_view_if_needed()
        screenshot = f"{label}-video-{index:02d}.png"
        await page.screenshot(path=str(OUT / screenshot))
        result["screenshot"] = screenshot
        text = (result.get("player_text", "") + result.get("site_status", "")).lower()
        if result["status"] != "video_playback_verified":
            if any(x in text for x in ["not a bot", "sign in to confirm", "could not be checked", "longer than expected"]):
                result["status"] = "environment_or_access_blocked"
            elif any(x in text for x in ["does not allow", "unavailable", "private", "origin"]):
                result["status"] = "player_rejected_or_unavailable"
            else:
                result["status"] = "playback_not_verified"
        close = card.locator('[data-kc-stop]')
        if await close.count() and await close.is_visible():
            await close.click(timeout=2000)
        result["closed_cleanly"] = await page.locator('[data-kc-embed] iframe').count() == 0
    except Exception as exc:
        result["error"] = str(exc)[:1000]
        result["status"] = "test_error"
    return result

async def inspect(browser, name, url):
    context = await browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2, user_agent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36")
    page = await context.new_page()
    site = {"url": url, "javascript_errors": [], "failed_requests": [], "layouts": [], "videos": []}
    REPORT["sites"][name] = site
    page.on("pageerror", lambda error: site["javascript_errors"].append(str(error)))
    page.on("requestfailed", lambda request: site["failed_requests"].append({"url": request.url.split("?")[0], "failure": request.failure}))
    try:
        response = await page.goto(url, wait_until="domcontentloaded", timeout=25000)
        site["http_status"] = response.status if response else None
        site["final_url"] = page.url
        site["title"] = await page.title()
        await page.wait_for_timeout(1600)
        site["release_count"] = await page.locator('[data-kc-release]').count()
        for width in [320, 360, 390, 430]:
            await page.set_viewport_size({"width": width, "height": 844})
            await page.wait_for_timeout(150)
            measurement = await page.evaluate("""() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,players:[...document.querySelectorAll('.kc-player-shell')].filter(e=>e.getClientRects().length).map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))})""")
            screenshot = f"{name}-{width}px.png"
            await page.screenshot(path=str(OUT / screenshot))
            measurement["screenshot"] = screenshot
            site["layouts"].append(measurement)
        await page.set_viewport_size({"width": 390, "height": 844})
        sources = await page.locator('[data-kc-play]').evaluate_all("""els=>els.map((b,i)=>({button_index:i,platform:b.dataset.kcMedia,id:b.dataset.kcId,title:b.dataset.kcTitle||b.getAttribute('aria-label'),release:b.closest('[data-kc-release]')?.dataset.kcRelease})).filter(x=>['youtube','youtubePlaylist'].includes(x.platform))""")
        unique = list({f'{s["platform"]}:{s["id"]}': s for s in reversed(sources)}.values())[::-1]
        site["youtube_source_count"] = len(unique)
        if not unique:
            site["status"] = "no_youtube_embed_controls_found"
        else:
            blocked = 0
            for i, source in enumerate(unique):
                if blocked >= 2:
                    site["videos"].append({**source,"status":"not_attempted_after_repeated_environment_failure"})
                    continue
                result = await playback(page, source, name, i + 1)
                site["videos"].append(result)
                if result["status"] in ["environment_or_access_blocked", "test_error"]:
                    blocked += 1
                save()
            site["status"] = "all_video_sources_verified" if all(v["status"] == "video_playback_verified" for v in site["videos"]) else "not_all_video_sources_verified"
        site["structural_checks_pass"] = site["release_count"] > 0 and not site["javascript_errors"] and all(not x["overflow"] for x in site["layouts"])
    except Exception as exc:
        site["status"] = "site_unreachable_or_test_error"
        site["error"] = str(exc)[:1500]
        try:
            await page.screenshot(path=str(OUT / f"{name}-failure.png"))
        except Exception:
            pass
    finally:
        await context.close()
        save()

async def main():
    script = Path("public/catalog.js")
    REPORT["player_script_sha256"] = hashlib.sha256(script.read_bytes()).hexdigest() if script.exists() else None
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        REPORT["browser"] = browser.version
        for name, url in SITES.items():
            await inspect(browser, name, url)
        await browser.close()
    print(json.dumps(REPORT, ensure_ascii=False, indent=2))
    live = REPORT["sites"].get("netlify_live", {})
    raise SystemExit(0 if live.get("status") == "all_video_sources_verified" and live.get("structural_checks_pass") else 1)

if __name__ == "__main__":
    asyncio.run(main())
