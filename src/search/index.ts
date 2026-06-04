// Search module: query ATS boards for matching jobs
// Config-driven — accepts {ats, slug} from companies.json, no per-company files

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import type { Company } from "../discovery/index.js";
import { WORKDAY_COMPANIES, searchWorkday } from "./workday.js";
import { SMARTRECRUITERS_COMPANIES, searchSmartRecruiters } from "./smartrecruiters.js";

export interface Job {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  department: string;
  posted_at: string;
  description?: string;
  parsed?: {
    salary?: { min: number; max: number; currency: string };
    yoe?: { min: number; max?: number };
    clearance_required?: boolean;
    citizenship_required?: boolean;
    visa_sponsorship?: boolean;
    visa_evidence?: string;
  };
}

export interface SearchOptions {
  companiesPath: string;
  outputPath: string;
  query: string;
  atsFilter?: string[];
  limit?: number;
  locations?: string[];
  skipTitles?: string[];
  permOnly?: boolean;   // search only companies with DOL PERM filings (from enriched data)
}

// --- ATS Clients ---

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Accept: "application/json",
};

// Greenhouse `content` is HTML-entity-escaped HTML; decode + strip to plain text for parsing.
function htmlToText(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/&#8211;|&#x2013;/g, "–").replace(/&#8217;|&#x2019;/g, "'")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function searchGreenhouse(company: Company, query: string): Promise<Job[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.slug)}/jobs?content=true`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];
  const data = await res.json() as { jobs?: any[] };
  const kw = query.toLowerCase();

  return (data.jobs ?? [])
    .filter((j: any) => {
      const blob = `${j.title ?? ""} ${j.location?.name ?? ""} ${(j.departments ?? []).map((d: any) => d.name).join(" ")}`.toLowerCase();
      return blob.includes(kw);
    })
    .map((j: any) => ({
      id: String(j.id ?? ""),
      company: company.name,
      title: j.title ?? "",
      location: j.location?.name ?? "",
      url: j.absolute_url ?? `https://boards.greenhouse.io/${company.slug}/jobs/${j.id}`,
      department: j.departments?.[0]?.name ?? "",
      posted_at: j.updated_at ?? "",
      description: j.content ? htmlToText(j.content) : undefined,
    }));
}

async function searchLever(company: Company, query: string): Promise<Job[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company.slug)}?mode=json`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];
  const data = await res.json() as any[];
  const kw = query.toLowerCase();

  return (data ?? [])
    .filter((j: any) => {
      const blob = `${j.text ?? ""} ${j.categories?.location ?? ""} ${j.categories?.team ?? ""}`.toLowerCase();
      return blob.includes(kw);
    })
    .map((j: any) => ({
      id: String(j.id ?? ""),
      company: company.name,
      title: j.text ?? "",
      location: j.categories?.location ?? "",
      url: j.hostedUrl ?? j.applyUrl ?? "",
      department: j.categories?.team ?? "",
      posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : "",
      description: j.descriptionPlain ?? j.description ?? undefined,
    }));
}

async function searchAshby(company: Company, query: string): Promise<Job[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.slug)}`;
  const res = await fetch(url, { headers: HEADERS, method: "GET" });
  if (!res.ok) return [];
  const data = await res.json() as { jobs?: any[] };
  const kw = query.toLowerCase();

  return (data.jobs ?? [])
    .filter((j: any) => {
      const blob = `${j.title ?? ""} ${j.location ?? ""} ${j.department ?? ""}`.toLowerCase();
      return blob.includes(kw);
    })
    .map((j: any) => ({
      id: String(j.id ?? ""),
      company: company.name,
      title: j.title ?? "",
      location: j.location ?? "",
      url: j.jobUrl ?? `https://jobs.ashbyhq.com/${company.slug}/${j.id}`,
      department: j.department ?? "",
      posted_at: j.publishedDate ?? "",
      description: j.descriptionPlain ?? undefined,
    }));
}

const ATS_CLIENTS: Record<string, (company: Company, query: string) => Promise<Job[]>> = {
  greenhouse: searchGreenhouse,
  lever: searchLever,
  ashby: searchAshby,
};

// --- Main search function ---

