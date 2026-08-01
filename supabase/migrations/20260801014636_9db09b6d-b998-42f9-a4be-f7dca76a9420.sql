UPDATE public.program_settings
SET spreadsheet_id = '1b5HVLOYoB08nVZd2yCRbLSYQ4wtLx4tDxB9FvVghkcI',
    sheet_range = 'Primary Parental Contact Info !A1:J500',
    updated_at = now()
WHERE singleton = true;