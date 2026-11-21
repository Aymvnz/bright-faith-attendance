import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readRoster, type RosterResult, type Student } from "./roster-core.server";

export type { RosterResult, Student };

export interface BoardStats {
  present: number;
  tardy: number;
  excused: number;
  absent: number;
  notYet: number;
  total: number;
  checkedIn: number;
  pct: number;
  error?: string;
}

function chicagoToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Existing authenticated roster function for the main app
export const getRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RosterResult> => readRoster(context.supabase));

// Public aggregate-only stats for the kiosk board (no student names exposed)
export const getBoardStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<BoardStats> => {
    const supabase = getServiceSupabase();
    const today = chicagoToday();

    const [roster, attendanceRes] = await Promise.all([
      readRoster(supabase),
      supabase
        .from("attendance_records")
        .select("student_id, status")
        .eq("session_date", today),
    ]);

    if (attendanceRes.error) {
      throw attendanceRes.error;
    }

    const students = roster.students ?? [];
    const byStudent = new Map<string, string>();
    for (const r of attendanceRes.data ?? []) {
      byStudent.set(r.student_id, r.status);
    }

    let present = 0;
    let tardy = 0;
    let excused = 0;
    let absent = 0;
    for (const s of students) {
      const status = byStudent.get(s.id);
      if (status === "present") present += 1;
      else if (status === "tardy") tardy += 1;
      else if (status === "excused") excused += 1;
      else if (status === "absent") absent += 1;
    }

    const total = students.length;
    const checkedIn = present + tardy;
    const notYet = total - (present + tardy + excused + absent);
    const pct = total ? Math.round((checkedIn / total) * 100) : 0;

    return {
      present,
      tardy,
      excused,
      absent,
      notYet,
      total,
      checkedIn,
      pct,
      error: roster.error,
    };
  }
);
