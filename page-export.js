module.exports = function registerPageExport(app, { getSessionPage, getSession }) {
    app.get("/download-page", async (req, res) => {
        try {
            const session = getSession(req);
            if (!session) return res.status(401).send("Session expired");

            const page = await getSessionPage(session);
            const pageUrl = page.url();
            if (!/^https?:\/\//i.test(pageUrl)) {
                return res.status(400).send("Navigate to a website before exporting it.");
            }

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
                        if (url.startsWith("http://") || url.startsWith("https://")) found.push({ tag: el.tagName, attr, raw, url });
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
                    const escaped = resource.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    if (resource.tag === "LINK") {
                        const linkPattern = new RegExp('<link\\b(?=[^>]*\\brel=["\\'][^"\\']*stylesheet[^"\\']*["\\'])(?=[^>]*\\bhref=["\\']' + escaped + '["\\'])[^>]*>', "gi");
                        html = html.replace(linkPattern, `<link rel="stylesheet" href="${dataUrl}">`);
                    } else if (resource.tag === "SCRIPT") {
                        const scriptPattern = new RegExp('<script\\b(?=[^>]*\\bsrc=["\\']' + escaped + '["\\'])[^>]*>\\s*</script>', "gi");
                        html = html.replace(scriptPattern, `<script>${body.toString("utf8").replace(/<\\/script/gi, "<\\\\/script")}</script>`);
                    } else {
                        const rawEscaped = resource.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        html = html.replace(new RegExp('([\\s]'+resource.attr+'=["\\'])' + rawEscaped + '(["\\'])', "g"), `$1${dataUrl}$2`);
                        html = html.replace(new RegExp('([\\s]'+resource.attr+'=["\\'])' + escaped + '(["\\'])', "g"), `$1${dataUrl}$2`);
                    }
                } catch (error) {
                    console.warn("Page export skipped resource:", resource.url, error.message);
                }
            }

            // Relative URLs that could not be embedded can still resolve against the original site.
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
