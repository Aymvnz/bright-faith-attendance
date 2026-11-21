import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { getRoster } from "@/lib/roster.functions";

export const Route = createFileRoute("/board")({
  head: () => ({
    meta: [{ title: "Check-in board" }],
  }),
  component: BoardPage,
});

const TZ = "America/Chicago";

const STATUS_DOT: Record<string, string> = {
  present: "bg-emerald-500",
  tardy: "bg-amber-500",
  excused: "bg-sky-500",
  absent: "bg-rose-500",
};

function chicagoToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function MetricCard({
  label,
  value,
  dot,
}: {
  label: string;
  value: number;
  dot: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-7 shadow-xs">
      <div className="flex items-center gap-3">
        <span className={`size-3.5 shrink-0 rounded-full ${dot}`} />
        <span className="text-base font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </div>
      <div className="mt-4 text-6xl font-bold tabular-nums tracking-tight text-[#142b4d]">
        {value}
      </div>
    </div>
  );
}

function BoardPage() {
  const rosterFn = useServerFn(getRoster);
  const today = chicagoToday();

  const rosterQuery = useQuery({
    queryKey: ["board-roster"],
    queryFn: () => rosterFn({}),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  const attendanceQuery = useQuery({
    queryKey: ["board-attendance", today],
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

  const students = useMemo(() => rosterQuery.data?.students ?? [], [rosterQuery.data]);
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

  const hasProblem = !!rosterQuery.data?.error || rosterQuery.isError || attendanceQuery.isError;

  return (
    <div className="flex min-h-screen flex-col bg-[#f1f5f9] text-[#142b4d]">
      {/* Top Bar */}
      <header className="bg-[#142b4d] px-12 py-6 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <img
              src="/itreb-logo-white.png"
              alt="Ismaili Tariqah and Religious Education Board USA"
              className="h-12 w-auto shrink-0 object-contain"
            />
            <div className="h-9 w-px bg-white/20" />
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-bold tracking-tight">Chicago Downtown REC</h1>
              <span className="text-lg font-normal text-slate-300">Attendance</span>
            </div>
            {hasProblem && (
              <span className="rounded-full bg-white/15 px-4 py-1 text-base font-medium text-amber-300">
                Reconnecting…
              </span>
            )}
          </div>
          <Clock />
        </div>
      </header>

      {/* Hero Numbers Dashboard */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center gap-8 px-12 py-10">
        {/* Primary Hero Counter */}
        <section className="rounded-3xl bg-[#142b4d] px-10 py-12 text-white shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <div>
              <div className="text-base font-semibold uppercase tracking-widest text-slate-300">
                Checked In
              </div>
              <div className="mt-2 flex items-baseline gap-4">
                <span className="text-[7.5rem] font-bold leading-none tabular-nums tracking-tight">
                  {checkedIn}
                </span>
                <span className="text-5xl font-medium tabular-nums text-slate-300">
                  / {total}
                </span>
              </div>
            </div>

            <div className="text-7xl font-bold tabular-nums text-sky-300">{pct}%</div>
          </div>

          <div className="mt-8 h-4 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-sky-300 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </section>

        {/* Breakdown Number Cards */}
        <section className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard label="Present" value={present} dot={STATUS_DOT.present} />
          <MetricCard label="Tardy" value={tardy} dot={STATUS_DOT.tardy} />
          <MetricCard label="Excused" value={excused} dot={STATUS_DOT.excused} />
          <MetricCard label="Absent" value={absent} dot={STATUS_DOT.absent} />
          <MetricCard label="Not here" value={notYet} dot="border-2 border-slate-400" />
        </section>
      </main>
    </div>
  );
}
