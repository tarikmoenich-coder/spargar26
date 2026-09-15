-- Firmenhandy-Nummernpool (Nutzer-Vorgabe 2026-09-17): ~200 Rufnummern,
-- deren Nutzer sich in der Saison mehrmals ändern kann. Wird per CardDAV
-- automatisch in ein selbst gehostetes Nextcloud-Adressbuch gespiegelt
-- (siehe app/api/firmenhandy-sync), damit die ~50 Smartphones der
-- Mitarbeiter (per DAVx5) immer den aktuellen Namen zur Nummer zeigen -
-- bewusst NICHT über Google, siehe Absprache im Chat.
--
-- Schlank gehalten ("Minimum: Nummer + aktueller Inhaber", keine Historie,
-- keine Geräte-/SIM-Details - kann später erweitert werden).

create table if not exists firmenhandy (
  id bigint generated always as identity primary key,
  nummer text not null unique,
  employee_id uuid references employees (id) on delete set null,
  notiz text,
  aktiv boolean not null default true,
  -- Sync-Status Richtung Nextcloud-Adressbuch (Spargar -> Nextcloud, nur
  -- diese eine Richtung, siehe Absprache).
  sync_status text check (sync_status in ('ok', 'fehler', 'ausstehend')) default 'ausstehend',
  sync_am timestamptz,
  sync_fehler text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_firmenhandy_employee on firmenhandy (employee_id);

create trigger trg_firmenhandy_updated_at before update on firmenhandy
  for each row execute function set_updated_at();

alter table firmenhandy enable row level security;

create policy "firmenhandy_select" on firmenhandy for select
  using (current_role_name() in ('admin', 'hr', 'management'));
create policy "firmenhandy_write" on firmenhandy for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

grant select, insert, update, delete on firmenhandy to authenticated;
