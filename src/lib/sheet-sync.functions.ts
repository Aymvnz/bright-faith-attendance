import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findDateTab, writeAttendanceToTab } from "./sheet-sync.server";

export type SheetSyncResult = {
  ok: boolean;
  tab?: string;
  matched?: number;
  updated?: number;
  appended?: number;
  error?: string;
};

export const syncAttendanceToSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionDate: string }) => input)
  .handler(async ({ data, context }): Promise<SheetSyncResult> => {
    const { data: settings } = await context.supabase
      .from("program_settings")
      .select("spreadsheet_id")
      .limit(1)
      .maybeSingle();

    const spreadsheetId = settings?.spreadsheet_id;
    if (!spreadsheetId) return { ok: false, error: "No Google Sheet connected yet." };

    const { data: records, error } = await context.supabase
      .from("attendance_records")
      .select("student_name, status")
      .eq("session_date", data.sessionDate);
    if (error) return { ok: false, error: error.message };

    const entries = (records ?? []).map((r) => ({ name: r.student_name, status: r.status }));

    try {
      const { title } = await findDateTab(spreadsheetId, data.sessionDate);
      if (!title) {
        const [, mo, da] = data.sessionDate.split("-");
        const label = `${Number(mo)}/${Number(da)}`;
        const isToday = data.sessionDate === new Date().toLocaleDateString("en-CA");
        return {
          ok: false,
          error: `No tab found for ${isToday ? "today" : "that date"} (${label}). Add a tab named like "${label}" to the sheet.`,
        };
      }
      const result = await writeAttendanceToTab(spreadsheetId, title, entries);
      return { ok: true, tab: title, ...result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Sheet sync failed." };
    }
  });