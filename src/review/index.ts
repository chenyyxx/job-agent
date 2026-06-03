// Review module: human review gate — organized around green-card/PERM outlook

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import type { MatchedJob } from "../match/index.js";

export interface ReviewOptions {
  matchedPath: string;
  outputPath: string;
  top?: number;
}

// Sponsorship/PERM outlook is the PRIMARY axis. tier 0 = best (can sponsor/files PERM),
// tier 1 = unknown (not stated), tier 2 = worst (explicitly will not sponsor).
function sponsorship(j: MatchedJob, permFilings: number): { tier: number; verdict: string; evidence?: string } {
  if (j.parsed?.visa_sponsorship === false) {
    return { tier: 2, verdict: "❌ Does NOT sponsor", evidence: j.parsed.visa_evidence };
  }
  if (permFilings > 0) {
    return { tier: 0, verdict: `✅ Files PERM — ~${permFilings}/qtr (green-card capable)` };
  }
  if (j.parsed?.visa_sponsorship === true) {
    return { tier: 0, verdict: "✅ Sponsors visas", evidence: j.parsed.visa_evidence };
  }
  return { tier: 1, verdict: "❓ Sponsorship not stated in posting" };
}

export async function review(opts: ReviewOptions): Promise<MatchedJob[]> {
  const jobs: MatchedJob[] = JSON.parse(readFileSync(opts.matchedPath, "utf-8"));

  // PERM filing history per company (DOL enrichment) — the strongest green-card signal.
  const enrichedPath = resolve(dirname(opts.matchedPath), "companies-enriched.json");
  const permByCompany = new Map<string, number>();
  if (existsSync(enrichedPath)) {
    for (const c of JSON.parse(readFileSync(enrichedPath, "utf-8")) as any[]) {
      permByCompany.set((c.name ?? "").toLowerCase(), c.immigration?.filings_quarterly ?? 0);
    }
  }

  // Rank by sponsorship outlook first, then by fit (existing order preserved within tier).
  const ranked = jobs
    .map((j, idx) => ({ j, idx, s: sponsorship(j, permByCompany.get(j.company.toLowerCase()) ?? 0) }))
    .sort((a, b) => a.s.tier - b.s.tier || a.idx - b.idx);

  const display = ranked.slice(0, opts.top ?? 20);

  // Group displayed jobs by company; company outlook = best across its roles.
  const groups = new Map<string, { jobs: typeof display; perm: number }>();
  for (const d of display) {
    const g = groups.get(d.j.company) ?? { jobs: [], perm: permByCompany.get(d.j.company.toLowerCase()) ?? 0 };
    g.jobs.push(d);
    groups.set(d.j.company, g);
  }
  const companies = [...groups.entries()]
    .map(([name, g]) => {
      const anyYes = g.jobs.some(d => d.j.parsed?.visa_sponsorship === true);
      const anyNo = g.jobs.some(d => d.j.parsed?.visa_sponsorship === false);
      const tier = (g.perm > 0 || anyYes) ? 0 : anyNo ? 2 : 1;
      const verdict = g.perm > 0 ? `✅ Files PERM — ~${g.perm}/qtr (green-card capable)`
        : anyYes ? "✅ Sponsors visas (per posting)"
        : anyNo ? "❌ Some postings say NO sponsorship"
        : "❓ Sponsorship not stated";
      return { name, g, tier, verdict };
    })
    .sort((a, b) => a.tier - b.tier || b.g.jobs.length - a.g.jobs.length);

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  JOB REVIEW — ${companies.length} companies, ${display.length} of ${jobs.length} roles, by green-card/PERM outlook`);
  console.log(`${"═".repeat(64)}\n`);

  for (const c of companies) {
    console.log(`▸ ${c.name}   ${c.verdict}   (${c.g.jobs.length} role${c.g.jobs.length > 1 ? "s" : ""})`);
    for (const { j, s } of c.g.jobs) {
      const fit = j.llm_match?.recommendation?.replace("_", " ") ?? "keyword fit";
      const pay = j.parsed?.salary ? `$${j.parsed.salary.min / 1000 | 0}k–${j.parsed.salary.max / 1000 | 0}k` : "pay n/a";
      const yoe = j.parsed?.yoe ? `${j.parsed.yoe.min}${j.parsed.yoe.max ? `–${j.parsed.yoe.max}` : "+"}y` : "yoe n/a";
      const flag = j.parsed?.visa_sponsorship === false ? " ⚠️NO-sponsor" : "";
      console.log(`    • ${j.title.trim()}  [${fit}${flag}]`);
      console.log(`        ${j.location} · ${pay} · ${yoe}`);
      if (s.evidence) console.log(`        visa evidence: "${s.evidence}"`);
      if (j.llm_match?.reasoning) console.log(`        ${j.llm_match.reasoning}`);
      console.log(`        → ${j.url}`);
    }
    console.log();
  }

  console.log(`${"─".repeat(64)}`);
  console.log(`  Sponsorship: ${ranked.filter(r => r.s.tier === 0).length} can sponsor/file PERM · ${ranked.filter(r => r.s.tier === 1).length} unknown · ${ranked.filter(r => r.s.tier === 2).length} will NOT sponsor (ranked last).`);
  console.log(`  Apply: open URLs above, or 'job-agent apply --approved <file>'. No auto-apply.\n`);

  const out = display.map(d => ({ ...d.j, sponsorship: d.s }));
  writeFileSync(opts.outputPath, JSON.stringify(out, null, 2));
  return display.map(d => d.j);
}
