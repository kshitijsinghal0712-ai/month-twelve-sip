import { createClient } from "npm:@supabase/supabase-js@2";
// Public read-only API for the SIP Discovery Engine.
//   GET  ?mode=stats                       -> funnel, family shares, needs, themes, examples
//   POST {mode:"classify", text}           -> eval-gated classification + evidence
//   POST {mode:"search", text, source?}    -> nearest real posts
//   POST {mode:"probe", text}              -> similarity scores only (used to calibrate the gate)
// Embeddings: built-in gte-small (no external API, no key). Writes nothing.
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const model = new Supabase.ai.Session("gte-small");
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

// Gate thresholds: calibrated on a probe set of on-topic / off-topic sentences (see Evidence Log)
const TOPIC_MIN = Number(Deno.env.get("TOPIC_MIN") ?? 0.838);  // closeness to the SIP-corpus centroid
const MIN_SIM = Number(Deno.env.get("MIN_SIM") ?? 0.86);       // nearest hand-labelled example
const MIN_CONF = 0.45;                                          // share of neighbour weight for the top pattern
const K = 9;

const FAMILY: Record<string, string> = {
  platform_failure: "Money or payment went wrong (debit, mandate, units, app)",
  returns_doubt: "Returns look bad (red, flat, market fall)",
  choice_doubt: "Doubting the fund or the advice",
  life_cashflow: "Money got tight (expenses, income, a goal)",
  no_flexibility: "Can't change the SIP without cancelling",
  numbers_confusion: "Numbers don't make sense (XIRR, charges, NAV)",
  none_other: "Setup questions / other",
};
const NEED: Record<string, string> = {
  payment: "Reliable payments and a clear reason when one fails", support: "Support that actually resolves it",
  flex: "Flexibility without quitting", numbers: "Help reading the numbers", normal: "Knowing whether this is normal",
  unbiased: "A trusted, unbiased explanation", goal: "Seeing progress toward a goal", restart: "How to resume", other: "Other", none: "None stated",
};

// ---- Conversational layer: questions are matched to a vetted list of intents (table chat_intents); the answers live in the page.
// Nothing is generated: if no intent is close enough, the page says so and offers suggestions.
const ADVICE = /\b(which|best|good|top)\b.{0,20}\b(fund|funds|mf|scheme|stock)\b|\bshould i (stop|continue|sell|buy|switch|invest|redeem|withdraw)\b|\bwill (the )?(market|nifty|sensex)\b|\bguarantee/i;
// Questions about what the user already owns ("which funds do I have") are not requests for a recommendation.
const OWN = /\bmy (funds?|holdings?|portfolio|investments?|units|mf|mutual funds?)\b|\b(do )?i (have|hold|own|bought)\b|\bhave i (invested|bought|got)\b|\bholdings?\b/i;
const INTENT_MIN = Number(Deno.env.get("INTENT_MIN") ?? 0.86);
const INTENT_MARGIN = 0.01;

