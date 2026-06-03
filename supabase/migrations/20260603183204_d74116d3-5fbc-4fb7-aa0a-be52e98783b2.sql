-- Add 'progettazione' to enums and migrate existing 'grafica' rows
ALTER TYPE public.prod_dept ADD VALUE IF NOT EXISTS 'progettazione';
ALTER TYPE public.app_settore ADD VALUE IF NOT EXISTS 'progettazione';
ALTER TYPE public.commessa_reparto ADD VALUE IF NOT EXISTS 'progettazione';
ALTER TYPE public.commessa_reparto ADD VALUE IF NOT EXISTS 'vendite';
ALTER TYPE public.commessa_reparto ADD VALUE IF NOT EXISTS 'lavorazione';
ALTER TYPE public.prod_dept ADD VALUE IF NOT EXISTS 'lavorazione';