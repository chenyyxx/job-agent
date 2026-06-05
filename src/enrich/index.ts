// Enrich module: stamp immigration (PERM) + layoff data onto companies

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { Company } from "../discovery/index.js";
import { bedrockText, loadLLMConfig } from "../match/llm-match.js";

export interface CompanyEnriched extends Company {
  immigration: {
    h1b: boolean | null;
    perm: boolean | null;
    filings_quarterly: number;
    trend: "growing" | "stable" | "declining" | "frozen";
    top_roles: string[];
    avg_wage: number | null;
  };
  layoff: {
    recent: boolean;
    date: string | null;
    count: number | null;
    percent: number | null;
  };
}

export interface PermRecord {
  employer: string;
  filings: number;
  trend: "growing" | "stable" | "declining" | "frozen";
  top_roles: string[];
  avg_wage: number | null;
}

// Strip corporate suffixes/punctuation so brand names match DOL legal entities
// ("Stripe" ↔ "Stripe, Inc.", "Spotify" ↔ "SPOTIFY USA, INC.").
const SUFFIXES = /\b(inc|incorporated|llc|corp|corporation|co|company|ltd|limited|lp|llp|plc|usa|the)\b/g;
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(SUFFIXES, " ").replace(/\s+/g, " ").trim();
}

export function loadPermCache(dataDir: string): { exact: Map<string, PermRecord>; norm: Map<string, PermRecord> } {
  const cachePath = resolve(dataDir, "perm-cache.json");
  const exact = new Map<string, PermRecord>();
  const norm = new Map<string, PermRecord>();
  if (!existsSync(cachePath)) {
    console.log(`  ⚠ No PERM cache at ${cachePath} — run: job-agent perm-import <xlsx|csv>`);
    return { exact, norm };
  }
  const records: PermRecord[] = JSON.parse(readFileSync(cachePath, "utf-8"));
  for (const r of records) {
    exact.set(r.employer.toLowerCase(), r);
    const key = normalizeName(r.employer);
    if (!key) continue;
    // Aggregate legal entities that normalize to the same brand key (sum filings).
    const prev = norm.get(key);
    if (prev) prev.filings += r.filings;
    else norm.set(key, { ...r });
  }
  return { exact, norm };
}

function loadLayoffCache(dataDir: string): Map<string, { date: string; count: number; percent: number | null }> {
  const cachePath = resolve(dataDir, "layoff-cache.json");
  if (!existsSync(cachePath)) return new Map();
  const records: { company: string; date: string; count: number; percent: number | null }[] =
    JSON.parse(readFileSync(cachePath, "utf-8"));
  const map = new Map<string, { date: string; count: number; percent: number | null }>();
  for (const r of records) map.set(r.company.toLowerCase(), r);
  return map;
}

export interface EnrichOptions {
  companiesPath: string;
  outputPath: string;
  dataDir: string;
  resolvePerm?: boolean;   // use LLM to resolve brand→DOL legal entity for unmatched companies
}

// Grounded LLM resolver: for companies unmatched by name, ask the LLM for the DOL legal
// entity, then VERIFY against the real DOL index (hallucinated names simply won't match).
// Cached in perm-resolve-cache.json so re-runs cost nothing.
async function resolvePermNames(
  unmatched: string[],
  normIndex: Map<string, PermRecord>,
  dataDir: string,
): Promise<Map<string, PermRecord>> {
  const out = new Map<string, PermRecord>();
  const cfg = loadLLMConfig(dataDir);
  if (!cfg) { console.log("  ⚠ --resolve-perm needs llm_match enabled in config.json"); return out; }

  const cachePath = resolve(dataDir, "perm-resolve-cache.json");
  const cache: Record<string, string | null> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf-8")) : {};

  const todo = unmatched.filter(n => !(n.toLowerCase() in cache));
  console.log(`  Resolving ${todo.length} unmatched companies via LLM (${unmatched.length - todo.length} cached)...`);

  for (let i = 0; i < todo.length; i += 25) {
    const batch = todo.slice(i, i + 25);
    const prompt = `For each company brand below, give the exact US legal employer entity name as it appears in DOL filings (e.g. "1Password" -> "AgileBits Inc", "Google" -> "Google LLC"). If unknown or the company is too small to file, use null. Return ONLY JSON: {"Brand":"Legal Entity Name or null"}.\n\n${batch.join("\n")}`;
    try {
      let txt = (await bedrockText(prompt, cfg)).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const guesses: Record<string, string | null> = JSON.parse(txt);
      for (const b of batch) cache[b.toLowerCase()] = guesses[b] ?? null;
    } catch { /* batch failed; leave uncached to retry next run */ }
  }
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  // Verify each guess against the real DOL normalized index.
  let resolved = 0;
  for (const name of unmatched) {
    const guess = cache[name.toLowerCase()];
    if (!guess) continue;
    const rec = normIndex.get(normalizeName(guess));
    if (rec) { out.set(name.toLowerCase(), rec); resolved++; }
  }
  console.log(`  LLM resolved ${resolved} additional companies to DOL PERM data`);
  return out;
}

export async function enrich(opts: EnrichOptions): Promise<CompanyEnriched[]> {
  const companies: Company[] = JSON.parse(readFileSync(opts.companiesPath, "utf-8"));
  console.log(`Enriching ${companies.length} companies...`);

  const permCache = loadPermCache(opts.dataDir);
  const layoffCache = loadLayoffCache(opts.dataDir);

  console.log(`  PERM cache: ${permCache.exact.size} employers (${permCache.norm.size} normalized keys)`);
  console.log(`  Layoff cache: ${layoffCache.size} companies`);

  const lookup = (c: Company) => permCache.exact.get(c.name.toLowerCase()) ?? permCache.norm.get(normalizeName(c.name));

  // Optional LLM resolution for companies unmatched by name.
  let resolved = new Map<string, PermRecord>();
  if (opts.resolvePerm) {
    const unmatched = companies.filter(c => !lookup(c)).map(c => c.name);
    resolved = await resolvePermNames(unmatched, permCache.norm, opts.dataDir);
  }

  const enriched: CompanyEnriched[] = companies.map((c) => {
    const perm = lookup(c) ?? resolved.get(c.name.toLowerCase());
    const layoff = layoffCache.get(c.name.toLowerCase());

    return {
      ...c,
      immigration: {
        h1b: perm ? true : null,
        perm: perm ? perm.filings > 0 : null,
        filings_quarterly: perm?.filings ?? 0,
        trend: perm?.trend ?? "stable",
        top_roles: perm?.top_roles ?? [],
        avg_wage: perm?.avg_wage ?? null,
      },
      layoff: {
        recent: layoff ? true : false,
        date: layoff?.date ?? null,
        count: layoff?.count ?? null,
        percent: layoff?.percent ?? null,
      },
    };
  });

  writeFileSync(opts.outputPath, JSON.stringify(enriched, null, 2));
  const withPerm = enriched.filter(c => c.immigration.perm === true).length;
  const withLayoff = enriched.filter(c => c.layoff.recent).length;
  console.log(`  ${withPerm} with PERM data, ${withLayoff} with recent layoffs`);
  console.log(`  Written to ${opts.outputPath}`);
  return enriched;
}
