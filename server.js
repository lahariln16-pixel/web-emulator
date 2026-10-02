const express = require("express");
const http = require("http");
const dns = require("dns").promises;
const net = require("net");
const crypto = require("crypto");
const path = require("path");

const WebSocket = require("ws");
const { chromium } = require("playwright");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

/*
====================================================
AUTHENTICATION
====================================================
*/

const sessions = new Map();

const SESSION_IDLE_MS = 30 * 60 * 1000;

function getCookie(req, name) {

    const cookies = req.headers.cookie || "";

    for (const part of cookies.split(";")) {

        const [key, ...value] = part.trim().split("=");

        if (key === name) {
            return decodeURIComponent(value.join("="));
        }
    }

    return null;
}

function getSession(req) {

    const token = getCookie(
        req,
        "emulator_session"
    );

    if (!token) {
        return null;
    }

    return sessions.get(token) || null;
}

function isAuthenticated(req) {

    return Boolean(getSession(req));
}

function createSession() {

    const token = crypto
        .randomBytes(32)
        .toString("hex");

    sessions.set(token, {

        context: null,
        page: null,

        createdAt: Date.now(),
        lastSeen: Date.now()

    });

    return token;
}

async function destroySession(token) {

    const session = sessions.get(token);

    if (!session) {
        return;
    }

    try {

        if (
            session.context &&
            !session.context.isClosed()
        ) {
            await session.context.close();
        }

    } catch (error) {

        console.error(
            "Session cleanup error:",
            error.message
        );

    }

    sessions.delete(token);
}

app.post("/login", (req, res) => {

    const password = req.body.password || "";

    const correctPassword =
        process.env.EMULATOR_PASSWORD;

    if (!correctPassword) {

        return res.status(500).json({
            success: false,
            error: "EMULATOR_PASSWORD is not configured"
        });

    }

    if (password !== correctPassword) {

        return res.status(401).json({
            success: false,
            error: "Incorrect password"
        });

    }

    const token = createSession();

    res.setHeader(
        "Set-Cookie",
        `emulator_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=43200; SameSite=Lax;${process.env.NODE_ENV === "production" ? " Secure;" : ""}`
    );

    console.log(
        "New browser session created"
    );

    res.json({
        success: true
    });

});

app.get("/login", (req, res) => {

    if (isAuthenticated(req)) {
        return res.redirect("/");
    }

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "login.html"
        )
    );

});

/*
====================================================
AUTH PROTECTION
====================================================
*/

app.use((req, res, next) => {

    if (
        req.path === "/login" ||
        req.path === "/login.html"
    ) {
        return next();
    }

    if (!isAuthenticated(req)) {

        return res.redirect("/login");

    }

    next();

});

app.use(express.static("public"));

/*
====================================================
PLAYWRIGHT
====================================================
*/

let browser;
let browserStarting = null;

async function startBrowser() {

    if (browserStarting) {
        return browserStarting;
    }

    browserStarting = (async () => {

        console.log(
            "Starting shared Chromium process..."
        );

        const browserArgs =
            process.env.NODE_ENV === "production"
                ? ["--disable-dev-shm-usage"]
                : [
                    "--ignore-certificate-errors",
                    "--disable-dev-shm-usage"
                ];

        browser = await chromium.launch({

            headless: true,

            args: browserArgs

        });

        console.log(
            "Shared Chromium process started!"
        );

    })();

    try {

        await browserStarting;

    } finally {

        browserStarting = null;

    }

}

async function getBrowser() {

    if (
        !browser ||
        !browser.isConnected()
    ) {
        await startBrowser();
    }

    return browser;
}

async function getSessionPage(session) {

    session.lastSeen = Date.now();

    await getBrowser();

    if (
        session.page &&
        !session.page.isClosed()
    ) {
        return session.page;
    }

    console.log(
        "Creating isolated browser session..."
    );

    session.context =
        await browser.newContext({

            viewport: {
                width: 1024,
                height: 576
            }

        });

    session.page =
        await session.context.newPage();

    session.page.setDefaultNavigationTimeout(
        30000
    );

    console.log(
        "Isolated browser session created!"
    );

    return session.page;

}

/*
====================================================
URL SECURITY
====================================================
*/

