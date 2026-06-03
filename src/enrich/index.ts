// Enrich module: stamp immigration (PERM) + layoff data onto companies

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { Company } from "../discovery/index.js";

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

interface PermRecord {
  employer: string;
  filings: number;
  trend: "growing" | "stable" | "declining" | "frozen";
  top_roles: string[];
  avg_wage: number | null;
}

function loadPermCache(dataDir: string): Map<string, PermRecord> {
  const cachePath = resolve(dataDir, "perm-cache.json");
  if (!existsSync(cachePath)) {
    console.log(`  ⚠ No PERM cache at ${cachePath}`);
    console.log(`  To populate: download PERM disclosure data from https://www.dol.gov/agencies/eta/foreign-labor/performance`);
    console.log(`  Then run: job-agent perm-import <xlsx-path> (TODO)`);
    return new Map();
  }
  const records: PermRecord[] = JSON.parse(readFileSync(cachePath, "utf-8"));
  const map = new Map<string, PermRecord>();
  for (const r of records) map.set(r.employer.toLowerCase(), r);
  return map;
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
}

export async function enrich(opts: EnrichOptions): Promise<CompanyEnriched[]> {
  const companies: Company[] = JSON.parse(readFileSync(opts.companiesPath, "utf-8"));
  console.log(`Enriching ${companies.length} companies...`);

  const permCache = loadPermCache(opts.dataDir);
  const layoffCache = loadLayoffCache(opts.dataDir);

  console.log(`  PERM cache: ${permCache.size} employers`);
  console.log(`  Layoff cache: ${layoffCache.size} companies`);

  const enriched: CompanyEnriched[] = companies.map((c) => {
    const perm = permCache.get(c.name.toLowerCase());
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
