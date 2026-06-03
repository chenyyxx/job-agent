// PERM Importer: parse DOL PERM disclosure XLSX files into perm-cache.json
// Usage: job-agent perm-import <path-to-xlsx> [<path2> ...]
// Downloads from: https://www.dol.gov/agencies/eta/foreign-labor/performance
// Each file is one quarter. Pass multiple for trend detection.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

interface PermRow {
  employer: string;
  status: string; // Certified, Denied, Withdrawn
  job_title: string;
  wage: number | null;
  decision_date: string;
}

interface PermRecord {
  employer: string;
  filings: number;
  trend: "growing" | "stable" | "declining" | "frozen";
  top_roles: string[];
  avg_wage: number | null;
}

// Streaming CSV parser for DOL data (they also provide CSV versions)
// DOL columns: CASE_NUMBER, CASE_STATUS, EMPLOYER_NAME, JOB_TITLE, WAGE_OFFER_FROM_9089, DECISION_DATE
function parsePermCsv(content: string): PermRow[] {
  const lines = content.split("\n");
  const header = lines[0].split(",").map(h => h.replace(/"/g, "").trim().toUpperCase());

  const iEmployer = header.findIndex(h => h.includes("EMPLOYER_NAME"));
  const iStatus = header.findIndex(h => h.includes("CASE_STATUS"));
  const iTitle = header.findIndex(h => h.includes("JOB_TITLE"));
  const iWage = header.findIndex(h => h.includes("WAGE_OFFER_FROM"));
  const iDate = header.findIndex(h => h.includes("DECISION_DATE"));

  if (iEmployer < 0 || iStatus < 0) {
    throw new Error(`Cannot find EMPLOYER_NAME/CASE_STATUS columns. Found: ${header.slice(0, 10).join(", ")}`);
  }

  const rows: PermRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length <= iEmployer) continue;
    const employer = cols[iEmployer]?.replace(/"/g, "").trim();
    if (!employer) continue;

    rows.push({
      employer,
      status: cols[iStatus]?.replace(/"/g, "").trim() ?? "",
      job_title: cols[iTitle]?.replace(/"/g, "").trim() ?? "",
      wage: iWage >= 0 ? parseFloat(cols[iWage]?.replace(/[",$ ]/g, "") ?? "") || null : null,
      decision_date: cols[iDate]?.replace(/"/g, "").trim() ?? "",
    });
  }
  return rows;
}

// Handle quoted CSV fields with commas inside
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { result.push(current); current = ""; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

// Aggregate rows by employer
function aggregate(allRows: PermRow[], quarterCount: number): PermRecord[] {
  const byEmployer = new Map<string, PermRow[]>();
  for (const row of allRows) {
    const key = row.employer.toLowerCase();
    if (!byEmployer.has(key)) byEmployer.set(key, []);
    byEmployer.get(key)!.push(row);
  }

  const records: PermRecord[] = [];
  for (const [, rows] of byEmployer) {
    const certified = rows.filter(r => r.status.toLowerCase().includes("certified"));
    const wages = rows.map(r => r.wage).filter((w): w is number => w !== null && w > 0);

    // Count top job titles
    const titleCounts = new Map<string, number>();
    for (const r of rows) {
      const t = r.job_title.toLowerCase();
      if (t) titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
    }
    const topRoles = [...titleCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);

    // Simple trend: filings per quarter
    const filingsPerQ = rows.length / Math.max(quarterCount, 1);
    let trend: PermRecord["trend"] = "stable";
    if (rows.length === 0) trend = "frozen";
    else if (filingsPerQ < 1) trend = "declining";
    else if (filingsPerQ > 10) trend = "growing";

    records.push({
      employer: rows[0].employer,
      filings: Math.round(filingsPerQ),
      trend,
      top_roles: topRoles,
      avg_wage: wages.length > 0 ? Math.round(wages.reduce((a, b) => a + b, 0) / wages.length) : null,
    });
  }

  return records.sort((a, b) => b.filings - a.filings);
}

export async function permImport(filePaths: string[], outputPath: string): Promise<void> {
  console.log(`Importing PERM data from ${filePaths.length} file(s)...`);
  const allRows: PermRow[] = [];

  for (const fp of filePaths) {
    const absPath = resolve(fp);
    if (!existsSync(absPath)) {
      console.error(`  ✗ File not found: ${absPath}`);
      continue;
    }

    const ext = absPath.toLowerCase();
    if (ext.endsWith(".csv")) {
      const content = readFileSync(absPath, "utf-8");
      const rows = parsePermCsv(content);
      console.log(`  ${fp}: ${rows.length} rows`);
      allRows.push(...rows);
    } else if (ext.endsWith(".xlsx")) {
      console.error(`  ✗ XLSX not supported yet — convert to CSV first:`);
      console.error(`    pip install openpyxl && python3 -c "import openpyxl; wb=openpyxl.load_workbook('${fp}'); ws=wb.active; ..."`);
      console.error(`    Or use: libreoffice --headless --convert-to csv "${fp}"`);
      continue;
    } else {
      console.error(`  ✗ Unsupported format: ${fp} (use .csv)`);
      continue;
    }
  }

  if (allRows.length === 0) {
    console.error("No data loaded. Provide DOL PERM CSV files.");
    return;
  }

  const records = aggregate(allRows, filePaths.length);
  writeFileSync(outputPath, JSON.stringify(records, null, 2));
  console.log(`\n  ${allRows.length} total rows → ${records.length} unique employers`);
  console.log(`  Top 10 filers:`);
  for (const r of records.slice(0, 10)) {
    console.log(`    ${r.employer}: ${r.filings}/quarter, trend=${r.trend}, avg=$${r.avg_wage ?? "?"}`);
  }
  console.log(`  Written to ${outputPath}`);
}
