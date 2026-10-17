import { createFileRoute } from "@tanstack/react-router";
import { findDateTab, writeAttendanceToTab } from "@/lib/sheet-sync.server";
import { readRoster } from "@/lib/roster-core.server";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

export const Route = createFileRoute("/api/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedPin = process.env["SCAN_PIN"];
        if (!expectedPin) {
          return json({ ok: false, error: "Scan-only mode is not set up yet." }, 503);
        }

        let body: { action?: string; pin?: string; code?: string };
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "Invalid request." }, 400);
        }

        const { timingSafeEqual } = await import("node:crypto");
        const given = Buffer.from(String(body.pin ?? ""));
        const expected = Buffer.from(expectedPin);
        const pinOk = given.length === expected.length && timingSafeEqual(given, expected);
        if (!pinOk) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          return json({ ok: false, error: "Incorrect PIN." }, 401);
        }

        if (body.action === "check") return json({ ok: true });

        const code = String(body.code ?? "").trim();
        if (!code) return json({ ok: false, error: "No code received." }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const roster = await readRoster(supabaseAdmin);
        if (roster.error) {
          console.error("scan: roster failed:", roster.error);
          return json({ ok: false, error: "Could not load the roster." }, 500);
        }

        const student =
          roster.students.find((s) => s.id.toLowerCase() === code.toLowerCase()) ??
          roster.students.find((s) => s.name.toLowerCase() === code.toLowerCase());
        if (!student) {
          return json({ ok: false, error: "That code doesn't match any student." }, 404);
        }

        if (body.action === "lookup") return json({ ok: true, name: student.name });
        if (body.action !== "mark") return json({ ok: false, error: "Unknown action." }, 400);

        const now = new Date();
        const sessionDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Chicago",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(now);

        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Chicago",
          hourCycle: "h23",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        }).formatToParts(now);
        const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
        const nowSeconds = get("hour") * 3600 + get("minute") * 60 + get("second");

        const { data: settings } = await supabaseAdmin
          .from("program_settings")
          .select("spreadsheet_id, tardy_after")
          .limit(1)
          .maybeSingle();

        const [cutoffHour, cutoffMinute] = String(settings?.tardy_after ?? "10:30").split(":");
        const cutoffSeconds = Number(cutoffHour) * 3600 + Number(cutoffMinute) * 60;
        const status = nowSeconds > cutoffSeconds ? "tardy" : "present";

        // Scan-only mode can only create a record, never overwrite one.
        const { data: existing } = await supabaseAdmin
          .from("attendance_records")
          .select("status")
          .eq("student_id", student.id)
          .eq("session_date", sessionDate)
          .maybeSingle();
        if (existing) {
          return json({ ok: true, already: true, name: student.name, status: existing.status });
        }

        const { error: insertError } = await supabaseAdmin.from("attendance_records").upsert(
          {
            student_id: student.id,
            student_name: student.name,
            session_date: sessionDate,
            status,
            scanned_at: now.toISOString(),
          },
          { onConflict: "student_id,session_date", ignoreDuplicates: true },
        );
        if (insertError) {
          console.error("scan: insert failed:", insertError.message);
          return json({ ok: false, error: "Could not save attendance." }, 500);
        }

        // Mirror the dashboard: push today's records to the sheet tab.
        let sheetSynced = false;
        const spreadsheetId = settings?.spreadsheet_id;
        if (spreadsheetId) {
          try {
            const { title } = await findDateTab(spreadsheetId, sessionDate);
            if (title) {
              const { data: records } = await supabaseAdmin
                .from("attendance_records")
                .select("student_name, status")
                .eq("session_date", sessionDate);
              const entries = (records ?? []).map((r) => ({ name: r.student_name, status: r.status }));
              await writeAttendanceToTab(spreadsheetId, title, entries);
              sheetSynced = true;
            }
          } catch (e) {
            console.error("scan: sheet sync failed:", e);
          }
        }

        return json({ ok: true, name: student.name, status, sheetSynced });
      },
    },
  },
});