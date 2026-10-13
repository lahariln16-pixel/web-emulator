const crypto = require("crypto");

module.exports = function registerTabRoutes(app, { sessions, getSessionPage }) {
    function sessionFor(req) {
        const raw = (req.headers.cookie || "").split(";").map(p => p.trim()).find(p => p.startsWith("emulator_session="));
        if (!raw) return null;
        try { return sessions.get(decodeURIComponent(raw.slice("emulator_session=".length))) || null; }
        catch { return null; }
    }
    function ensureId(session, page) {
        if (!page.__emulatorTabId) {
            session.tabCounter = (session.tabCounter || 0) + 1;
            page.__emulatorTabId = `tab-${session.tabCounter}-${crypto.randomBytes(3).toString("hex")}`;
        }
        return page.__emulatorTabId;
    }
    async function describeTabs(session) {
        if (!session.context || session.context.isClosed()) return [];
        return Promise.all(session.context.pages().filter(p => !p.isClosed()).map(async page => ({
            id: ensureId(session, page),
            title: await page.title().catch(() => "New tab"),
            url: page.url() || "about:blank",
            active: page === session.page
        })));
    }
    app.get("/tabs", async (req, res) => {
        try {
            const session = sessionFor(req);
            if (!session) return res.status(401).json({ success:false, error:"Session expired" });
            await getSessionPage(session); session.lastSeen = Date.now();
            res.json({ success:true, tabs:await describeTabs(session) });
        } catch (e) { res.status(500).json({ success:false, error:e.message }); }
    });
    app.post("/tabs", async (req, res) => {
        try {
            const session = sessionFor(req);
            if (!session) return res.status(401).json({ success:false, error:"Session expired" });
            await getSessionPage(session);
            const page = await session.context.newPage();
            page.setDefaultNavigationTimeout(30000);
            ensureId(session, page); session.page = page; session.lastSeen = Date.now();
            res.json({ success:true, tabs:await describeTabs(session), activeTabId:page.__emulatorTabId });
        } catch (e) { res.status(500).json({ success:false, error:e.message }); }
    });
    app.post("/tabs/:id/activate", async (req, res) => {
        try {
            const session = sessionFor(req);
            if (!session) return res.status(401).json({ success:false, error:"Session expired" });
            await getSessionPage(session);
            const page = session.context.pages().find(p => !p.isClosed() && ensureId(session,p) === req.params.id);
            if (!page) return res.status(404).json({ success:false, error:"Tab not found" });
            session.page = page; session.lastSeen = Date.now();
            res.json({ success:true, tabs:await describeTabs(session), activeTabId:page.__emulatorTabId, url:page.url() });
        } catch (e) { res.status(500).json({ success:false, error:e.message }); }
    });
    app.delete("/tabs/:id", async (req, res) => {
        try {
            const session = sessionFor(req);
            if (!session) return res.status(401).json({ success:false, error:"Session expired" });
            await getSessionPage(session);
            const page = session.context.pages().find(p => !p.isClosed() && ensureId(session,p) === req.params.id);
            if (!page) return res.status(404).json({ success:false, error:"Tab not found" });
            const wasActive = page === session.page;
            await page.close();
            let remaining = session.context.pages().filter(p => !p.isClosed());
            if (!remaining.length) {
                const replacement = await session.context.newPage();
                replacement.setDefaultNavigationTimeout(30000); ensureId(session,replacement);
                remaining = [replacement];
            }
            if (wasActive) session.page = remaining[remaining.length - 1];
            session.lastSeen = Date.now();
            res.json({ success:true, tabs:await describeTabs(session), activeTabId:session.page.__emulatorTabId, url:session.page.url() });
        } catch (e) { res.status(500).json({ success:false, error:e.message }); }
    });
};
