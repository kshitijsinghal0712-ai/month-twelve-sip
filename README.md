# Month Twelve: a discovery engine for first-year SIPs

Live: https://month-twelve-sip.vercel.app

This engine reads public posts by Indian mutual fund investors and finds what makes a first SIP stop before month twelve. The posts come from Play Store reviews, Reddit, Zerodha TradingQ&A and YouTube comments, about 44,000 in total.

## How it works
1. **Collect.** Browser-console scrapers pull the posts and store them in Supabase Postgres. No usernames are kept.
2. **Embed.** Every post gets an embedding from `gte-small`, a 384-dimension model running inside Supabase Edge Functions. No external API keys are used.
3. **Cluster.** K-means, run in SQL over pgvector, discovers themes without a fixed list.
4. **Label.** A stratified sample is hand-labelled for trigger, action, need and segment. About 15% of the sample is held out for evaluation.
5. **Classify.** A new description is matched to its 9 nearest labelled stories by kNN, and those stories vote on the pattern.
6. **Gate.** Four checks run before any answer is shown: on-topic, close match, real SIP journey, and agreement. Failing the first three makes the engine abstain; failing agreement marks the answer as "uncertain".

## Layout
- `site/` is the static page deployed on Vercel.
- `supabase/functions/engine/` is the public read-only API (GET for stats, POST for classify, search and probe).
- `scrapers/` holds the console scripts used for collection.

This is independent student research, not affiliated with Groww. It provides information, not investment advice.
