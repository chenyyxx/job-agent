# job-agent Roadmap

> Created: 2026-06-04 · Replaces US-EXPANSION-PLAN.md (was in job-pro, now deprecated)

## Current State

**Working end-to-end pipeline + agent chat** with ~1,025 companies across 5 ATS platforms:
- Greenhouse (531) + Lever (216) + Ashby (227) = 974 config-driven
- Workday (41) = separate adapter with hardcoded tenant list
- SmartRecruiters (10) = separate adapter
- PERM enrichment: 178/974 companies matched to DOL filings
- LLM match: Bedrock haiku-4.5, keyword + deep scoring
- Two modes: pipeline (`run`) and interactive agent chat (`chat`)
- All 5 stages chain: Discover → Enrich → Search → Match → Review

## Roadmap

### Phase 1: Agent Chat Mode ✅
**Effort:** ~2 hours · **Value:** interactive refinement, natural language queries

`job-agent chat` command with Bedrock Converse tool-use loop. Exposes existing
modules as tools. User says "find remote distributed systems roles >$180k at PERM
filers" → agent calls search/filter/match/show automatically.

- [x] `src/agent/tools.ts` — wrap modules as tool definitions
- [x] `src/agent/loop.ts` — Bedrock Converse multi-turn with toolUse
- [x] `src/agent/prompts.ts` — system prompt with job-search expertise
- [x] Wire `chat` command in `src/index.ts`

### Phase 2: Profile & Resume ✅
- [x] `profile.json` — 23 skills, locations, salary floor, excluded industries/companies
- [x] Real `resume.txt` from 2023 resume
- [x] Match module reads profile.json skills

### Phase 3: More ATS Coverage 🟡 (SmartRecruiters done)
**Effort:** Variable · **Value:** fills remaining gaps

| Target | ATS | PERM/qtr | Effort | Notes |
|--------|-----|----------|--------|-------|
| SmartRecruiters | SmartRecruiters API | varies | 1 day | ✅ DONE — 10 companies (ServiceNow, Western Digital, NBCUniversal, AbbVie, Bosch…) |
| TikTok | Feishu (lifeattiktok.com) | ~137 | 30 min | ⬜ Blocked on live XHR capture |
| More Workday | Probe remaining 1200 candidates | varies | 1 hour | ⬜ Expand beyond current 41 |
| Microsoft | Custom (careers.microsoft.com) | ~1861 | 1-2 days | ⬜ Has an API, needs research |

### Phase 4: Enrichment 🟡
**Effort:** 1 day total

- [x] Wire `--perm-only` to also filter Workday companies (cross-ref data ready, all 41 matched → 35)
- [ ] WARN Act layoff data (cleaner than layoffs.fyi)
- [ ] Salary enrichment from levels.fyi

### Phase 5: Apply & Dashboard ⬜
**Effort:** 3-5 days · **Value:** visual interface + application tracking

- [ ] Web dashboard for reviewing results visually
- [ ] Application state DB (applied/pending/rejected, dedup across runs)
- [ ] Form-fill for Greenhouse (`multipart-anon`)
- [ ] Never auto-submit — always confirm per-job
- [ ] GitHub Actions CI (tsc + selftest on push)

## Deprecated

- **job-pro** (github.com/chenyyxx/job-pro) — original fork, per-company .ts files.
  Superseded by job-agent's config-driven search module. No longer maintained.
- **US-EXPANSION-PLAN.md** in job-pro — replaced by this file.
- **Phase 1 (old)** Greenhouse wrappers in job-pro — those 14 companies are already
  in job-agent's companies.json and searched via the generic Greenhouse client.
