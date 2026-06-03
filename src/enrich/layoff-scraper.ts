// Layoff data: import from CSV export or layoffs.fyi JSON snapshot
// The Airtable API requires browser cookies that expire frequently.
// Recommended: use 'Copy to clipboard' from layoffs.fyi or CSV export.
//
// Supported formats:
//   1. CSV with columns: Company, Date, # Laid Off, %, Industry, Source
//   2. JSON array: [{company, date, count, percent}]
//
// Usage: job-agent layoff-scrape <file.csv|file.json>
//   Without args: attempts Airtable API (may fail without fresh cookies)

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

export interface LayoffRecord {
  company: string;
  date: string;
  count: number;
  percent: number | null;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseLayoffCsv(content: string): LayoffRecord[] {
  const lines = content.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const iCompany = header.findIndex(h => h.includes("company"));
  const iDate = header.findIndex(h => h.includes("date"));
  const iCount = header.findIndex(h => h.includes("laid off") || h.includes("count") || h === "#");
  const iPercent = header.findIndex(h => h.includes("%") || h.includes("percent"));

  if (iCompany < 0 || iCount < 0) {
    throw new Error(`Cannot find Company/Count columns. Found: ${header.join(", ")}`);
  }

  const records: LayoffRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const company = cols[iCompany] ?? "";
    const count = parseInt(cols[iCount]?.replace(/[, ]/g, "") ?? "0") || 0;
    if (!company || count <= 0) continue;

    records.push({
      company,
      date: cols[iDate] ?? "",
      count,
      percent: iPercent >= 0 ? (parseFloat(cols[iPercent]) || null) : null,
    });
  }
  return records;
}

function dedup(records: LayoffRecord[]): LayoffRecord[] {
  const map = new Map<string, LayoffRecord>();
  for (const r of records) {
    const key = r.company.toLowerCase();
    const existing = map.get(key);
    if (!existing || r.date > existing.date) map.set(key, r);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function scrapeLayoffs(outputPath: string, inputFile?: string): Promise<void> {
  let records: LayoffRecord[];

  if (inputFile) {
    const absPath = resolve(inputFile);
    if (!existsSync(absPath)) {
      console.error(`File not found: ${absPath}`);
      return;
    }
    const content = readFileSync(absPath, "utf-8");
    if (absPath.endsWith(".json")) {
      records = JSON.parse(content);
    } else {
      records = parseLayoffCsv(content);
    }
    console.log(`Imported ${records.length} layoff records from ${inputFile}`);
  } else {
    // Attempt Airtable API — needs cookies from a browser session
    console.log("Fetching layoff data from layoffs.fyi...");
    console.log("  ⚠ Airtable requires browser cookies. If this fails:");
    console.log("    1. Open https://layoffs.fyi in browser");
    console.log("    2. Use browser DevTools → Copy table as CSV");
    console.log("    3. Run: job-agent layoff-scrape <exported.csv>");

    try {
      const res = await fetch("https://airtable.com/appBbYSw09r2koNPA/shrqYt5kSqMzHV9R5", {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Airtable SPA doesn't serve data inline — need cookies for API
      throw new Error("Airtable requires authenticated cookies (use CSV import instead)");
    } catch (e: any) {
      console.error(`  ✗ ${e.message}`);
      return;
    }
  }

  const deduped = dedup(records);
  writeFileSync(outputPath, JSON.stringify(deduped, null, 2));
  console.log(`  ${deduped.length} unique companies (most recent per company)`);
  if (deduped.length > 0) {
    console.log(`  Latest: ${deduped[0].company} (${deduped[0].date}, ${deduped[0].count} people)`);
  }
  console.log(`  Written to ${outputPath}`);
}
