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
// Probed from SimplifyJobs listings — 1248 candidates → 41 curated with SWE results
export const WORKDAY_COMPANIES: WorkdayCompany[] = [
  // === Semiconductor / Hardware ===
  { name: "NVIDIA", tenant: "nvidia", wdServer: "wd5", site: "NVIDIAExternalCareerSite" },
  { name: "Intel", tenant: "intel", wdServer: "wd1", site: "External" },
  { name: "Micron Technology", tenant: "micron", wdServer: "wd1", site: "External" },
  { name: "Applied Materials", tenant: "amat", wdServer: "wd1", site: "External" },
  { name: "KLA", tenant: "kla", wdServer: "wd1", site: "Search" },
  { name: "Analog Devices", tenant: "analogdevices", wdServer: "wd1", site: "External" },
  { name: "GlobalFoundries", tenant: "globalfoundries", wdServer: "wd1", site: "External" },
  { name: "Marvell", tenant: "marvell", wdServer: "wd1", site: "MarvellCareers" },
  { name: "Cadence Design Systems", tenant: "cadence", wdServer: "wd1", site: "External_Careers" },
  // === Software / Cloud ===
  { name: "Adobe", tenant: "adobe", wdServer: "wd5", site: "external_experienced" },
  { name: "Cisco", tenant: "cisco", wdServer: "wd5", site: "cisco_careers" },
  { name: "Autodesk", tenant: "autodesk", wdServer: "wd1", site: "Ext" },
  { name: "CrowdStrike", tenant: "crowdstrike", wdServer: "wd5", site: "crowdstrikecareers" },
  { name: "Workday", tenant: "workday", wdServer: "wd5", site: "Workday" },
  { name: "Hewlett Packard Enterprise", tenant: "hpe", wdServer: "wd5", site: "Jobsathpe" },
  { name: "Motorola Solutions", tenant: "motorolasolutions", wdServer: "wd5", site: "Careers" },
  { name: "Fiserv", tenant: "fiserv", wdServer: "wd5", site: "ext" },
  { name: "Ciena", tenant: "ciena", wdServer: "wd5", site: "Careers" },
  // === Finance / Fintech ===
  { name: "Capital One", tenant: "capitalone", wdServer: "wd12", site: "Capital_One" },
  { name: "Visa", tenant: "visa", wdServer: "wd5", site: "visa" },
  { name: "BlackRock", tenant: "blackrock", wdServer: "wd1", site: "BlackRock_Professional" },
  { name: "TD Bank", tenant: "td", wdServer: "wd3", site: "TD_Bank_Careers" },
  { name: "Royal Bank of Canada", tenant: "rbc", wdServer: "wd3", site: "rbcglobal1" },
  // === Defense / Govt Contractors ===
  { name: "RTX (Raytheon)", tenant: "globalhr", wdServer: "wd5", site: "rec_rtx_ext_gateway" },
  { name: "Northrop Grumman", tenant: "ngc", wdServer: "wd1", site: "Northrop_Grumman_External_Site" },
  { name: "Boeing", tenant: "boeing", wdServer: "wd1", site: "EXTERNAL_CAREERS" },
  { name: "Leidos", tenant: "leidos", wdServer: "wd5", site: "External" },
  { name: "CACI", tenant: "caci", wdServer: "wd1", site: "external" },
  { name: "General Dynamics IT", tenant: "gdit", wdServer: "wd5", site: "external_career_site" },
  { name: "Booz Allen", tenant: "bah", wdServer: "wd1", site: "bah_jobs" },
  { name: "KBR", tenant: "kbr", wdServer: "wd5", site: "KBR_Careers" },
  // === Telecom / Enterprise ===
  { name: "T-Mobile", tenant: "tmobile", wdServer: "wd1", site: "External" },
  { name: "AT&T", tenant: "att", wdServer: "wd1", site: "ATTGeneral" },
  { name: "Comcast", tenant: "comcast", wdServer: "wd5", site: "Comcast_Careers" },
  // === Healthcare / Industrial ===
  { name: "GE Healthcare", tenant: "gehc", wdServer: "wd5", site: "GEHC_ExternalSite" },
  { name: "GE Vernova", tenant: "gevernova", wdServer: "wd5", site: "only_confidential_executive_recruiting" },
  { name: "Abbott", tenant: "abbott", wdServer: "wd5", site: "abbottcareers" },
  { name: "Caterpillar", tenant: "cat", wdServer: "wd5", site: "CaterpillarCareers" },
  { name: "Teledyne", tenant: "flir", wdServer: "wd1", site: "flircareers" },
  // === Retail / Other ===
  { name: "Target", tenant: "target", wdServer: "wd5", site: "targetcareers" },
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
