// Discovery module: extract companies + ATS platform + slug from SimplifyJobs
// Output: data/companies.json

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface Company {
  name: string;
  ats: string;
  slug: string;
  source: string;
}

const SIMPLIFYJOBS_URL =
  "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json";

interface SimplifyListing {
  company_name?: string;
  url?: string;
}

function extractATS(url: string): { ats: string; slug: string } | null {
  let m: RegExpMatchArray | null;

  m = url.match(/boards\.greenhouse\.io\/([^/?#\s]+)/);
  if (m) return { ats: "greenhouse", slug: m[1].toLowerCase() };

  m = url.match(/jobs\.lever\.co\/([^/?#\s]+)/);
  if (m) return { ats: "lever", slug: m[1].toLowerCase() };

  m = url.match(/jobs\.ashbyhq\.com\/([^/?#\s]+)/);
  if (m) return { ats: "ashby", slug: m[1].toLowerCase() };

  return null;
}

export async function discover(outputPath: string): Promise<Company[]> {
  console.log("Fetching SimplifyJobs listings...");
  const res = await fetch(SIMPLIFYJOBS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const listings: SimplifyListing[] = await res.json() as SimplifyListing[];
  console.log(`  ${listings.length} total listings`);

  // Dedupe by slug+ats
  const seen = new Map<string, Company>();

  for (const listing of listings) {
    const url = listing.url ?? "";
    const result = extractATS(url);
    if (!result) continue;

    const key = `${result.ats}:${result.slug}`;
    if (seen.has(key)) continue;

    seen.set(key, {
      name: listing.company_name ?? result.slug,
      ats: result.ats,
      slug: result.slug,
      source: "simplifyjobs",
    });
  }

  const companies = [...seen.values()].sort((a, b) => a.ats.localeCompare(b.ats) || a.slug.localeCompare(b.slug));

  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(companies, null, 2));

  console.log(`  Discovered ${companies.length} companies:`);
  const byAts: Record<string, number> = {};
  for (const c of companies) byAts[c.ats] = (byAts[c.ats] ?? 0) + 1;
  for (const [ats, count] of Object.entries(byAts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${ats}: ${count}`);
  }
  console.log(`  Written to ${outputPath}`);

  return companies;
}
