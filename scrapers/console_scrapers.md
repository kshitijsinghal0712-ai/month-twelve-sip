# Console scrapers — Groww SIP discovery engine

Each script runs in Chrome DevTools on the site's own page and downloads one JSON file in the format the engine loads (`items` + `runs`). Usernames are never saved.

## One-time setup (every site)
1. Open the page listed for the script.
2. Press **F12** (Mac: **Cmd+Option+J**) → **Console** tab.
3. Chrome blocks pasting the first time. Type exactly this and press Enter:
   ```
   allow pasting
   ```
   (Chrome remembers it for your profile. If Chrome is in another language, it shows the exact phrase to type.)
4. Paste the whole script → Enter. Progress prints in the console. **Keep the tab open and in front** until a JSON file downloads (Chrome slows background tabs).
5. If Chrome asks "Allow multiple downloads", click Allow.

Send me the downloaded `.json` files and I'll load them into the database.

---

## 1. Google Play Store — `play_reviews.json`
**Open:** https://play.google.com/store/apps/details?id=com.nextbillion.groww&hl=en_IN&gl=IN
**Time:** ~10–15 min for the default settings.

```js
(async () => {
  // ---- settings ----
  const PASSES = [ // [package, label, lang, sort (2=newest, 1=most relevant, 3=rating), how many]
    ["com.nextbillion.groww", "groww", "en", 2, 60000],
    ["com.nextbillion.groww", "groww", "en", 1, 3000],
    ["com.nextbillion.groww", "groww", "hi", 2, 6000],
    ["com.paytmmoney", "paytm_money", "en", 2, 4000],
    ["in.indwealth", "indmoney", "en", 2, 4000],
    ["com.zerodha.kite3", "zerodha_kite", "en", 2, 4000],
  ];
  const AUDIT_SAMPLE_RATE = 0.02;  // keep 2% of non-matching reviews to check the keyword filter
  // ------------------
  const KW = /\bsips?\b|systematic investment|mutual ?funds?|\bmfs?\b|\bnav\b|xirr|instal+ments?|mandate|autopay|auto ?debit|auto ?pay|elss|index fund|small ?cap|mid ?cap|step ?up|redeem|redemption|एसआईपी|सिप|म्यूचुअल|किस्त/i;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function page(pkg, lang, sort, token) {
    const inner = `[null,null,[2,${sort},[200,null,${token ? JSON.stringify(token) : "null"}],null,[]],["${pkg}",7]]`;
    const body = "f.req=" + encodeURIComponent(JSON.stringify([[["UsvDTd", inner, null, "generic"]]]));
    for (let a = 0; a < 4; a++) {
      try {
        const r = await fetch(`/_/PlayStoreUi/data/batchexecute?hl=${lang}&gl=in`, {
          method: "POST", credentials: "omit", // logged-out request, no account data involved
          headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body });
        const t = await r.text();
        const raw = JSON.parse(t.slice(t.indexOf("\n\n") + 2))[0][2];
        if (!raw) throw new Error("empty response " + r.status);
        const d = JSON.parse(raw);
        return { revs: d[0] || [], token: d[1]?.[1] || null };
      } catch (e) { console.warn("retry", a + 1, e.message); await sleep(3000 * (a + 1)); }
    }
    return { revs: [], token: null };
  }
  const seen = new Set(), items = [], runs = [];
  for (const [pkg, app, lang, sort, N] of PASSES) {
    const pass = `${app}_${lang}_${{ 1: "relevant", 2: "newest", 3: "rating" }[sort]}`;
    let got = 0, kept = 0, token = null, oldest = null;
    while (got < N) {
      const p = await page(pkg, lang, sort, token);
      if (!p.revs.length) break;
      got += p.revs.length;
      for (const r of p.revs) {
        if (seen.has(r[0])) continue; seen.add(r[0]);
        const text = (r[4] || "").replace(/\s+/g, " ").trim();
        const date = r[5]?.[0] ? new Date(r[5][0] * 1000).toISOString().slice(0, 10) : null;
        if (date) oldest = date;
        const match = KW.test(text);
        if (!match && !(text.length > 40 && Math.random() < AUDIT_SAMPLE_RATE)) continue;
        if (match) kept++;
        items.push({ source: "play_store", app, lang, sort_key: pass, ext_id: String(r[0]).slice(-16),
          url: `https://play.google.com/store/apps/details?id=${pkg}`, posted_on: date, rating: r[2],
          app_version: r[10] || null, thumbs: r[6] || 0, text: text.slice(0, 1500), kw_match: match });
      }
      if (got % 2000 < 200) console.log(`${pass}: ${got} fetched, ${kept} SIP-related, back to ${oldest}`);
      token = p.token; if (!token) break;
      await sleep(300);
    }
    runs.push({ source: "play_store", pass, fetched: got, kept, notes: `oldest review ${oldest}` });
    console.log(`DONE ${pass}: ${got} fetched, ${kept} kept`);
  }
  const blob = new Blob([JSON.stringify({ study: "groww-sip-continuation", collected_at: new Date().toISOString(), items, runs })], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "play_reviews.json" }); a.click();
  console.table(runs);
})();
```

---

## 2. TradingQ&A — `tradingqna.json`
**Open:** https://tradingqna.com/
**Time:** ~20–30 min (the forum rate-limits; the script waits automatically).

```js
(async () => {
  const QUERIES = ["stop sip","pause sip","sip negative","sip loss","first sip","continue sip","sip returns","sip mandate",
    "skip sip","new investor mutual fund","sip discontinue","sip cancel","sip red","beginner sip","sip not growing",
    "should i continue sip","sip 1 year","sip autopay failed","mutual fund loss","sip worth it"];
  const PAGES_PER_QUERY = 4, MAX_TOPICS = 1500;
  const KW = /\bsips?\b|systematic investment|mutual ?funds?|\bmfs?\b|\bnav\b|xirr|instal+ments?|mandate|autopay|auto ?debit|elss|index fund|small ?cap|mid ?cap|step ?up|redeem|redemption/i;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function getJ(u) {
    for (let a = 0; a < 5; a++) {
      const r = await fetch(u, { headers: { Accept: "application/json" } });
      if (r.status === 429) { console.log("rate limited, waiting", 10 * (a + 1), "s"); await sleep(10000 * (a + 1)); continue; }
      if (!r.ok) return null;
      return r.json();
    }
    return null;
  }
  const topics = new Map();
  for (const q of QUERIES) {
    for (let p = 1; p <= PAGES_PER_QUERY; p++) {
      const d = await getJ(`/search.json?q=${encodeURIComponent(q)}&page=${p}`);
      if (!d) break;
      let nw = 0;
      for (const t of d.topics || []) if (!topics.has(t.id)) { topics.set(t.id, { id: t.id, title: t.title }); nw++; }
      if (!nw) break;
      await sleep(2500);
    }
    console.log(`search "${q}" → ${topics.size} topics total`);
  }
  const items = []; let i = 0;
  for (const t of [...topics.values()].slice(0, MAX_TOPICS)) {
    const d = await getJ(`/t/${t.id}.json`);
    for (const p of d?.post_stream?.posts || []) {
      const div = document.createElement("div"); div.innerHTML = p.cooked || "";
      const body = (div.innerText || "").replace(/\s+/g, " ").trim();
      const text = (p.post_number === 1 ? t.title + ". " : "") + body;
      if (text.length < 15) continue;
      items.push({ source: "tradingqna", ext_id: `${t.id}:${p.post_number}`, thread: String(t.id),
        url: `https://tradingqna.com/t/${t.id}/${p.post_number}`, title: t.title, lang: "en", sort_key: "search_threads",
        posted_on: (p.created_at || "").slice(0, 10) || null, text: text.slice(0, 2500), kw_match: KW.test(t.title + " " + body) });
    }
    if (++i % 50 === 0) console.log(`threads ${i}/${topics.size}, posts ${items.length}`);
    await sleep(1200);
  }
  const runs = [{ source: "tradingqna", pass: "search_threads", fetched: items.length, kept: items.filter(x => x.kw_match).length,
    notes: `${topics.size} topics from ${QUERIES.length} queries` }];
  const blob = new Blob([JSON.stringify({ study: "groww-sip-continuation", collected_at: new Date().toISOString(), items, runs })], { type: "application/json" });
  Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "tradingqna.json" }).click();
  console.table(runs);
})();
```

---

## 3. Reddit — `reddit.json`
**Open:** https://www.reddit.com/r/IndiaInvestments/ (signed in or not, either works)
**Time:** ~25–40 min. Reddit allows roughly one request a second; the script stays under that.

```js
(async () => {
  const SUBS = ["IndiaInvestments", "mutualfunds", "personalfinanceindia", "FIREIndia", "IndianStockMarket", "StockMarketIndia"];
  const QUERIES = ["first SIP", "stopped SIP", "stop my SIP", "pause SIP", "skip SIP", "SIP negative returns",
    "continue SIP or stop", "new to mutual funds", "SIP one year", "SIP not growing", "Groww SIP", "SIP mandate failed",
    "SIP worth it", "beginner mutual fund", "SIP in red", "should I stop SIP"];
  const POSTS_PER_QUERY = 50, MAX_COMMENTS_PER_POST = 150;
  const KW = /\bsips?\b|systematic investment|mutual ?funds?|\bmfs?\b|\bnav\b|xirr|instal+ments?|mandate|autopay|auto ?debit|elss|index fund|small ?cap|mid ?cap|step ?up|redeem|redemption/i;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function getJ(u) {
    for (let a = 0; a < 4; a++) {
      const r = await fetch(u, { headers: { Accept: "application/json" } });
      if (r.status === 429) { console.log("rate limited, waiting", 15 * (a + 1), "s"); await sleep(15000 * (a + 1)); continue; }
      if (!r.ok) return null;
      try { return await r.json(); } catch { return null; }
    }
    return null;
  }
  const items = [], seenPosts = new Set(); let calls = 0;
  for (const sub of SUBS) {
    for (const q of QUERIES) {
      const d = await getJ(`/r/${sub}/search.json?q=${encodeURIComponent(q)}&restrict_sr=1&sort=relevance&t=all&limit=${POSTS_PER_QUERY}&raw_json=1`);
      calls++; await sleep(1300);
      for (const c of d?.data?.children || []) {
        const p = c.data; if (seenPosts.has(p.id)) continue; seenPosts.add(p.id);
        const link = "https://www.reddit.com" + p.permalink;
        const text = `${p.title}. ${p.selftext || ""}`.replace(/\s+/g, " ").trim();
        items.push({ source: "reddit_post", ext_id: p.id, thread: p.id, url: link, title: p.title, lang: "en",
          sort_key: `r/${sub}:${q}`, posted_on: new Date(p.created_utc * 1000).toISOString().slice(0, 10),
          thumbs: p.score, text: text.slice(0, 4000), kw_match: KW.test(text) });
        if (!p.num_comments) continue;
        const cd = await getJ(`/comments/${p.id}.json?limit=${MAX_COMMENTS_PER_POST}&depth=4&raw_json=1`);
        calls++; await sleep(1300);
        const stack = [...(cd?.[1]?.data?.children || [])];
        while (stack.length) {
          const k = stack.pop(); if (k.kind !== "t1") continue;
          const b = (k.data.body || "").replace(/\s+/g, " ").trim();
          if (b.length >= 15 && b !== "[deleted]" && b !== "[removed]")
            items.push({ source: "reddit_comment", ext_id: k.data.id, thread: p.id, url: link, title: p.title, lang: "en",
              sort_key: `r/${sub}:${q}`, posted_on: new Date(k.data.created_utc * 1000).toISOString().slice(0, 10),
              thumbs: k.data.score, text: b.slice(0, 4000), kw_match: KW.test(b) });
          if (k.data.replies?.data?.children) stack.push(...k.data.replies.data.children);
        }
      }
      console.log(`r/${sub} "${q}": ${seenPosts.size} posts, ${items.length} items, ${calls} requests`);
    }
  }
  const runs = [
    { source: "reddit_post", pass: "search", fetched: items.filter(x => x.source === "reddit_post").length,
      kept: items.filter(x => x.source === "reddit_post" && x.kw_match).length, notes: `${SUBS.length} subs x ${QUERIES.length} queries` },
    { source: "reddit_comment", pass: "threads", fetched: items.filter(x => x.source === "reddit_comment").length,
      kept: items.filter(x => x.source === "reddit_comment" && x.kw_match).length, notes: `up to ${MAX_COMMENTS_PER_POST} comments per post` }];
  const blob = new Blob([JSON.stringify({ study: "groww-sip-continuation", collected_at: new Date().toISOString(), items, runs })], { type: "application/json" });
  Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "reddit.json" }).click();
  console.table(runs);
})();
```

---

## Notes
- **App Store:** no script. Apple shut both public review feeds (they return empty), and the web page shows only 10 reviews with no "load more". Those 10 are already saved; the Evidence Log records this as a source limitation.
- **YouTube:** comments load through a separate internal API. I'll add that script once these three are done.
- If a script stops with an error, copy the last red line from the console and send it to me.