export async function search(opts: SearchOptions): Promise<Job[]> {
  const companies: Company[] = JSON.parse(readFileSync(opts.companiesPath, "utf-8"));

  let filtered = companies;
  if (opts.atsFilter?.length) {
    filtered = companies.filter(c => opts.atsFilter!.includes(c.ats));
  }

  // --perm-only: restrict to companies with DOL PERM filings (green-card capable), so the
  // sample only ever hits filers. Requires enrich to have run.
  if (opts.permOnly) {
    const enrichedPath = resolve(dirname(opts.companiesPath), "companies-enriched.json");
    if (existsSync(enrichedPath)) {
      const filers = new Set(
        (JSON.parse(readFileSync(enrichedPath, "utf-8")) as any[])
          .filter(c => (c.immigration?.filings_quarterly ?? 0) > 0)
          .map(c => c.name.toLowerCase())
      );
      const before = filtered.length;
      filtered = filtered.filter(c => filers.has(c.name.toLowerCase()));
      console.log(`  PERM-only: ${before} → ${filtered.length} companies (file PERM)`);
    } else {
      console.log("  ⚠ --perm-only needs companies-enriched.json — run enrich first");
    }
  }

  // `limit` is a TEST knob only: randomly sample N companies (so we hit a mix incl.
  // big names for PERM testing). Real runs pass no limit → search every company.
  const toSearch = opts.limit != null
    ? [...filtered].sort(() => Math.random() - 0.5).slice(0, opts.limit)
    : filtered;
  console.log(`Searching ${toSearch.length} companies for "${opts.query}"...`);

  let allJobs: Job[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < toSearch.length; i += CONCURRENCY) {
    const batch = toSearch.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (company) => {
        const client = ATS_CLIENTS[company.ats];
        if (!client) return [];
        return client(company, opts.query);
      })
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled" && r.value.length > 0) {
        console.log(`  ${batch[j].name} (${batch[j].ats}): ${r.value.length} matches`);
        allJobs.push(...r.value);
      }
    }
  }

  // --- Workday companies (separate from config-driven ATS) ---
  if (!opts.atsFilter || opts.atsFilter.includes("workday")) {
    let wdCompanies = WORKDAY_COMPANIES;

    // --perm-only: filter Workday companies by PERM filings using perm-cache.json
    if (opts.permOnly) {
      const permPath = resolve(dirname(opts.companiesPath), "perm-cache.json");
      if (existsSync(permPath)) {
        const permData: any[] = JSON.parse(readFileSync(permPath, "utf-8"));
        const SUFFIXES = /\b(inc|llc|corp|corporation|co|company|ltd|usa|the|group|holdings|international|technologies|systems|solutions)\b/gi;
        const strip = (s: string) => s.toLowerCase().replace(SUFFIXES, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
        const permIndex = new Map(permData.map(e => [strip(e.employer), e.filings]));
        const before = wdCompanies.length;
        wdCompanies = wdCompanies.filter(c => {
          const s = strip(c.name);
          for (const [k, filings] of permIndex) {
            if ((k.startsWith(s) || s.startsWith(k)) && filings > 0) return true;
          }
          return false;
        });
        console.log(`\n  PERM-only Workday: ${before} → ${wdCompanies.length} companies`);
      }
    }

    console.log(`${opts.permOnly ? "" : "\n"}Searching ${wdCompanies.length} Workday companies...`);
    const WD_CONCURRENCY = 3;
    for (let i = 0; i < wdCompanies.length; i += WD_CONCURRENCY) {
      const batch = wdCompanies.slice(i, i + WD_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(c => searchWorkday(c, opts.query))
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled" && r.value.length > 0) {
          console.log(`  ${batch[j].name} (workday): ${r.value.length} matches`);
          allJobs.push(...r.value);
        } else if (r.status === "rejected") {
          console.log(`  ${batch[j].name} (workday): error - ${r.reason?.message ?? "failed"}`);
        }
      }
      if (i + WD_CONCURRENCY < wdCompanies.length) await new Promise(r => setTimeout(r, 1000));
    }
  }

  // --- SmartRecruiters companies ---
  if (!opts.atsFilter || opts.atsFilter.includes("smartrecruiters")) {
    console.log(`\nSearching ${SMARTRECRUITERS_COMPANIES.length} SmartRecruiters companies...`);
    const results = await Promise.allSettled(
      SMARTRECRUITERS_COMPANIES.map(c => searchSmartRecruiters(c, opts.query))
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled" && r.value.length > 0) {
        console.log(`  ${SMARTRECRUITERS_COMPANIES[j].name} (smartrecruiters): ${r.value.length} matches`);
        allJobs.push(...r.value);
      }
    }
  }

  if (opts.skipTitles?.length) {
    const before = allJobs.length;
    allJobs = allJobs.filter(j => !opts.skipTitles!.some(t => j.title.toLowerCase().includes(t.toLowerCase())));
    console.log(`  Title filter: ${before} → ${allJobs.length} (excluded ${opts.skipTitles.join(", ")})`);
  }
  if (opts.locations?.length) {
    const before = allJobs.length;
    allJobs = allJobs.filter(j => opts.locations!.some(l => j.location.toLowerCase().includes(l.toLowerCase())));
    console.log(`  Location filter: ${before} → ${allJobs.length} (${opts.locations.join(", ")})`);
  }

  writeFileSync(opts.outputPath, JSON.stringify(allJobs, null, 2));
  console.log(`\nTotal: ${allJobs.length} jobs found. Written to ${opts.outputPath}`);
  return allJobs;
}
