// Review module: human review gate — organized around green-card/PERM outlook

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import type { MatchedJob } from "../match/index.js";
import { normalizeName, loadPermCache } from "../enrich/index.js";

export interface ReviewOptions {
  matchedPath: string;
  outputPath: string;
  top?: number;
  requireH1b?: boolean;     // keep only roles whose posting sponsors H-1B
  excludeNoH1b?: boolean;   // drop roles whose posting explicitly will NOT sponsor
  requirePerm?: boolean;    // keep only companies with DOL PERM filing history
  minPermFilings?: number;  // keep only companies filing >= N PERM cases/qtr (startup filter)
}

// Visa sponsorship (H-1B work visa) — from the JOB POSTING text. Display only, not ranked.
function h1b(j: MatchedJob): { label: string; evidence?: string } {
  if (j.parsed?.visa_sponsorship === false) return { label: "❌ No H-1B sponsorship (per posting)", evidence: j.parsed.visa_evidence };
  if (j.parsed?.visa_sponsorship === true) return { label: "✅ Sponsors H-1B (per posting)", evidence: j.parsed.visa_evidence };
  return { label: "❓ H-1B not stated in posting" };
}

// PERM (green card) — from DOL ETA-9089 disclosure filing history. NOT the same as H-1B.
function perm(filings: number): { label: string } {
  return filings > 0
    ? { label: `✅ Files PERM / green card — DOL: ~${filings} filings/qtr` }
    : { label: "❓ No DOL PERM filing record (green-card outlook unknown)" };
}

export async function review(opts: ReviewOptions): Promise<MatchedJob[]> {
  const jobs: MatchedJob[] = JSON.parse(readFileSync(opts.matchedPath, "utf-8"));

  // PERM (green-card) filing history per company — DOL enrichment, keyed by company.
  const dataDir = dirname(opts.matchedPath);
  const enrichedPath = resolve(dataDir, "companies-enriched.json");
  const permByCompany = new Map<string, number>();
  if (existsSync(enrichedPath)) {
    for (const c of JSON.parse(readFileSync(enrichedPath, "utf-8")) as any[]) {
      permByCompany.set((c.name ?? "").toLowerCase(), c.immigration?.filings_quarterly ?? 0);
    }
  }
  // Fallback to the raw DOL cache (normalized) so companies NOT in companies-enriched.json
  // — e.g. Workday / SmartRecruiters adapters — still resolve their PERM filings.
  const permCache = loadPermCache(dataDir);
  const filingsFor = (company: string): number => {
    const lc = company.toLowerCase();
    const enriched = permByCompany.get(lc);
    if (enriched != null && enriched > 0) return enriched;
    const rec = permCache.exact.get(lc) ?? permCache.norm.get(normalizeName(company));
    return rec?.filings ?? enriched ?? 0;
  };

  // Ranking = fit only (skills/experience). YOE/location are hard filters upstream;
  // visa/PERM are NOT ranked — they are optional post-filters + displayed info.
  const fit = (j: MatchedJob) => j.llm_match?.score ?? j.keyword_score ?? 0;
  let ranked = jobs
    .map((j, idx) => {
      const filings = filingsFor(j.company);
      return { j, idx, h: h1b(j), p: perm(filings), filings, score: fit(j) };
    })
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  // Optional sponsorship/PERM filters applied AFTER ranking.
  if (opts.requireH1b) ranked = ranked.filter(r => r.j.parsed?.visa_sponsorship === true);
  if (opts.excludeNoH1b) ranked = ranked.filter(r => r.j.parsed?.visa_sponsorship !== false);
  if (opts.requirePerm) ranked = ranked.filter(r => r.filings > 0);
  if (opts.minPermFilings) ranked = ranked.filter(r => r.filings >= opts.minPermFilings!);

  const display = ranked.slice(0, opts.top ?? 20);

  // Group displayed roles by company (PERM is a company-level signal).
  const groups = new Map<string, typeof display>();
  for (const d of display) {
    const g = groups.get(d.j.company) ?? [];
    g.push(d);
    groups.set(d.j.company, g);
  }
  const companies = [...groups.entries()]
    .map(([name, roles]) => ({ name, roles, best: Math.max(...roles.map(d => d.score)) }))
    .sort((a, b) => b.best - a.best);

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  JOB REVIEW — ${companies.length} companies, ${display.length} of ${jobs.length} roles (fit-ranked)`);
  console.log(`  H-1B = work visa (from posting) · PERM = green card (from DOL filings)`);
  console.log(`${"═".repeat(64)}\n`);

  for (const c of companies) {
    console.log(`▸ ${c.name}   (${c.roles.length} role${c.roles.length > 1 ? "s" : ""})`);
    console.log(`    Green card (PERM): ${c.roles[0].p.label}`);
    for (const { j, h } of c.roles) {
      const fitLabel = j.llm_match?.recommendation?.replace("_", " ") ?? "keyword fit";
      const pay = j.parsed?.salary ? `$${j.parsed.salary.min / 1000 | 0}k–${j.parsed.salary.max / 1000 | 0}k` : "pay n/a";
      const yoe = j.parsed?.yoe ? `${j.parsed.yoe.min}${j.parsed.yoe.max ? `–${j.parsed.yoe.max}` : "+"}y` : "yoe n/a";
      console.log(`    • ${j.title.trim()}  [${fitLabel}]`);
      console.log(`        ${j.location} · ${pay} · ${yoe} · H-1B: ${h.label}`);
      if (h.evidence) console.log(`        H-1B evidence: "${h.evidence}"`);
      if (j.llm_match?.reasoning) console.log(`        ${j.llm_match.reasoning}`);
      console.log(`        → ${j.url}`);
    }
    console.log();
  }

  console.log(`${"─".repeat(64)}`);
  console.log(`  PERM/green card (DOL): ${ranked.filter(r => r.filings > 0).length} companies file PERM · ${ranked.filter(r => r.filings === 0).length} no DOL record`);
  console.log(`  H-1B (posting): ${ranked.filter(r => r.j.parsed?.visa_sponsorship === true).length} sponsor · ${ranked.filter(r => r.j.parsed?.visa_sponsorship === false).length} do NOT · rest unstated`);
  console.log(`  Apply: open URLs above, or 'job-agent apply --approved <file>'. No auto-apply.\n`);

  const out = display.map(d => ({ ...d.j, h1b: d.h, perm: d.p }));
  writeFileSync(opts.outputPath, JSON.stringify(out, null, 2));
  return display.map(d => d.j);
}
