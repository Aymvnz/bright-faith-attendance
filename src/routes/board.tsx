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
  present: "bg-[#2ea36f]",
  tardy: "bg-[#d4af37]",
  excused: "bg-[#4f78c7]",
  absent: "bg-[#b84a5b]",
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
    <div className="flex items-baseline gap-4 text-right">
      <span className="text-lg text-[#7d92b0]">
        {now.toLocaleDateString("en-US", {
          timeZone: TZ,
          weekday: "short",
          month: "short",
          day: "numeric",
        })}
      </span>
      <span className="text-3xl font-semibold tabular-nums tracking-tight text-white">
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
    <div className="flex min-h-screen items-center justify-center bg-[#0b1526] p-8 text-white">
      {children}
    </div>
  );
}

function Stat({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`size-2.5 rounded-full ${dot}`} />
      <span className="text-sm uppercase tracking-wider text-[#7d92b0]">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-white">{value}</span>
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

  const unauthorized =
    rosterQuery.isError &&
    rosterQuery.error instanceof Error &&
    rosterQuery.error.message.includes("Unauthorized");
  const hasProblem = !!rosterQuery.data?.error || rosterQuery.isError || attendanceQuery.isError;

  if (loading) {
    return (
      <Screen>
        <p className="text-xl text-[#7d92b0]">Loading…</p>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <div className="max-w-md text-center">
          <h1 className="text-3xl font-bold">Sign in required</h1>
          <p className="mt-3 text-lg text-[#7d92b0]">
            Sign in on the main page with an approved account, then come back to this page.
          </p>
          <Link
            to="/"
            className="mt-6 inline-block rounded-lg bg-[#d4af37] px-6 py-3 font-semibold text-[#0b1526]"
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
          <p className="mt-3 text-lg text-[#7d92b0]">
            {session.user.email} does not have access to this app.
          </p>
        </div>
      </Screen>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b1526] px-10 py-8 text-white">
      {/* Minimal Top Bar */}
      <header className="mb-10 flex items-baseline justify-between border-b border-white/10 pb-5">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Chicago Downtown REC</h1>
          <span className="text-base text-[#7d92b0]">Check-in Board</span>
          {hasProblem && (
            <span className="rounded-full bg-[#d4af37]/15 px-3 py-0.5 text-sm text-[#e7c35a]">
              Reconnecting…
            </span>
          )}
        </div>
        <Clock />
      </header>

      <div className="space-y-10">
        {/* Clean Hero Summary Strip (Doubles as the Legend) */}
        <section className="rounded-2xl bg-[#122038] p-7">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="text-sm font-medium uppercase tracking-widest text-[#7d92b0]">
                Checked In
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-6xl font-bold tabular-nums tracking-tight">{checkedIn}</span>
                <span className="text-3xl font-normal tabular-nums text-[#7d92b0]">/ {total}</span>
              </div>
            </div>

            <div className="text-5xl font-bold tabular-nums text-[#d4af37]">{pct}%</div>
          </div>

          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#d4af37] transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-white/10 pt-5">
            <Stat label="Present" value={present} dot={STATUS_DOT.present} />
            <Stat label="Tardy" value={tardy} dot={STATUS_DOT.tardy} />
            <Stat label="Excused" value={excused} dot={STATUS_DOT.excused} />
            <Stat label="Absent" value={absent} dot={STATUS_DOT.absent} />
            <Stat label="Not here" value={notYet} dot="border border-[#7d92b0]" />
          </div>
        </section>

        {/* Borderless Grade Sections */}
        <section className="grid gap-x-10 gap-y-9 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {grades.map(({ group, students: list }) => {
            const here = list.filter((s) => {
              const st = byStudent.get(s.id);
              return st === "present" || st === "tardy";
            }).length;

            return (
              <div key={group}>
                <div className="mb-3.5 flex items-baseline justify-between border-b border-white/10 pb-2">
                  <h2 className="text-lg font-semibold text-white">{gradeLabel(group)}</h2>
                  <span className="text-base font-medium tabular-nums text-[#7d92b0]">
                    <span className="text-white">{here}</span> / {list.length}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {list.map((s) => {
                    const st = byStudent.get(s.id);
                    const isHere = st === "present" || st === "tardy";
                    const dotColor = st ? STATUS_DOT[st] : null;

                    return (
                      <span
                        key={s.id}
                        className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                          isHere
                            ? "bg-[#1a2e4d] text-white"
                            : "bg-white/[0.03] text-[#6d82a1]"
                        }`}
                      >
                        {dotColor && <span className={`size-2 rounded-full ${dotColor}`} />}
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
    </div>
  );
}
