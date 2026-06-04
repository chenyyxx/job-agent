// SmartRecruiters API adapter
// GET https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100&offset=0
// No auth required for public postings

import type { Job } from "./index.js";

export interface SmartRecruitersCompany {
  name: string;
  slug: string;
}

// Curated list — tech companies only (excluding staffing agencies)
export const SMARTRECRUITERS_COMPANIES: SmartRecruitersCompany[] = [
  { name: "ServiceNow", slug: "ServiceNow" },
  { name: "Western Digital", slug: "WesternDigital" },
  { name: "NBCUniversal", slug: "NBCUniversal3" },
  { name: "AbbVie", slug: "AbbVie" },
  { name: "Bosch", slug: "BoschGroup" },
  { name: "AECOM", slug: "AECOM2" },
  { name: "Visa", slug: "Visa" },
  { name: "Eurofins", slug: "Eurofins" },
  { name: "General Dynamics UK", slug: "GDMSI" },
  { name: "DellFor Technologies", slug: "DellforTechnologies" },
];

const HEADERS = { Accept: "application/json", "User-Agent": "Mozilla/5.0" };

interface SRPosting {
  id?: string;
  name?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean };
  department?: { label?: string };
  createdOn?: string;
  ref?: string;
  company?: { name?: string };
}

export async function searchSmartRecruiters(company: SmartRecruitersCompany, query: string): Promise<Job[]> {
  const allJobs: Job[] = [];
  let offset = 0;
  const limit = 100;

  while (offset < 300) {
    const url = `https://api.smartrecruiters.com/v1/companies/${company.slug}/postings?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) break;
    const data = await res.json() as { content?: SRPosting[]; totalFound?: number };
    const postings = data.content ?? [];
    if (postings.length === 0) break;

    const kw = query.toLowerCase();
    for (const p of postings) {
      const blob = `${p.name ?? ""} ${p.department?.label ?? ""} ${p.location?.city ?? ""}`.toLowerCase();
      if (!blob.includes(kw)) continue;
      const loc = [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(", ");
      allJobs.push({
        id: p.id ?? p.ref ?? "",
        company: company.name,
        title: p.name ?? "",
        location: p.location?.remote ? `Remote, ${loc}` : loc,
        url: `https://jobs.smartrecruiters.com/${company.slug}/${p.id}`,
        department: p.department?.label ?? "",
        posted_at: p.createdOn ?? "",
      });
    }

    if (offset + limit >= (data.totalFound ?? 0)) break;
    offset += limit;
    await new Promise(r => setTimeout(r, 1000));
  }
  return allJobs;
}
