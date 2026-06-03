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

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  JOB REVIEW — Top ${display.length} of ${jobs.length}, ranked by green-card/PERM outlook`);
  console.log(`${"═".repeat(64)}\n`);

  for (let i = 0; i < display.length; i++) {
    const { j, s } = display[i];
    const fit = j.llm_match?.recommendation?.replace("_", " ") ?? "keyword fit";
    const reason = j.llm_match?.reasoning ?? (j.match_reasons.length ? `matches: ${j.match_reasons.join(", ")}` : "");
    const pay = j.parsed?.salary ? `$${j.parsed.salary.min / 1000 | 0}k–${j.parsed.salary.max / 1000 | 0}k` : "pay not listed";
    const yoe = j.parsed?.yoe ? `${j.parsed.yoe.min}${j.parsed.yoe.max ? `–${j.parsed.yoe.max}` : "+"} yrs` : "yoe n/a";

    console.log(`  #${i + 1}  ${j.title.trim()}  —  ${j.company}`);
    console.log(`      VISA/PERM: ${s.verdict}`);
    if (s.evidence) console.log(`        evidence: "${s.evidence}"`);
    console.log(`      Fit: ${fit}${reason ? ` — ${reason}` : ""}`);
    console.log(`      ${j.location} · ${pay} · ${yoe}`);
    console.log(`      → ${j.url}\n`);
  }

  console.log(`${"─".repeat(64)}`);
  console.log(`  Sponsorship: ${ranked.filter(r => r.s.tier === 0).length} can sponsor/file PERM · ${ranked.filter(r => r.s.tier === 1).length} unknown · ${ranked.filter(r => r.s.tier === 2).length} will NOT sponsor (ranked last).`);
  console.log(`  Apply: open URLs above, or 'job-agent apply --approved <file>'. No auto-apply.\n`);

  const out = display.map(d => ({ ...d.j, sponsorship: d.s }));
  writeFileSync(opts.outputPath, JSON.stringify(out, null, 2));
  return display.map(d => d.j);
}
