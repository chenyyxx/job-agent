// Workday CXS API adapter
// POST https://{tenant}.{wdServer}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
// No auth required for public boards

import type { Job } from "./index.js";

export interface WorkdayCompany {
  name: string;
  tenant: string;
  wdServer: string;  // wd1, wd3, wd5, etc.
  site: string;
}

// Top PERM filers + notable companies on Workday (confirmed working 2026-06-04)
export const WORKDAY_COMPANIES: WorkdayCompany[] = [
  { name: "NVIDIA", tenant: "nvidia", wdServer: "wd5", site: "NVIDIAExternalCareerSite" },
  { name: "Adobe", tenant: "adobe", wdServer: "wd5", site: "external_experienced" },
  { name: "Visa", tenant: "visa", wdServer: "wd5", site: "visa" },
  { name: "CrowdStrike", tenant: "crowdstrike", wdServer: "wd5", site: "crowdstrikecareers" },
  { name: "Autodesk", tenant: "autodesk", wdServer: "wd1", site: "Ext" },
  { name: "Workday", tenant: "workday", wdServer: "wd5", site: "Workday" },
  { name: "Target", tenant: "target", wdServer: "wd5", site: "targetcareers" },
  { name: "Intel", tenant: "intel", wdServer: "wd1", site: "External" },
  { name: "T-Mobile", tenant: "tmobile", wdServer: "wd1", site: "External" },
  { name: "Walmart", tenant: "walmart", wdServer: "wd5", site: "WalmartExternal" },
];

const HEADERS = {
  "Accept": "application/json",
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

function htmlToText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

interface WorkdayPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WorkdayResponse {
  total?: number;
  jobPostings?: WorkdayPosting[];
}

export async function searchWorkday(company: WorkdayCompany, query: string): Promise<Job[]> {
  const baseUrl = `https://${company.tenant}.${company.wdServer}.myworkdayjobs.com`;
  const apiUrl = `${baseUrl}/wday/cxs/${company.tenant}/${company.site}/jobs`;

  const allJobs: Job[] = [];
  let offset = 0;
  const limit = 20;

  // Paginate (cap at 200 to avoid hammering)
  while (offset < 200) {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        ...HEADERS,
        "Referer": `${baseUrl}/en-US/${company.site}`,
      },
      body: JSON.stringify({
        appliedFacets: {},
        limit,
        offset,
        searchText: query,
      }),
    });

    if (!res.ok) break;
    const data = await res.json() as WorkdayResponse;
    const postings = data.jobPostings ?? [];
    if (postings.length === 0) break;

    for (const p of postings) {
      allJobs.push({
        id: p.externalPath ?? "",
        company: company.name,
        title: p.title ?? "",
        location: p.locationsText ?? "",
        url: `${baseUrl}/en-US/${company.site}${p.externalPath}`,
        department: "",
        posted_at: p.postedOn ?? "",
      });
    }

    if (offset + limit >= (data.total ?? 0)) break;
    offset += limit;
    // Rate limit: 1.5s between pages
    await new Promise(r => setTimeout(r, 1500));
  }

  return allJobs;
}

// Fetch full job description for a single posting (optional enrichment)
export async function fetchWorkdayJobDetail(
  company: WorkdayCompany,
  externalPath: string
): Promise<string | undefined> {
  const url = `https://${company.tenant}.${company.wdServer}.myworkdayjobs.com/wday/cxs/${company.tenant}/${company.site}/job/${externalPath}`;
  const res = await fetch(url, {
    headers: { ...HEADERS, "Accept-Encoding": "gzip, deflate, br" },
  });
  if (!res.ok) return undefined;
  const data = await res.json() as { jobDescription?: string };
  return data.jobDescription ? htmlToText(data.jobDescription) : undefined;
}
