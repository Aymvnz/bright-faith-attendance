import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getRoster } from "@/lib/roster.functions";

export const Route = createFileRoute("/board")({
  head: () => ({
    meta: [{ title: "Check-in board" }],
  }),
  component: BoardPage,
});

// Shows "Imran Q." on the big screen. Set to true to show full names.
const SHOW_FULL_NAMES = false;
const TZ = "America/Chicago";

const STATUS_DOT: Record<string, string> = {
  present: "bg-emerald-400",
  tardy: "bg-amber-400",
  excused: "bg-sky-400",
  absent: "bg-rose-400",
};

function chicagoToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function displayName(name: string) {
  if (SHOW_FULL_NAMES) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-baseline gap-5 text-right">
      <span className="text-xl font-medium text-slate-300">
        {now.toLocaleDateString("en-US", {
          timeZone: TZ,
          weekday: "short",
          month: "short",
          day: "numeric",
        })}
      </span>
      <span className="text-4xl font-bold tabular-nums tracking-tight text-white">
        {now.toLocaleTimeString("en-US", {
          timeZone: TZ,
          hour: "numeric",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f1f5f9] p-10 text-[#142b4d]">
      {children}
    </div>
  );
}

function Stat({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`size-3 shrink-0 rounded-full ${dot}`} />
      <span className="text-base font-medium uppercase tracking-wider text-slate-300">
        {label}
      </span>
      <span className="text-3xl font-bold tabular-nums text-white">{value}</span>
    </div>
  );
}

function BoardPage() {
  const { session, loading } = useAuth();
  const rosterFn = useServerFn(getRoster);
  const today = chicagoToday();

  const rosterQuery = useQuery({
    queryKey: ["board-roster"],
    enabled: !!session,
    queryFn: () => rosterFn({}),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  const attendanceQuery = useQuery({
    queryKey: ["board-attendance", today],
    enabled: !!session,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("student_id, status")
        .eq("session_date", today);
      if (error) throw error;
      return data ?? [];
    },
  });

  const students = useMemo(() => {
    const list = rosterQuery.data?.students ?? [];
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [rosterQuery.data]);

  const records = useMemo(() => attendanceQuery.data ?? [], [attendanceQuery.data]);

  const byStudent = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) map.set(r.student_id, r.status);
    return map;
  }, [records]);

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

  const unauthorized =
    rosterQuery.isError &&
    rosterQuery.error instanceof Error &&
    rosterQuery.error.message.includes("Unauthorized");
  const hasProblem = !!rosterQuery.data?.error || rosterQuery.isError || attendanceQuery.isError;

  if (loading) {
    return (
      <Screen>
        <p className="text-3xl text-slate-500">Loading…</p>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <h1 className="text-4xl font-bold text-[#142b4d]">Sign in required</h1>
          <p className="mt-4 text-xl text-slate-600">
            Sign in on the main page with an approved account, then come back to this page.
          </p>
          <Link
            to="/"
            className="mt-8 inline-block rounded-xl bg-[#142b4d] px-8 py-4 text-xl font-semibold text-white hover:bg-[#1c3a66]"
          >
            Go to sign in
          </Link>
        </div>
      </Screen>
    );
  }

  if (unauthorized) {
    return (
      <Screen>
        <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <h1 className="text-4xl font-bold text-[#142b4d]">Access restricted</h1>
          <p className="mt-4 text-xl text-slate-600">
            {session.user.email} does not have access to this app.
          </p>
        </div>
      </Screen>
    );
  }

  return (
    <div className="min-h-screen bg-[#f1f5f9] text-[#142b4d]">
      {/* Deep Navy Header Band */}
      <div className="bg-[#142b4d] px-12 pb-10 pt-8 text-white">
        <header className="mb-8 flex items-baseline justify-between border-b border-white/15 pb-5">
          <div className="flex items-baseline gap-4">
            <h1 className="text-3xl font-bold tracking-tight">Chicago Downtown REC</h1>
            <span className="text-xl font-normal text-slate-300">Attendance</span>
            {hasProblem && (
              <span className="rounded-full bg-white/15 px-4 py-1 text-base font-medium text-amber-300">
                Reconnecting…
              </span>
            )}
          </div>
          <Clock />
        </header>

        {/* Minimalist Summary Row */}
        <div className="flex flex-wrap items-center justify-between gap-8">
          <div className="flex items-baseline gap-6">
            <div className="flex items-baseline gap-3">
              <span className="text-7xl font-bold tabular-nums tracking-tight text-white">
                {checkedIn}
              </span>
              <span className="text-4xl font-normal tabular-nums text-slate-300">
                / {total}
              </span>
            </div>
            <span className="text-5xl font-bold tabular-nums text-sky-300">{pct}%</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-9 gap-y-3">
            <Stat label="Present" value={present} dot={STATUS_DOT.present} />
            <Stat label="Tardy" value={tardy} dot={STATUS_DOT.tardy} />
            <Stat label="Excused" value={excused} dot={STATUS_DOT.excused} />
            <Stat label="Absent" value={absent} dot={STATUS_DOT.absent} />
            <Stat label="Not here" value={notYet} dot="border-2 border-slate-400" />
          </div>
        </div>

        <div className="mt-6 h-2.5 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-sky-300 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Clean Single-Roster Canvas */}
      <main className="px-12 py-10">
        <div className="flex flex-wrap gap-3">
          {students.map((s) => {
            const st = byStudent.get(s.id);
            const isHere = st === "present" || st === "tardy";

            return (
              <span
                key={s.id}
                className={`inline-flex items-center gap-2.5 rounded-xl px-5 py-2.5 text-xl font-semibold transition-colors ${
                  isHere
                    ? "bg-[#142b4d] text-white"
                    : "bg-white text-slate-500 ring-1 ring-slate-200/80"
                }`}
              >
                {st && st !== "present" && (
                  <span className={`size-2.5 shrink-0 rounded-full ${STATUS_DOT[st]}`} />
                )}
                {displayName(s.name)}
              </span>
            );
          })}
        </div>
      </main>
    </div>
  );
}
