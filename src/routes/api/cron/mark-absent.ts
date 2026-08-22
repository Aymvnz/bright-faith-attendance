import { createFileRoute } from "@tanstack/react-router";
import { findDateTab, writeAttendanceToTab } from "@/lib/sheet-sync.server";
import { readRoster } from "@/lib/roster-core.server";

export const Route = createFileRoute("/api/cron/mark-absent")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        const authHeader = request.headers.get("authorization");
        if (!secret || authHeader !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const chicagoParts = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Chicago",
          hour: "numeric",
          hour12: false,
        }).format(new Date());
        const chicagoHour = Number(chicagoParts);
        const TARGET_HOUR = 11; // 11:00 AM Chicago time

        if (chicagoHour !== TARGET_HOUR) {
          return Response.json({ ok: true, skipped: true, chicagoHour });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { readRoster } = await import("@/lib/roster-core.server");
        const { findDateTab, markBlankCellsAbsent } = await import("@/lib/sheet-sync.server");

        const { data: settings } = await supabaseAdmin
          .from("program_settings")
          .select("spreadsheet_id")
          .limit(1)
          .maybeSingle();

        const spreadsheetId = settings?.spreadsheet_id;
        if (!spreadsheetId) {
          return Response.json({ ok: false, error: "No Google Sheet connected yet." }, { status: 500 });
        }

        const roster = await readRoster(supabaseAdmin);
        if (roster.error) {
          return Response.json({ ok: false, step: "roster", error: roster.error }, { status: 500 });
        }
        if (!roster.students.length) {
          return Response.json({ ok: true, sessionDate, markedAbsent: 0, note: "Roster is empty." });
        }

        const { title } = await findDateTab(spreadsheetId, sessionDate);
        if (!title) {
          const [, mo, da] = sessionDate.split("-");
          return Response.json(
            { ok: false, error: `No tab found for ${Number(mo)}/${Number(da)}.` },
            { status: 500 },
          );
        }

        // Only fills in cells that are currently blank — anyone who already
        // has a value in the sheet (present, tardy, excused, or even a
        // manually-typed status) is left completely untouched.
        const result = await markBlankCellsAbsent(spreadsheetId, title, roster.students);

        // Keep Supabase's own records consistent with what we just marked
        // absent in the sheet, without touching students the sheet already
        // had a value for.
        if (result.markedAbsent.length) {
          const rows = result.markedAbsent.map((name) => {
            const student = roster.students.find((s) => s.name === name)!;
            return {
              student_id: student.id,
              student_name: student.name,
              status: "absent",
              session_date: sessionDate,
            };
          });
          await supabaseAdmin
            .from("attendance_records")
            .upsert(rows, { onConflict: "student_id,session_date", ignoreDuplicates: true });
        }

        return Response.json({ ok: true, sessionDate, tab: title, ...result });
      },
    },
  },
});