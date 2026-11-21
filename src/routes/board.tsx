import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getBoardStats } from "@/lib/roster.functions";
// 👇 Replace or adjust this import to match your existing scan server function!
// e.g., import { recordScan } from "@/lib/attendance.functions";

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

interface WelcomeBanner {
  name: string;
  status: string;
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
    <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
      <div className="flex items-center gap-3">
        <span className={`size-3.5 shrink-0 rounded-full ${dot}`} />
        <span className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </div>
      <div className="mt-3 text-5xl font-bold tabular-nums tracking-tight text-[#142b4d]">
        {value}
      </div>
    </div>
  );
}

function KioskScanner({
  onScan,
}: {
  onScan: (rawCode: string) => Promise<{ studentName: string; status?: string } | null>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const busyRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId = 0;
    let cancelled = false;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const Detector = (
          window as unknown as {
            BarcodeDetector?: new (opts?: { formats: string[] }) => {
              detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
            };
          }
        ).BarcodeDetector;

        if (!Detector) {
          setCameraError("Use your existing QR library here for Firefox");
          return;
        }

        const detector = new Detector({ formats: ["qr_code", "code_128", "code_39"] });

        const tick = async () => {
          if (cancelled) return;
          if (!busyRef.current && video.readyState >= 2) {
            try {
              const codes = await detector.detect(video);
              const raw = codes[0]?.rawValue?.trim();
              if (raw) {
                busyRef.current = true;
                try {
                  await onScan(raw);
                } finally {
                  busyRef.current = false;
                }
              }
            } catch {
              // ignore transient frame decode errors
            }
          }
          rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : "Camera unavailable");
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <div className="flex flex-col justify-between rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-widest text-slate-500">
          Scan Badge to Check In
        </span>
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700">
          <span className="size-2.5 animate-pulse rounded-full bg-emerald-500" />
          Camera Live
        </span>
      </div>

      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-[#142b4d]">
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-full w-full -scale-x-100 object-cover"
        />
        <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-white/40" />
        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#142b4d]/90 p-4 text-center text-sm text-white">
            {cameraError}
          </div>
        )}
      </div>
    </div>
  );
}

function BoardPage() {
  const queryClient = useQueryClient();
  const boardStatsFn = useServerFn(getBoardStats);
  // 👇 Wire up your existing scan server function here:
  // const scanFn = useServerFn(recordScan);

  const [welcome, setWelcome] = useState<WelcomeBanner | null>(null);
  const welcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const statsQuery = useQuery({
    queryKey: ["board-stats"],
    queryFn: () => boardStatsFn({}),
    refetchInterval: 5000,
  });

  const handleScan = useCallback(
    async (rawCode: string) => {
      // 🔌 CALL YOUR EXISTING SCAN FUNCTION HERE:
      // const res = await scanFn({ data: { code: rawCode } });
      // if (!res?.studentName) return null;

      // Placeholder until connected to your scan function:
      const res = { studentName: rawCode, status: "present" };

      setWelcome({ name: res.studentName, status: res.status ?? "present" });
      if (welcomeTimerRef.current) clearTimeout(welcomeTimerRef.current);
      welcomeTimerRef.current = setTimeout(() => setWelcome(null), 4000);

      queryClient.invalidateQueries({ queryKey: ["board-stats"] });
      return res;
    },
    [queryClient]
  );

  const stats = statsQuery.data ?? {
    present: 0,
    tardy: 0,
    excused: 0,
    absent: 0,
    notYet: 0,
    total: 0,
    checkedIn: 0,
    pct: 0,
  };

  const hasProblem = !!stats.error || statsQuery.isError;

  return (
    <div className="relative flex min-h-screen flex-col bg-[#f1f5f9] text-[#142b4d]">
      {/* Giant "Welcome, [NAME]" Overlay when someone scans */}
      {welcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#142b4d]/95 p-10 text-white backdrop-blur-xs">
          <div className="max-w-5xl text-center">
            <div className="inline-flex items-center gap-3 rounded-full bg-emerald-500/20 px-6 py-2 text-xl font-semibold uppercase tracking-widest text-emerald-300">
              <span className="size-3.5 rounded-full bg-emerald-400" />
              Checked In {welcome.status === "tardy" ? "• Tardy" : ""}
            </div>
            <h2 className="mt-8 text-8xl font-bold leading-tight tracking-tight text-white">
              Welcome, {welcome.name}
            </h2>
          </div>
        </div>
      )}

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

      {/* Main Content: Numbers + Always-On Camera */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center gap-8 px-12 py-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
          {/* Primary Hero Counter */}
          <section className="flex flex-col justify-between rounded-3xl bg-[#142b4d] px-10 py-10 text-white shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-8">
              <div>
                <div className="text-base font-semibold uppercase tracking-widest text-slate-300">
                  Checked In
                </div>
                <div className="mt-2 flex items-baseline gap-4">
                  <span className="text-[7rem] font-bold leading-none tabular-nums tracking-tight">
                    {stats.checkedIn}
                  </span>
                  <span className="text-5xl font-medium tabular-nums text-slate-300">
                    / {stats.total}
                  </span>
                </div>
              </div>

              <div className="text-7xl font-bold tabular-nums text-sky-300">{stats.pct}%</div>
            </div>

            <div className="mt-8 h-4 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-sky-300 transition-all duration-500"
                style={{ width: `${stats.pct}%` }}
              />
            </div>
          </section>

          {/* Always-On Camera Card */}
          <KioskScanner onScan={handleScan} />
        </div>

        {/* Breakdown Number Cards */}
        <section className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard label="Present" value={stats.present} dot={STATUS_DOT.present} />
          <MetricCard label="Tardy" value={stats.tardy} dot={STATUS_DOT.tardy} />
          <MetricCard label="Excused" value={stats.excused} dot={STATUS_DOT.excused} />
          <MetricCard label="Absent" value={stats.absent} dot={STATUS_DOT.absent} />
          <MetricCard label="Not here" value={stats.notYet} dot="border-2 border-slate-400" />
        </section>
      </main>
    </div>
  );
}
