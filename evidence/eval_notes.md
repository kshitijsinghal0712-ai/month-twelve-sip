## Holdout eval — 2026-10-29 (799 labels)
- Holdout: 115 posts (with embeddings), kNN k=9 over non-holdout labels.
- Relevance accuracy 71.3%. Of 64 truly relevant: family acc 62.5% (majority baseline 45.3%), exact trigger 35.9%.
- By gate status (simulated, no topic check):
  - classified n=61, 44 truly relevant, family acc 77.3%
  - uncertain n=19, 13 relevant, family acc 23.1%  -> gate correctly flags low-confidence
  - abstain_not_journey n=30, 23 truly irrelevant (77% correct abstain), 7 relevant missed
  - abstain_no_match n=5, all truly irrelevant

## Golden set v2 — 22 posts, labelled before running the engine (2026-10-29)
- v1 (22 posts) discarded: engine output was seen before labelling.
- Overall agreement 10/22 (45%), Cohen's kappa 0.34 (fair). Relevance agreement 15/22 (68%).
- Confident answers ("classified"): 8/11 right (73%). Flagged "uncertain": 1/6 right. Declined: 1/5 right.
- Money/payment problems: 6/6 right.
- Failures: over-declines stayer/praise/newbie posts (3), Devanagari (1), F&O complaint leak (1), confident wrong family (2), off-topic marked uncertain instead of declined (2).

## Fix attempt: engine declines stayer/praise posts (2026-10-30)
Diagnosis: label drift. In batches 1-9 first-hand "I've been investing and it's fine" posts were marked irrelevant; later batches marked them relevant. Engine learned "positive post = not a SIP journey".
Rule written down: relevant = a person describing their OWN SIP/MF experience or asking about it, good or bad. Not relevant = market commentary, advice to others, trading, news.
- Corrected 31 labels (table label_corrections), all relevant false->true.
- Tried 3 extra gate rules (first-person override, trading-term block, Devanagari).
  - On golden v2 they lifted agreement 10/22 -> 15/22, BUT golden v2 was used to design them.
  - On 115 untouched holdout posts every variant was equal or worse (first-person override: relevance 76% -> 69%, irrelevant posts answered 24 -> 34). REJECTED.
  - Kept only a Devanagari message ("can't read this script, try English/Hinglish") instead of a misleading "off-topic".
- After relabel, original gate, holdout (n=115, 69 relevant):
  - relevance accuracy 71.3% -> 76.5%
  - family accuracy on relevant 62.5% -> 65.2% (majority baseline 42%)
  - confident answers 77% right (52 relevant); "possibly" answers 31% right (13)
- Golden v2 with relabel + original gate: 11/22 (stayer praise post #17 recovered). Stayer story #13 and newbie question #11 still declined; remains a known limitation.
