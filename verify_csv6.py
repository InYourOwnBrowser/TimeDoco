import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("http://localhost:5173/TimeTag/")

        # Click the Settings button (gear icon)
        await page.click('button[title="Settings"]')

        # Wait for Settings Modal to appear
        await page.wait_for_selector('text=Settings', state='visible')

        # Scroll the modal
        await page.evaluate('''
            const modalBody = document.querySelector(".max-h-\\[80vh\\]");
            if(modalBody) { modalBody.scrollTo(0, modalBody.scrollHeight); }
        ''')
        await page.wait_for_timeout(500)

        # We can take a screenshot
        await page.screenshot(path='/home/jules/verification/screenshots/verification6.png')
        await browser.close()

asyncio.run(main())
