import { sheetsFetch } from "./google-sheets.server";

export type StatusMap = Record<string, string>; // slug -> present|tardy|absent

export function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function encodeRange(range: string) {
  return range.replace(/ /g, "%20").replace(/'/g, "%27").replace(/\//g, "%2F");
}

async function call(path: string, init?: RequestInit) {
  return sheetsFetch(path, init);
}

/** Parses a tab title like "08/23", "7/31", or "7/31/26" into {month, day}. */
function parseTabDate(title: string): { month: number; day: number } | null {
  const m = title.trim().match(/^(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*\d{2,4})?$/);
  if (!m) return null;
  return { month: Number(m[1]), day: Number(m[2]) };
}

export async function findDateTab(spreadsheetId: string, sessionDate: string) {
  const meta = await call(`/${spreadsheetId}?fields=sheets.properties.title`);
  const titles: string[] = (meta.sheets ?? []).map((s: any) => s.properties?.title ?? "");
  const [, mo, da] = sessionDate.split("-").map(Number) as [number, number, number];
  const match = titles.find((t) => {
    const parsed = parseTabDate(t);
    return parsed && parsed.month === mo && parsed.day === da;
  });
  return { title: match ?? null, titles };
}

const LABEL: Record<string, string> = {
  present: "P",
  tardy: "T",
  absent: "A",
  excused: "E",
};

export type AttendanceEntry = { name: string; status: string };

export async function writeAttendanceToTab(
  spreadsheetId: string,
  tabTitle: string,
  entries: AttendanceEntry[],
) {
  const quoted = `'${tabTitle.replace(/'/g, "''")}'`;
  const read = await call(`/${spreadsheetId}/values/${encodeRange(`${quoted}!A1:B500`)}`);
  const rows: string[][] = read.values ?? [];

  // slug -> { label, name } for everyone who has a status today
  const bySlug = new Map<string, { label: string; name: string }>();
  for (const e of entries) {
    const label = LABEL[e.status];
    if (!label) continue;
    bySlug.set(slugifyName(e.name), { label, name: e.name });
  }

  const updates: { range: string; values: string[][] }[] = [];
  const seen = new Set<string>();
  let matched = 0;

  rows.forEach((row, i) => {
    const name = (row?.[0] ?? "").toString().trim();
    if (!name) return;
    const slug = slugifyName(name);
    const entry = bySlug.get(slug);
    if (!entry) return;
    seen.add(slug);
    matched += 1;
    const current = (row?.[1] ?? "").toString().trim();
    if (current === entry.label) return;
    updates.push({ range: `${quoted}!B${i + 1}`, values: [[entry.label]] });
  });

  if (updates.length) {
    await call(`/${spreadsheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updates }),
    });
  }

  // Anyone with a status today but no existing row in this tab is a student
  // who was added to the roster after this tab was created. Use the Sheets
  // "append" operation (with INSERT_ROWS) rather than writing to a fixed
  // A{row}:B{row} range — a fixed range beyond the tab's current row count
  // fails with a 400 ("exceeds grid limits"), while append grows the sheet
  // automatically.
  const toAppend: string[][] = [];
  for (const [slug, entry] of bySlug) {
    if (seen.has(slug)) continue;
    toAppend.push([entry.name, entry.label]);
  }

  if (toAppend.length) {
    await call(
      `/${spreadsheetId}/values/${encodeRange(`${quoted}!A:B`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({ values: toAppend }),
      },
    );
  }

  return { matched, updated: updates.length, appended: toAppend.length };
}