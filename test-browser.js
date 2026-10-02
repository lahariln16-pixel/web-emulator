const { chromium } = require("playwright");

(async () => {

    const browser = await chromium.launch({
        headless: false,
        args: [
            "--ignore-certificate-errors"
        ]
    });

    const page = await browser.newPage();

    await page.goto("https://example.com");

    console.log("Website loaded!");
    console.log("Title:", await page.title());

})();
