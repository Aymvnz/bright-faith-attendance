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

        const sessionDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Chicago",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());

        const roster = await readRoster(supabaseAdmin);
        if (roster.error) {
          return Response.json({ ok: false, step: "roster", error: roster.error }, { status: 500 });
        }
        if (!roster.students.length) {
          return Response.json({ ok: true, sessionDate, markedAbsent: 0, note: "Roster is empty." });
        }

        const { data: existing, error: existingError } = await supabaseAdmin
          .from("attendance_records")
          .select("student_id")
          .eq("session_date", sessionDate);
        if (existingError) {
          return Response.json(
            { ok: false, step: "read-existing", error: existingError.message },
            { status: 500 },
          );
        }

        const already = new Set((existing ?? []).map((r) => r.student_id));
        const toInsert = roster.students
          .filter((s) => !already.has(s.id))
          .map((s) => ({
            student_id: s.id,
            student_name: s.name,
            status: "absent",
            session_date: sessionDate,
          }));

        if (toInsert.length) {
          const { error: insertError } = await supabaseAdmin
            .from("attendance_records")
            .upsert(toInsert, { onConflict: "student_id,session_date", ignoreDuplicates: true });
          if (insertError) {
            return Response.json({ ok: false, step: "insert", error: insertError.message }, { status: 500 });
          }
        }

        // Sync today's full attendance (including the absences we just added)
        // to the Google Sheet tab — same logic the manual sync button uses,
        // inlined here directly rather than through the shared wrapper.
        const { data: settings } = await supabaseAdmin
          .from("program_settings")
          .select("spreadsheet_id")
          .limit(1)
          .maybeSingle();

        const spreadsheetId = settings?.spreadsheet_id;
        let sync: Record<string, unknown> = { ok: false, error: "No Google Sheet connected yet." };

        if (spreadsheetId) {
          const { data: records, error: recordsError } = await supabaseAdmin
            .from("attendance_records")
            .select("student_name, status")
            .eq("session_date", sessionDate);

          if (recordsError) {
            sync = { ok: false, error: recordsError.message };
          } else {
            const entries = (records ?? []).map((r) => ({ name: r.student_name, status: r.status }));
            try {
              const { title } = await findDateTab(spreadsheetId, sessionDate);
              if (!title) {
                const [, mo, da] = sessionDate.split("-");
                sync = { ok: false, error: `No tab found for that date (${Number(mo)}/${Number(da)}).` };
              } else {
                const result = await writeAttendanceToTab(spreadsheetId, title, entries);
                sync = { ok: true, tab: title, ...result };
              }
            } catch (e) {
              sync = { ok: false, error: e instanceof Error ? e.message : "Sheet sync failed." };
            }
          }
        }

        return Response.json({ ok: true, sessionDate, markedAbsent: toInsert.length, sync });
      },
    },
  },
});