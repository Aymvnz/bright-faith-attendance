import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_RANGE = "Primary Parental Contact Info !A1:J500";

export type Student = {
  id: string;
  name: string;
  group: string;
};

export type RosterResult = {
  students: Student[];
  spreadsheetId: string | null;
  sheetRange: string;
  error?: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseRows(rows: string[][]): Student[] {
  if (!rows.length) return [];
  const header = rows[0]!.map((c) => (c ?? "").toString().trim().toLowerCase());
  const looksLikeHeader =
    header.some((c) => c.includes("name")) || header.some((c) => c === "id");
  let idCol = -1;
  let nameCol = 1;
  let groupCol = 0;
  let body = rows;
  if (looksLikeHeader) {
    body = rows.slice(1);
    const findCol = (matcher: (c: string) => boolean, fallback: number) => {
      const i = header.findIndex(matcher);
      return i === -1 ? fallback : i;
    };
    idCol = findCol((c) => /(^|\s|_)id(\s|_|#|$)/.test(c), -1);
    nameCol = findCol((c) => c.includes("name") || c === "student", 1);
    groupCol = findCol(
      (c) => ["group", "class", "grade", "level"].some((n) => c.includes(n)),
      0,
    );
  }
  const seen = new Map<string, number>();
  return body
    .map((row) => {
      const name = (row[nameCol] ?? "").toString().trim();
      const rawId = idCol >= 0 ? (row[idCol] ?? "").toString().trim() : "";
      let id = rawId || slugify(name);
      if (!rawId && id) {
        const count = (seen.get(id) ?? 0) + 1;
        seen.set(id, count);
        if (count > 1) id = `${id}-${count}`;
      }
      return { id, name, group: (row[groupCol] ?? "").toString().trim() };
    })
    .filter((s) => s.name.length > 0 && s.id.length > 0 && !/^\d+$/.test(s.name));
}

export async function readRoster(supabase: SupabaseClient<any>): Promise<RosterResult> {
  const { data: settings } = await supabase
    .from("program_settings")
    .select("spreadsheet_id, sheet_range")
    .limit(1)
    .maybeSingle();

  const spreadsheetId = settings?.spreadsheet_id ?? null;
  const sheetRange = settings?.sheet_range ?? DEFAULT_RANGE;

  if (!spreadsheetId) {
    return { students: [], spreadsheetId: null, sheetRange };
  }

  const encodedRange = sheetRange.replace(/ /g, "%20").replace(/'/g, "%27");

  try {
    const { sheetsFetch } = await import("./google-sheets.server");
    const json = (await sheetsFetch(`/${spreadsheetId}/values/${encodedRange}`)) as {
      values?: string[][];
    };
    return { students: parseRows(json.values ?? []), spreadsheetId, sheetRange };
  } catch (e) {
    return {
      students: [],
      spreadsheetId,
      sheetRange,
      error:
        e instanceof Error
          ? e.message
          : "Could not read the sheet. Check the sheet ID, tab name, and that it's shared with the service account.",
    };
  }
}