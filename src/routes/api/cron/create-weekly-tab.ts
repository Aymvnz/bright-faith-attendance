import { createFileRoute } from "@tanstack/react-router";
import { duplicateMostRecentTabForDate } from "@/lib/sheet-sync.server";

export const Route = createFileRoute("/api/cron/create-weekly-tab")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        const authHeader = request.headers.get("authorization");
        if (!secret || authHeader !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Chicago",
          weekday: "short",
          hour: "numeric",
          hour12: false,
        }).formatToParts(new Date());
        const weekday = parts.find((p) => p.type === "weekday")?.value;
        const hour = Number(parts.find((p) => p.type === "hour")?.value);

        if (weekday !== "Fri" || hour !== 23) {
          return Response.json({ ok: true, skipped: true, weekday, hour });
        }

        const chicagoDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Chicago",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        const [y, m, d] = chicagoDate.split("-").map(Number);
        const saturday = new Date(Date.UTC(y, m - 1, d + 1));
        const tabLabel = `${saturday.getUTCMonth() + 1}/${saturday.getUTCDate()}`;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: settings } = await supabaseAdmin
          .from("program_settings")
          .select("spreadsheet_id")
          .limit(1)
          .maybeSingle();

        const spreadsheetId = settings?.spreadsheet_id;
        if (!spreadsheetId) {
          return Response.json({ ok: false, error: "No Google Sheet connected yet." }, { status: 500 });
        }

        try {
          const result = await duplicateMostRecentTabForDate(spreadsheetId, tabLabel);
          return Response.json({ ok: true, tabLabel, ...result });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : "Could not create the new tab." },
            { status: 500 },
          );
        }
      },
    },
  },
});