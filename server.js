const express = require("express");
const http = require("http");
const dns = require("dns").promises;
const net = require("net");
const WebSocket = require("ws");
const { chromium } = require("playwright");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static("public"));

let browser;
let page;

function isPrivateIPv4(ip) {
    const parts = ip.split(".").map(Number);

    if (parts.length !== 4 || parts.some(Number.isNaN)) {
        return false;
    }

    const [a, b] = parts;

    return (
        a === 10 ||
        a === 127 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254) ||
        a === 0
    );
}

function isPrivateIPv6(ip) {
    const normalized = ip.toLowerCase();

    return (
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe8") ||
        normalized.startsWith("fe9") ||
        normalized.startsWith("fea") ||
        normalized.startsWith("feb")
    );
}

async function validateUrl(rawUrl) {

    let parsed;

    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error("Invalid URL");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Only HTTP and HTTPS URLs are allowed");
    }

    if (parsed.username || parsed.password) {
        throw new Error("URLs containing credentials are not allowed");
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "local"
    ) {
        throw new Error("Local addresses are not allowed");
    }

    const directIp = net.isIP(hostname);

    if (directIp === 4 && isPrivateIPv4(hostname)) {
        throw new Error("Private IPv4 addresses are not allowed");
    }

    if (directIp === 6 && isPrivateIPv6(hostname)) {
        throw new Error("Private IPv6 addresses are not allowed");
    }

    if (!directIp) {

        const addresses = await dns.lookup(hostname, {
            all: true
        });

        for (const address of addresses) {

            if (
                (net.isIP(address.address) === 4 &&
                 isPrivateIPv4(address.address)) ||
                (net.isIP(address.address) === 6 &&
                 isPrivateIPv6(address.address))
            ) {
                throw new Error(
                    "The hostname resolves to a private address"
                );
            }
        }
    }

    return parsed.toString();
}

async function setupPage() {

    if (page && !page.isClosed()) {
        return page;
    }

    page = await browser.newPage({
        viewport: {
            width: 1024,
            height: 576
        }
    });

    page.setDefaultNavigationTimeout(30000);

    return page;
}

async function startBrowser() {

    console.log("Starting remote Chromium...");

    const browserArgs =
        process.env.NODE_ENV === "production"
            ? []
            : ["--ignore-certificate-errors"];

    browser = await chromium.launch({
        headless: true,
        args: browserArgs
    });

    await setupPage();

    console.log("Remote Chromium started!");
}

async function getPage() {

    if (!browser || !browser.isConnected()) {
        await startBrowser();
    }

    return setupPage();
}

async function sendScreenshot(ws) {

    if (ws.readyState !== WebSocket.OPEN) {
        return;
    }

    if (!page || page.isClosed()) {
        return;
    }

    try {

        const screenshot = await page.screenshot({
            type: "jpeg",
            quality: 55
        });

        ws.send(screenshot);

    } catch (error) {

        console.error(
            "Screenshot error:",
            error.message
        );

    }
}

wss.on("connection", async (ws) => {

    console.log("Web emulator connected!");

    try {

        await getPage();

        const interval = setInterval(() => {
            sendScreenshot(ws);
        }, 500);

        let inputQueue = Promise.resolve();

        ws.on("message", (raw) => {

            inputQueue = inputQueue.then(async () => {

                try {

                    const event = JSON.parse(
                        raw.toString()
                    );

                    if (!page || page.isClosed()) {
                        return;
                    }

                    if (event.type === "ping") {
                        return;
                    }

                    if (event.type === "ping") {
                        return;
                    }

                    if (event.type === "click") {

                        await page.mouse.click(
                            event.x,
                            event.y
                        );

                    }

                    else if (event.type === "wheel") {

                        await page.mouse.wheel(
                            event.deltaX,
                            event.deltaY
                        );

                    }

                    else if (event.type === "keydown") {

                        if (event.text) {

                            await page.keyboard.insertText(
                                event.text
                            );

                        } else if (event.key) {

                            await page.keyboard.press(
                                event.key
                            );

                        }

                    }

                } catch (error) {

                    console.error(
                        "Input error:",
                        error.message
                    );

                }

            });

        });

        ws.on("close", () => {

            console.log(
                "Web emulator disconnected!"
            );

            clearInterval(interval);

        });

    } catch (error) {

        console.error(
            "WebSocket error:",
            error.message
        );

        ws.close();
    }

});

app.post("/navigate", async (req, res) => {

    let url = req.body.url;

    console.log(
        "Requested URL:",
        url
    );

    if (!url) {

        return res.status(400).json({
            success: false,
            error: "No URL provided"
        });

    }

    if (
        !url.startsWith("http://") &&
        !url.startsWith("https://")
    ) {
        url = "https://" + url;
    }

    try {

        url = await validateUrl(url);

        const currentPage = await getPage();

        await currentPage.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        res.json({
            success: true,
            url: currentPage.url(),
            title: await currentPage.title()
        });

    } catch (error) {

        console.error(
            "Navigation error:",
            error.message
        );

        res.status(500).json({
            success: false,
            error: error.message
        });

    }

});

app.post("/back", async (req, res) => {

    try {

        const currentPage = await getPage();

        await currentPage.goBack({
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        res.json({
            success: true,
            url: currentPage.url(),
            title: await currentPage.title()
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            error: error.message
        });

    }

});

app.post("/forward", async (req, res) => {

    try {

        const currentPage = await getPage();

        await currentPage.goForward({
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        res.json({
            success: true,
            url: currentPage.url(),
            title: await currentPage.title()
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            error: error.message
        });

    }

});

app.post("/reload", async (req, res) => {

    try {

        const currentPage = await getPage();

        await currentPage.reload({
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        res.json({
            success: true,
            url: currentPage.url(),
            title: await currentPage.title()
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            error: error.message
        });

    }

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {

    console.log(
        `Remote Web Emulator running on port ${PORT}`
    );

});
