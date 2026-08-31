-- ============================================================================
-- Migration 2026-09-08: Raumtyp-spezifischer Kontrollzeitraum
--
-- Bisher steckten die Ampel-Schwellen (grün/gelb/rot) für die letzte
-- Zimmerkontrolle fix im Code (lib/unterkunft.ts, 75/90 Tage). Jetzt je
-- Raumtyp konfigurierbar über die Tabelle unterkunft_kontroll_intervall,
-- gepflegt in den Stammdaten (admin/hr).
--
--   gruen_bis_tage : letzte Kontrolle ≤ X Tage her  → grün
--   gelb_bis_tage  : letzte Kontrolle ≤ Y Tage her  → gelb, darüber → rot
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

create table if not exists unterkunft_kontroll_intervall (
  art text primary key
    check (art in ('zimmer', 'kueche', 'bad', 'flur', 'gemeinschaft')),
  gruen_bis_tage int not null,
  gelb_bis_tage int not null,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  check (gelb_bis_tage >= gruen_bis_tage)
);

-- Startwerte: 7 / 21 Tage für alle Raumtypen (in den Stammdaten anpassbar).
insert into unterkunft_kontroll_intervall (art, gruen_bis_tage, gelb_bis_tage) values
  ('zimmer', 7, 21),
  ('kueche', 7, 21),
  ('bad', 7, 21),
  ('flur', 7, 21),
  ('gemeinschaft', 7, 21)
on conflict (art) do nothing;

drop trigger if exists trg_unterkunft_kontroll_intervall_updated_at
  on unterkunft_kontroll_intervall;
create trigger trg_unterkunft_kontroll_intervall_updated_at
  before update on unterkunft_kontroll_intervall
  for each row execute function set_updated_at();

alter table unterkunft_kontroll_intervall enable row level security;

drop policy if exists "unterkunft_kontroll_intervall_select"
  on unterkunft_kontroll_intervall;
create policy "unterkunft_kontroll_intervall_select"
  on unterkunft_kontroll_intervall for select
  using (auth.uid() is not null);

drop policy if exists "unterkunft_kontroll_intervall_write"
  on unterkunft_kontroll_intervall;
create policy "unterkunft_kontroll_intervall_write"
  on unterkunft_kontroll_intervall for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