function isPrivateIPv4(ip) {

    const parts =
        ip.split(".").map(Number);

    if (
        parts.length !== 4 ||
        parts.some(Number.isNaN)
    ) {
        return false;
    }

    const [a, b] = parts;

    return (
        a === 10 ||
        a === 127 ||
        (a === 172 &&
            b >= 16 &&
            b <= 31) ||
        (a === 192 &&
            b === 168) ||
        (a === 169 &&
            b === 254) ||
        a === 0
    );

}

function isPrivateIPv6(ip) {

    const normalized =
        ip.toLowerCase();

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

        throw new Error(
            "Invalid URL"
        );

    }

    if (
        !["http:", "https:"].includes(
            parsed.protocol
        )
    ) {

        throw new Error(
            "Only HTTP and HTTPS URLs are allowed"
        );

    }

    if (
        parsed.username ||
        parsed.password
    ) {

        throw new Error(
            "URLs containing credentials are not allowed"
        );

    }

    const hostname =
        parsed.hostname.toLowerCase();

    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "local"
    ) {

        throw new Error(
            "Local addresses are not allowed"
        );

    }

    const directIp =
        net.isIP(hostname);

    if (
        directIp === 4 &&
        isPrivateIPv4(hostname)
    ) {

        throw new Error(
            "Private IPv4 addresses are not allowed"
        );

    }

    if (
        directIp === 6 &&
        isPrivateIPv6(hostname)
    ) {

        throw new Error(
            "Private IPv6 addresses are not allowed"
        );

    }

    if (!directIp) {

        const addresses =
            await dns.lookup(
                hostname,
                {
                    all: true
                }
            );

        for (const address of addresses) {

            if (
                (
                    net.isIP(
                        address.address
                    ) === 4 &&
                    isPrivateIPv4(
                        address.address
                    )
                ) ||
                (
                    net.isIP(
                        address.address
                    ) === 6 &&
                    isPrivateIPv6(
                        address.address
                    )
                )
            ) {

                throw new Error(
                    "The hostname resolves to a private address"
                );

            }

        }

    }

    return parsed.toString();

}

/*
====================================================
SCREENSHOT STREAM
====================================================
*/

