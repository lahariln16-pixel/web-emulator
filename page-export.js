module.exports = function registerPageExport(app, { getSessionPage, getSession }) {
    app.get("/download-page", async (req, res) => {
        try {
            const session = getSession(req);
            if (!session) return res.status(401).send("Session expired");
            const page = await getSessionPage(session);
            const pageUrl = page.url();
            if (!/^https?:\/\//i.test(pageUrl)) return res.status(400).send("Navigate to a website before exporting it.");

            session.lastSeen = Date.now();
            let html = await page.content();
            const resources = await page.evaluate(() => {
                const found = [];
                for (const el of document.querySelectorAll("img[src], source[src], video[poster], audio[src], video[src], link[rel~='stylesheet'][href], script[src]")) {
                    const attr = el.hasAttribute("poster") && !el.hasAttribute("src") ? "poster" : (el.tagName === "LINK" ? "href" : "src");
                    const raw = el.getAttribute(attr);
                    if (!raw) continue;
                    try {
                        const url = new URL(raw, document.baseURI).href;
                        if (url.startsWith("http://") || url.startsWith("https://")) found.push({ raw, url });
                    } catch {}
                }
                return found;
            });

            const unique = [...new Map(resources.map(r => [r.url, r])).values()];
            for (const resource of unique) {
                try {
                    const response = await page.request.get(resource.url, { timeout: 10000 });
                    if (!response.ok()) continue;
                    const body = await response.body();
                    if (body.length > 8 * 1024 * 1024) continue;
                    const contentType = response.headers()["content-type"] || "application/octet-stream";
                    const dataUrl = `data:${contentType.split(";")[0]};base64,${body.toString("base64")}`;
                    if (resource.raw !== resource.url) html = html.split(resource.raw).join(dataUrl);
                    html = html.split(resource.url).join(dataUrl);
                } catch (error) {
                    console.warn("Page export skipped resource:", resource.url, error.message);
                }
            }

            html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${pageUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`);
            const filename = ((await page.title().catch(() => "")) || new URL(pageUrl).hostname)
                .replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "webpage";
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="${filename}.html"`);
            res.send(html);
        } catch (error) {
            console.error("Page export error:", error.message);
            res.status(500).send("Could not export this page: " + error.message);
        }
    });
};
