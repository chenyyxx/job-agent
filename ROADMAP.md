# job-agent Roadmap

> Created: 2026-06-04 · Replaces US-EXPANSION-PLAN.md (was in job-pro, now deprecated)

## Current State

**Working end-to-end pipeline** with 1,015 companies across 4 ATS platforms:
- Greenhouse (531) + Lever (216) + Ashby (227) = 974 config-driven
- Workday (41) = separate adapter with hardcoded tenant list
- PERM enrichment: 178/974 companies matched to DOL filings
- LLM match: Bedrock haiku-4.5, keyword + deep scoring
- All 5 stages chain: Discover → Enrich → Search → Match → Review

## Roadmap

### Phase 1: Agent Chat Mode ⬜
**Effort:** ~2 hours · **Value:** interactive refinement, natural language queries

Add `job-agent chat` command with Bedrock Converse tool-use loop. Exposes existing
modules as tools. User says "find remote distributed systems roles >$180k at PERM
filers" → agent calls search/filter/match/show automatically.

- [ ] `src/agent/tools.ts` — wrap modules as tool definitions
- [ ] `src/agent/loop.ts` — Bedrock Converse multi-turn with toolUse
- [ ] `src/agent/prompts.ts` — system prompt with job-search expertise
- [ ] Wire `chat` command in `src/index.ts`

### Phase 2: Profile & Resume ⬜
**Effort:** 30 min · **Value:** no more repeating flags every run

- [ ] `profile.json` — target level, locations, salary floor, YOE range, excluded companies
- [ ] Real `resume.txt` content (LLM match quality depends on it)
- [ ] Pipeline reads profile as defaults (flags still override)

### Phase 3: More ATS Coverage ⬜
**Effort:** Variable · **Value:** fills remaining gaps

| Target | ATS | PERM/qtr | Effort | Notes |
|--------|-----|----------|--------|-------|
| Microsoft | Custom (careers.microsoft.com) | ~1861 | 1-2 days | Has an API, needs research |
| TikTok | Feishu (lifeattiktok.com) | ~137 | 30 min | Blocked on live XHR capture |
| SmartRecruiters | SmartRecruiters API | varies | 1 day | Covers Spotify, Visa alt, Bosch |
| More Workday | Probe remaining 1200 candidates | varies | 1 hour | Expand beyond current 41 |

Apple (jobs.apple.com) and Google (careers.google.com) use fully custom platforms —
likely not worth building adapters for 2 companies.

### Phase 4: Enrichment Improvements ⬜
**Effort:** 1 day total

- [ ] Cross-reference Workday companies with PERM data (currently separate paths)
- [ ] WARN Act layoff data (cleaner than layoffs.fyi Airtable hack)
- [ ] Salary enrichment from levels.fyi (comp data cross-ref)

### Phase 5: Apply & Tracking ⬜
**Effort:** 2-3 days · **Value:** close the loop

- [ ] Application state DB (applied/pending/rejected per company, dedup across runs)
- [ ] Form-fill for Greenhouse (known schema, `multipart-anon`)
- [ ] Never auto-submit — always confirm per-job

### Phase 6: Automation ⬜
**Effort:** 1 hour · **Value:** weekly scheduled runs

- [ ] MeshClaw cron: weekly pipeline run → Slack DM with top 10 new matches
- [ ] Diff against previous run (only show NEW postings)
- [ ] GitHub Actions CI (tsc + selftest on push)

## Deprecated

- **job-pro** (github.com/chenyyxx/job-pro) — original fork, per-company .ts files.
  Superseded by job-agent's config-driven search module. No longer maintained.
- **US-EXPANSION-PLAN.md** in job-pro — replaced by this file.
- **Phase 1 (old)** Greenhouse wrappers in job-pro — those 14 companies are already
  in job-agent's companies.json and searched via the generic Greenhouse client.
