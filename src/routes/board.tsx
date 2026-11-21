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

const STATUS_STYLE: Record<string, string> = {
  present: "bg-[#1f7a52] text-white",
  tardy: "bg-[#c9a227] text-[#0f1c30]",
  excused: "bg-[#3b5fa8] text-white",
  absent: "bg-[#5a2b36] text-[#f0b6c0]",
};
const NOT_YET_STYLE = "border border-[#2c4770] text-[#8aa0bd]";

const LEGEND = [
  { label: "Present", dot: "bg-[#1f7a52]" },
  { label: "Tardy", dot: "bg-[#c9a227]" },
  { label: "Excused", dot: "bg-[#3b5fa8]" },
  { label: "Absent", dot: "bg-[#5a2b36]" },
  { label: "Not yet here", dot: "border border-[#8aa0bd]" },
];

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

function gradeSortKey(label: string): number {
  const s = label.trim().toLowerCase();
  if (!s) return 9999;
  if (s.startsWith("pre-k") || s === "pk" || s.startsWith("pre k")) return -2;
  if (s === "k" || s.startsWith("kinder")) return -1;
  const match = s.match(/\d+/);
  if (match) return Number(match[0]);
  return 500;
}

function gradeLabel(group: string) {
  return /^\d+$/.test(group) ? `Grade ${group}` : group;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-right">
      <div className="text-4xl font-semibold tabular-nums">
        {now.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })}
      </div>
      <div className="text-lg text-[#9fb0c8]">
        {now.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" })}
      </div>
    </div>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f1c30] p-8 text-white">
      {children}
    </div>
  );
}

function Stat({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="rounded-xl bg-[#16273f] p-4">
      <div className="flex items-center gap-2 text-base text-[#9fb0c8]">
        <span className={`inline-block size-3 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="mt-1 text-4xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function BoardPage() {
  const { session, loading } = useAuth();
  const rosterFn = useServerFn(getRoster);
  const today = chicagoToday();

  // The roster comes from Google Sheets, so it refreshes slowly (every 5 min).
  const rosterQuery = useQuery({
    queryKey: ["board-roster"],
    enabled: !!session,
    queryFn: () => rosterFn({}),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  // Attendance comes straight from Supabase, so it refreshes every 5 seconds.
  const attendanceQuery = useQuery({
    queryKey: ["board-attendance", today],
    enabled: !!session,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("student_id, student_name, status, scanned_at")
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

  const grades = useMemo(() => {
    const map = new Map<string, typeof students>();
    for (const s of students) {
      const key = s.group?.trim() || "Ungrouped";
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([group, list]) => ({
        group,
        students: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => gradeSortKey(a.group) - gradeSortKey(b.group) || a.group.localeCompare(b.group));
  }, [students]);

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

  const recent = records
    .filter((r) => r.status === "present" || r.status === "tardy")
    .sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime())
    .slice(0, 10);

  const unauthorized =
    rosterQuery.isError &&
    rosterQuery.error instanceof Error &&
    rosterQuery.error.message.includes("Unauthorized");
  const hasProblem = !!rosterQuery.data?.error || rosterQuery.isError || attendanceQuery.isError;

  if (loading) {
    return (
      <Screen>
        <p className="text-2xl text-[#9fb0c8]">Loading…</p>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <div className="max-w-md text-center">
          <h1 className="text-3xl font-bold">Sign in required</h1>
          <p className="mt-3 text-lg text-[#9fb0c8]">
            Sign in on the main page with an approved account, then come back to this page.
          </p>
          <Link
            to="/"
            className="mt-6 inline-block rounded-lg bg-[#c9a227] px-6 py-3 font-semibold text-[#0f1c30]"
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
        <div className="max-w-md text-center">
          <h1 className="text-3xl font-bold">Access restricted</h1>
          <p className="mt-3 text-lg text-[#9fb0c8]">
            {session.user.email} does not have access to this app.
          </p>
        </div>
      </Screen>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1c30] p-8 text-white">
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-4xl font-bold">Who&apos;s here</h1>
          <p className="mt-1 text-lg text-[#9fb0c8]">Chicago Downtown REC</p>
          {hasProblem && <p className="mt-2 text-base text-[#e7c35a]">Connection problem. Retrying…</p>}
        </div>
        <Clock />
      </header>

      <div className="grid gap-8 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-8">
          <section className="rounded-2xl bg-[#1e3558] p-8">
            <div className="flex items-end justify-between gap-6">
              <div>
                <div className="text-lg uppercase tracking-wide text-[#9fb0c8]">Checked in</div>
                <div className="text-8xl font-bold tabular-nums">
                  {checkedIn}
                  <span className="text-5xl text-[#9fb0c8]"> / {total}</span>
                </div>
              </div>
              <div className="text-6xl font-bold tabular-nums text-[#c9a227]">{pct}%</div>
            </div>
            <div className="mt-6 h-4 overflow-hidden rounded-full bg-[#0f1c30]">
              <div className="h-full rounded-full bg-[#c9a227]" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-5">
              <Stat label="Present" value={present} dot="bg-[#1f7a52]" />
              <Stat label="Tardy" value={tardy} dot="bg-[#c9a227]" />
              <Stat label="Excused" value={excused} dot="bg-[#3b5fa8]" />
              <Stat label="Absent" value={absent} dot="bg-[#5a2b36]" />
              <Stat label="Not yet here" value={notYet} dot="border border-[#8aa0bd]" />
            </div>
          </section>

          <section className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
            {grades.map(({ group, students: list }) => {
              const here = list.filter((s) => {
                const st = byStudent.get(s.id);
                return st === "present" || st === "tardy";
              }).length;
              return (
                <div key={group} className="rounded-2xl border border-[#2c4770] bg-[#16273f] p-5">
                  <div className="mb-4 flex items-baseline justify-between">
                    <h2 className="text-2xl font-semibold">{gradeLabel(group)}</h2>
                    <span className="text-2xl font-semibold tabular-nums text-[#c9a227]">
                      {here}
                      <span className="text-[#9fb0c8]"> / {list.length}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {list.map((s) => {
                      const st = byStudent.get(s.id);
                      const style = st ? (STATUS_STYLE[st] ?? NOT_YET_STYLE) : NOT_YET_STYLE;
                      return (
                        <span key={s.id} className={`rounded-full px-3 py-1 text-base font-medium ${style}`}>
                          {displayName(s.name)}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        </div>

        <aside className="h-fit rounded-2xl border border-[#2c4770] bg-[#16273f] p-6">
          <h2 className="mb-4 text-2xl font-semibold">Just arrived</h2>
          {recent.length === 0 ? (
            <p className="text-lg text-[#9fb0c8]">No one has checked in yet.</p>
          ) : (
            <ul className="space-y-3">
              {recent.map((r) => (
                <li
                  key={r.student_id}
                  className="flex items-center justify-between gap-3 border-b border-[#2c4770] pb-3 last:border-0"
                >
                  <div>
                    <div className="text-xl font-medium">{displayName(r.student_name)}</div>
                    <div className="text-sm capitalize text-[#9fb0c8]">{r.status}</div>
                  </div>
                  <div className="text-lg tabular-nums text-[#9fb0c8]">
                    {new Date(r.scanned_at).toLocaleTimeString("en-US", {
                      timeZone: TZ,
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <footer className="mt-8 flex flex-wrap gap-6 text-sm text-[#9fb0c8]">
        {LEGEND.map((item) => (
          <span key={item.label} className="flex items-center gap-2">
            <span className={`inline-block size-3 rounded-full ${item.dot}`} />
            {item.label}
          </span>
        ))}
      </footer>
    </div>
  );
}
