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
