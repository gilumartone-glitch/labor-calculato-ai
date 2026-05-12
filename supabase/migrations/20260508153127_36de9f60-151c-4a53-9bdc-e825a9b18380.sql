ALTER TYPE public.app_settore ADD VALUE IF NOT EXISTS 'magazzino';
ALTER TYPE public.prod_dept ADD VALUE IF NOT EXISTS 'magazzino';
ALTER TYPE public.prod_delivery ADD VALUE IF NOT EXISTS 'mezzo_proprio';
ALTER TYPE public.prod_delivery ADD VALUE IF NOT EXISTS 'corriere';
ALTER TYPE public.prod_notif_type ADD VALUE IF NOT EXISTS 'magazzino_da_preparare';