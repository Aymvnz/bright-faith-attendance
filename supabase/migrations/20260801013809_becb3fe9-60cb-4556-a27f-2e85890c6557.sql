CREATE TABLE public.program_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  spreadsheet_id text,
  sheet_range text NOT NULL DEFAULT 'Sheet1!A1:D500',
  tardy_after time NOT NULL DEFAULT '10:30',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_settings TO authenticated;
GRANT ALL ON public.program_settings TO service_role;
ALTER TABLE public.program_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_read" ON public.program_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_write" ON public.program_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
INSERT INTO public.program_settings (singleton) VALUES (true);

CREATE TABLE public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL,
  student_name text NOT NULL,
  session_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  status text NOT NULL DEFAULT 'present',
  scanned_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid,
  UNIQUE (student_id, session_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO authenticated;
GRANT ALL ON public.attendance_records TO service_role;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_read" ON public.attendance_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "attendance_write" ON public.attendance_records FOR ALL TO authenticated USING (true) WITH CHECK (true);