let statsCache: { at: number; data: unknown } | null = null;
const hits = new Map<string, number[]>();
function limited(ip: string) { const now = Date.now(); const a = (hits.get(ip) || []).filter(t => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 30; }
const PII = /\b[A-Z]{5}[0-9]{4}[A-Z]\b|\b\d{9,18}\b/; // PAN or long account-like numbers

const embed = async (t: string) => await model.run(t, { mean_pool: true, normalize: true }) as number[];
function vote(rows: any[], key: string) {
  const w = new Map<string, number>(); let tot = 0;
  for (const r of rows) { const v = r[key]; if (!v) continue; w.set(v, (w.get(v) || 0) + r.sim); tot += r.sim; }
  return [...w.entries()].sort((a, b) => b[1] - a[1]).map(([code, v]) => ({ code, share: tot ? +(v / tot).toFixed(2) : 0 }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "?";
  if (limited(ip)) return json({ error: "Too many requests, try again in a minute." }, 429);
  const u = new URL(req.url);
  try {
    if (req.method === "GET") {
      if (!statsCache || Date.now() - statsCache.at > 300000) {
        const { data, error } = await db.rpc("engine_stats"); if (error) throw error; statsCache = { at: Date.now(), data };
      }
      return json({ ...(statsCache.data as object), family_labels: FAMILY, need_labels: NEED, gate: { TOPIC_MIN, MIN_SIM, MIN_CONF, K } });
    }
    if (req.method !== "POST") return json({ error: "Use GET or POST" }, 405);
    const body = await req.json().catch(() => ({}));
    const text = String(body.text || "").trim();
    if (body.mode !== "seed_intents" && text.length < (body.mode === "intent" ? 3 : 10)) return json({ error: "Write at least a sentence." }, 400);
    if (text.length > 1500) return json({ error: "Keep it under 1,500 characters." }, 400);
    if (PII.test(text)) return json({ status: "blocked_pii", message: "That looks like it contains a PAN or account number. Please remove it. This tool never needs personal details." });
    // The embedding model cannot read Devanagari reliably (it scores as off-topic). Say so instead of guessing.
    const letters = text.replace(/\s/g, "").length || 1;
    const deva = (text.match(/[ऀ-ॿ]/g) || []).length;
    if (body.mode !== "search" && deva / letters > 0.3) return json({ status: "abstain_language", checks: [], family: [], need: [], neighbours: [], evidence: [], message: "This engine can't read Devanagari script yet. Try writing the same thing in English or Hinglish (Hindi in English letters).", note: "Pattern-matching over public posts. Not investment advice." });
    if (body.mode === "seed_intents") { // fills missing intent embeddings, a few per call (CPU limit)
      const { data: rows } = await db.from("chat_intents").select("id,q").is("embedding", null).limit(6);
      for (const r of rows || []) await db.from("chat_intents").update({ embedding: JSON.stringify(await embed(r.q)) }).eq("id", r.id);
      return json({ seeded: (rows || []).length });
    }
    if (body.mode === "intent") {
      const surface = body.surface === "engine" ? "engine" : "companion";
      if (surface === "companion" && ADVICE.test(text) && !OWN.test(text)) return json({ status: "advice", intent: "advice", sim: 1, checks: [{ id: "advice", label: "Asks for a recommendation", pass: false, value: "rule" }] });
      const { data: m, error: em } = await db.rpc("match_intent", { q: JSON.stringify(await embed(text)), surf: surface }); if (em) throw em;
      const ranked: [string, number][] = (m || []).map((r: any) => [r.intent, Number(r.sim)]);
      if (!ranked.length) return json({ status: "no_match", checks: [] });
      const [top, second] = ranked;
      const margin = top[1] - (second?.[1] ?? 0);
      const checks = [
        { id: "close", label: "Close to a question we have a checked answer for", pass: top[1] >= INTENT_MIN, value: +top[1].toFixed(3), threshold: INTENT_MIN },
        { id: "clear", label: "Clearly one question, not two", pass: margin >= INTENT_MARGIN || top[1] >= INTENT_MIN + 0.04, value: +margin.toFixed(3), threshold: INTENT_MARGIN },
      ];
      let status = checks.every(c => c.pass) ? "answered" : top[1] >= INTENT_MIN - 0.02 ? "unsure" : "no_match";
      if (status === "answered" && top[0] === "advice") status = "advice";
      return json({ status, intent: top[0], sim: +top[1].toFixed(3), alternatives: ranked.slice(0, 3).map(([i, s]) => ({ intent: i, sim: +s.toFixed(3) })), checks });
    }
    const q = JSON.stringify(await embed(text));

    if (body.mode === "search") {
      const { data, error } = await db.rpc("nearest_items", { q, k: 10, src: body.source || null }); if (error) throw error;
      return json({ results: data });
    }
    const [{ data: nn, error: e1 }, { data: tsim, error: e3 }] = await Promise.all([db.rpc("knn_labels", { q, k: K }), db.rpc("topic_sim", { q })]);
    if (e1) throw e1; if (e3) throw e3;
    const top = nn?.[0]?.sim ?? 0;
    if (body.mode === "probe") return json({ topic_sim: tsim, top_sim: top });

    const relW = (nn || []).reduce((s: number, r: any) => s + (r.relevant ? r.sim : -r.sim), 0);
    const relevantNN = (nn || []).filter((r: any) => r.relevant);
    const fam = vote(relevantNN, "family"), need = vote(relevantNN, "need");
    const conf = fam[0]?.share ?? 0;
    const checks = [
      { id: "on_topic", label: "Text is about SIPs / mutual funds", pass: tsim >= TOPIC_MIN, value: +Number(tsim).toFixed(3), threshold: TOPIC_MIN },
      { id: "close_match", label: "A hand-labelled story is close enough to compare", pass: top >= MIN_SIM, value: +top.toFixed(3), threshold: MIN_SIM },
      { id: "journey", label: "Closest stories describe a real SIP journey", pass: relW > 0, value: +relW.toFixed(2), threshold: 0 },
      { id: "agreement", label: "Those stories agree on one pattern", pass: conf >= MIN_CONF, value: conf, threshold: MIN_CONF },
    ];
    let status = "classified";
    if (!checks[0].pass) status = "abstain_off_topic";
    else if (!checks[1].pass) status = "abstain_no_match";
    else if (!checks[2].pass) status = "abstain_not_journey";
    else if (!checks[3].pass) status = "uncertain";
    let evidence: unknown[] = [];
    if (status !== "abstain_off_topic") {
      const { data: ev, error: e2 } = await db.rpc("nearest_items", { q, k: 6, src: null }); if (e2) throw e2; evidence = ev || [];
    }
    return json({
      status, checks,
      family: status.startsWith("abstain") ? [] : fam.slice(0, 3).map(f => ({ ...f, label: FAMILY[f.code] || f.code })),
      need: status.startsWith("abstain") ? [] : need.slice(0, 2).map(n => ({ ...n, label: NEED[n.code] || n.code })),
      neighbours: status === "abstain_off_topic" ? [] : (nn || []).slice(0, 5).map((r: any) => ({ sim: +r.sim.toFixed(3), relevant: r.relevant, family: r.family, source: r.source, excerpt: r.excerpt, url: r.url, posted_on: r.posted_on })),
      evidence,
      note: "Pattern-matching over public posts. Not investment advice.",
    });
  } catch (e) {
    return json({ error: "Something went wrong on our side.", detail: String((e as any)?.message ?? e).slice(0, 200) }, 500);
  }
});