async function sendScreenshot(
    ws,
    session
) {

    if (
        ws.readyState !==
        WebSocket.OPEN
    ) {
        return;
    }

    const page = session.page;

    if (
        !page ||
        page.isClosed()
    ) {
        return;
    }

    try {

        const screenshot =
            await page.screenshot({

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

/*
====================================================
WEBSOCKET
====================================================
*/

wss.on(
    "connection",
    async (ws, request) => {

        const cookieHeader =
            request.headers.cookie || "";

        let token = null;

        for (
            const part
            of cookieHeader.split(";")
        ) {

            const [
                key,
                ...value
            ] = part.trim().split("=");

            if (
                key ===
                "emulator_session"
            ) {

                token =
                    decodeURIComponent(
                        value.join("=")
                    );

            }

        }

        const session =
            token
                ? sessions.get(token)
                : null;

        if (!session) {

            console.log(
                "Rejected unauthenticated WebSocket"
            );

            ws.close(1008);

            return;

        }

        console.log(
            "Web emulator connected to its own session!"
        );

        try {

            await getSessionPage(
                session
            );

            const interval =
                setInterval(() => {

                    sendScreenshot(
                        ws,
                        session
                    );

                }, 500);

            const pingInterval =
                setInterval(() => {

                    if (
                        ws.readyState ===
                        WebSocket.OPEN
                    ) {
                        ws.ping();
                    }

                }, 30000);

            let inputQueue =
                Promise.resolve();

            ws.on(
                "message",
                (raw) => {

                    inputQueue =
                        inputQueue.then(
                            async () => {

                                try {

                                    const event =
                                        JSON.parse(
                                            raw.toString()
                                        );

                                    const page =
                                        await getSessionPage(
                                            session
                                        );

                                    if (
                                        event.type ===
                                        "ping"
                                    ) {
                                        return;
                                    }

                                    if (
                                        event.type ===
                                        "click"
                                    ) {

                                        await page.mouse.click(
                                            event.x,
                                            event.y
                                        );

                                    }

                                    else if (
                                        event.type ===
                                        "wheel"
                                    ) {

                                        await page.mouse.wheel(
                                            event.deltaX,
                                            event.deltaY
                                        );

                                    }

                                    else if (
                                        event.type ===
                                        "keydown"
                                    ) {

                                        if (
                                            event.text
                                        ) {

                                            await page.keyboard.insertText(
                                                event.text
                                            );

                                        }

                                        else if (
                                            event.key
                                        ) {

                                            await page.keyboard.press(
                                                event.key
                                            );

                                        }

                                    }

                                } catch (
                                    error
                                ) {

                                    console.error(
                                        "Input error:",
                                        error.message
                                    );

                                }

                            }
                        );

                }
            );

            ws.on(
                "close",
                () => {

                    console.log(
                        "Web emulator WebSocket disconnected"
                    );

                    clearInterval(
                        interval
                    );

                    clearInterval(
                        pingInterval
                    );

                    /*
                    We deliberately KEEP the
                    browser context alive.

                    This means a temporary WebSocket
                    reconnect does not destroy the
                    user's cookies/history/session.
                    */

                }
            );

        } catch (error) {

            console.error(
                "WebSocket setup error:",
                error.message
            );

            ws.close();

        }

    }
);

/*
====================================================
NAVIGATION
====================================================
*/

app.post(
    "/navigate",
    async (req, res) => {

        let url =
            req.body.url;

        console.log(
            "Requested URL:",
            url
        );

        if (!url) {

            return res.status(400).json({

                success: false,

                error:
                    "No URL provided"

            });

        }

        if (
            !url.startsWith("http://") &&
            !url.startsWith("https://")
        ) {

            url =
                "https://" + url;

        }

        try {

            url =
                await validateUrl(url);

            const session =
                getSession(req);

            const page =
                await getSessionPage(
                    session
                );

            await page.goto(
                url,
                {
                    waitUntil:
                        "domcontentloaded",

                    timeout:
                        30000
                }
            );

            res.json({

                success: true,

                url:
                    page.url(),

                title:
                    await page.title()

            });

        } catch (error) {

            console.error(
                "Navigation error:",
                error.message
            );

            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);

/*
====================================================
BACK
====================================================
*/

app.post(
    "/back",
    async (req, res) => {

        try {

            const session =
                getSession(req);

            const page =
                await getSessionPage(
                    session
                );

            await page.goBack({

                waitUntil:
                    "domcontentloaded",

                timeout:
                    30000

            });

            res.json({

                success: true,

                url:
                    page.url(),

                title:
                    await page.title()

            });

        } catch (error) {

            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);

/*
====================================================
FORWARD
====================================================
*/

app.post(
    "/forward",
    async (req, res) => {

        try {

            const session =
                getSession(req);

            const page =
                await getSessionPage(
                    session
                );

            await page.goForward({

                waitUntil:
                    "domcontentloaded",

                timeout:
                    30000

            });

            res.json({

                success: true,

                url:
                    page.url(),

                title:
                    await page.title()

            });

        } catch (error) {

            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);

/*
====================================================
RELOAD
====================================================
*/

app.post(
    "/reload",
    async (req, res) => {

        try {

            const session =
                getSession(req);

            const page =
                await getSessionPage(
                    session
                );

            await page.reload({

                waitUntil:
                    "domcontentloaded",

                timeout:
                    30000

            });

            res.json({

                success: true,

                url:
                    page.url(),

                title:
                    await page.title()

            });

        } catch (error) {

            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);

/*
====================================================
LOGOUT
====================================================
*/

app.post(
    "/logout",
    async (req, res) => {

        const token =
            getCookie(
                req,
                "emulator_session"
            );

        if (token) {

            await destroySession(
                token
            );

        }

        res.setHeader(
            "Set-Cookie",
            "emulator_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
        );

        res.json({
            success: true
        });

    }
);

/*
====================================================
SESSION CLEANUP
====================================================
*/

setInterval(
    async () => {

        const now =
            Date.now();

        for (
            const [
                token,
                session
            ] of sessions
        ) {

            if (
                now -
                session.lastSeen >
                SESSION_IDLE_MS
            ) {

                console.log(
                    "Removing idle browser session"
                );

                await destroySession(
                    token
                );

            }

        }

    },
    5 * 60 * 1000
);

/*
====================================================
SERVER
====================================================
*/

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Remote Web Emulator running on port ${PORT}`
        );

    }
);
