# Reddit console scraper v8: RSS (fast)

Reads Reddit's RSS feeds instead of rendering pages: search results via `search.rss`, then each thread's post and comments via `/comments/<id>/.rss`. No hidden frames, no ads, about 1–1.5 s per request. Expect **20–30 minutes** for everything.

Same safety as v7:
- retries network errors and rate limits instead of crashing
- remembers progress, so pasting it again **resumes**
- checkpoint file every 75 threads (`reddit_rss_part_N.json`) plus `reddit_rss.json` at the end
- `__rssSave()` downloads what's collected at any moment; `__rssReset()` clears saved progress

## Steps
1. Refresh the Reddit tab (stops any old script).
2. Stay on **www.reddit.com**, signed in. F12 → Console → paste → Enter. Keep the tab in front.
3. First line should be `CHECK search: N posts | thread: M entries`. If it says STOP, send me that line.

```js
(async () => { try {
  const SUBS = ["IndiaInvestments", "mutualfunds", "personalfinanceindia", "FIREIndia", "IndianStockMarket", "StockMarketIndia"];
  const QUERIES = ["first SIP", "stopped SIP", "stop my SIP", "pause SIP", "skip SIP", "SIP negative returns",
    "continue SIP or stop", "new to mutual funds", "SIP one year", "SIP not growing", "Groww SIP", "SIP mandate failed",
    "SIP worth it", "beginner mutual fund", "SIP in red", "should I stop SIP", "SIP loss", "started investing mutual funds",
    "SIP returns disappointing", "cancelled SIP", "SIP autopay", "first salary invest"];
  const SORTS = ["relevance", "top", "new", "comments"];
  const DELAY = 1100, MAX_THREADS = 700, CHECKPOINT_EVERY = 75;
  const KW = /\bsips?\b|systematic investment|mutual ?funds?|\bmfs?\b|\bnav\b|xirr|instal+ments?|mandate|autopay|auto ?debit|elss|index fund|small ?cap|mid ?cap|step ?up|redeem|redemption/i;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => (s || "").replace(/\s+/g, " ").trim();
  const htmlText = h => clean(new DOMParser().parseFromString(h || "", "text/html").body.textContent)
    .replace(/submitted by \/u\/\S+.*?(\[link\]|\[comments\]).*$/i, "").replace(/\[link\]\s*\[comments\]\s*$/i, "").trim();
  const day = v => { const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
  if (!/(^|\.)reddit\.com$/.test(location.hostname)) { console.error("STOP: run this on https://www.reddit.com/"); return; }

  async function getXml(url) {
    for (let a = 0; a < 6; a++) {
      let r;
      try { r = await fetch(url, { credentials: "include" }); }
      catch (e) { console.warn(`network error, waiting ${10 * (a + 1)}s`); await sleep(10000 * (a + 1)); continue; }
      if (r.status === 429) { console.log("rate limited, waiting", 30 * (a + 1), "s"); await sleep(30000 * (a + 1)); continue; }
      if (!r.ok) return { status: r.status, entries: [] };
      const x = new DOMParser().parseFromString(await r.text(), "text/xml");
      return { status: 200, entries: [...x.getElementsByTagName("entry")] };
    }
    return { status: "gave-up", entries: [] };
  }
  const g = (e, tag) => e.getElementsByTagName(tag)[0];
  const parseEntry = e => ({
    fullId: clean(g(e, "id")?.textContent),                       // t3_xxx (post) or t1_xxx (comment)
    link: g(e, "link")?.getAttribute("href") || "",
    title: clean(g(e, "title")?.textContent),
    when: g(e, "published")?.textContent || g(e, "updated")?.textContent,
    text: htmlText(g(e, "content")?.textContent)
  });

  // ---- persistent state ----
  const LS = "groww_sip_reddit_rss_v8";
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } })();
  const R = window.__rss = window.__rss || { items: new Map(), found: new Map(saved.found || []), done: new Set(saved.done || []),
    searched: new Set(saved.searched || []), part: 0, failures: 0 };
  const persist = () => { try { localStorage.setItem(LS, JSON.stringify({ found: [...R.found], done: [...R.done], searched: [...R.searched] })); } catch {} };
  const download = name => {
    const all = [...R.items.values()];
    const cnt = (s, kw) => all.filter(x => x.source === s && (kw ? x.kw_match : true)).length;
    const runs = [
      { source: "reddit_post", pass: "rss_search_threads", fetched: cnt("reddit_post"), kept: cnt("reddit_post", 1),
        notes: `${SUBS.length} subs x ${QUERIES.length} queries x ${SORTS.length} sorts via search.rss; ${R.found.size} unique posts; ${R.failures} failures` },
      { source: "reddit_comment", pass: "rss_thread_comments", fetched: cnt("reddit_comment"), kept: cnt("reddit_comment", 1),
        notes: `comments from /comments/<id>/.rss?limit=100; ${R.done.size} threads read` }];
    const blob = new Blob([JSON.stringify({ study: "groww-sip-continuation", collected_at: new Date().toISOString(), items: all, runs })], { type: "application/json" });
    Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name }).click();
    console.log(`saved ${name}: ${all.length} items`);
  };
  window.__rssSave = () => download(`reddit_rss_manual_${Date.now()}.json`);
  window.__rssReset = () => { localStorage.removeItem(LS); delete window.__rss; console.log("cleared"); };
  const add = x => R.items.set(x.source + x.ext_id, x);

  // ---- self-check ----
  const t1 = await getXml(`/r/${SUBS[0]}/search.rss?q=SIP&restrict_sr=1&sort=relevance&t=all&limit=100`);
  const firstPost = t1.entries.map(parseEntry).find(p => /\/comments\//.test(p.link));
  if (!firstPost) { console.error(`STOP: search.rss returned ${t1.status} with no posts. Send this line to Claude.`); return; }
  const t2 = await getXml(firstPost.link.replace(/\/?$/, "/") + ".rss?limit=100");
  console.log(`CHECK search: ${t1.entries.length} posts | thread: ${t2.entries.length} entries`);
  if (R.found.size) console.log(`resuming: ${R.found.size} posts found, ${R.searched.size} searches done, ${R.done.size} threads read`);

  // ---- 1) searches ----
  for (const sub of SUBS) for (const q of QUERIES) for (const sort of SORTS) {
    const key = `${sub}|${q}|${sort}`; if (R.searched.has(key)) continue;
    const s = await getXml(`/r/${sub}/search.rss?q=${encodeURIComponent(q)}&restrict_sr=1&sort=${sort}&t=all&limit=100`);
    if (s.status !== 200) R.failures++;
    for (const p of s.entries.map(parseEntry)) {
      const m = p.link.match(/\/r\/([^/]+)\/comments\/([a-z0-9]+)\//i); if (!m) continue;
      const id = m[2];
      if (!R.found.has(id)) R.found.set(id, { id, sub: m[1], title: p.title, link: p.link, q, sort, hits: 1 });
      else R.found.get(id).hits++;
    }
    R.searched.add(key);
    if (R.searched.size % 20 === 0) { persist(); console.log(`searches ${R.searched.size}/${SUBS.length * QUERIES.length * SORTS.length}: ${R.found.size} unique posts`); }
    await sleep(DELAY);
  }
  persist();

  // ---- 2) threads: most-matched posts first ----
  const queue = [...R.found.values()].sort((a, b) => (b.hits - a.hits) || (KW.test(b.title) - KW.test(a.title)))
    .slice(0, MAX_THREADS).filter(p => !R.done.has(p.id));
  console.log(`reading ${queue.length} threads`);
  let k = 0;
  for (const p of queue) {
    const t = await getXml(p.link.replace(/\/?$/, "/") + ".rss?limit=100&sort=top");
    if (t.status !== 200) { R.failures++; await sleep(DELAY); continue; }
    for (const e of t.entries.map(parseEntry)) {
      const isPost = e.fullId.startsWith("t3_");
      const id = e.fullId.replace(/^t[13]_/, "");
      const text = isPost ? clean(`${p.title}. ${e.text}`) : e.text;
      if (!id || text.length < 15 || /^\[(deleted|removed)\]$/.test(text)) continue;
      add({ source: isPost ? "reddit_post" : "reddit_comment", ext_id: id, thread: p.id, url: "https://www.reddit.com" + new URL(p.link).pathname,
        title: p.title, lang: "en", sort_key: `r/${p.sub}:${p.q}:${p.sort}`, posted_on: day(e.when), thumbs: null,
        text: text.slice(0, 4000), kw_match: KW.test(text) });
    }
    R.done.add(p.id); persist(); k++;
    if (k % 25 === 0) console.log(`threads ${k}/${queue.length}: ${R.items.size} items`);
    if (k % CHECKPOINT_EVERY === 0) download(`reddit_rss_part_${++R.part}.json`);
    await sleep(DELAY);
  }
  download("reddit_rss.json");
  console.log("DONE. Send Claude every reddit_rss_*.json file.");
} catch (e) {
  console.error("Script error:", e);
  if (window.__rss && window.__rss.items.size) { console.log("saving what was collected…"); window.__rssSave(); }
  console.log("Paste the script again to resume.");
} })();
```
