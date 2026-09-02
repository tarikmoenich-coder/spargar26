-- ============================================================================
-- Migration 2026-09-22: Sperre für das Wochenraster im Controlling
--   ("Arbeitstage am Stück" -> Bearbeiten)
--
-- Das aufklappbare Mo-So-Wochenraster wird auf Batch-Bearbeitung umgestellt
-- (erst "Alles speichern" schreibt). Solange eine Person ausgeklappt ist,
-- darf sie kein zweiter Nutzer im selben Tool bearbeiten - dafür diese
-- Beratungssperre (advisory lock) mit Heartbeat + 3-Minuten-Ablauf für
-- verwaiste Sperren ("Tab einfach zugemacht").
--
-- In der Supabase SQL-Konsole ausführen. Idempotent.
-- ============================================================================

create table if not exists arbeitstage_bearbeitung_lock (
  employee_id     uuid primary key references employees (id) on delete cascade,
  gesperrt_von    uuid not null references profiles (id) default auth.uid(),
  gesperrt_am     timestamptz not null default now(),
  zuletzt_gesehen timestamptz not null default now()
);

alter table arbeitstage_bearbeitung_lock enable row level security;

drop policy if exists "arbeitstage_lock_select" on arbeitstage_bearbeitung_lock;
create policy "arbeitstage_lock_select" on arbeitstage_bearbeitung_lock
  for select using (auth.uid() is not null);

drop policy if exists "arbeitstage_lock_write" on arbeitstage_bearbeitung_lock;
create policy "arbeitstage_lock_write" on arbeitstage_bearbeitung_lock
  for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

grant select, insert, update, delete on arbeitstage_bearbeitung_lock to authenticated;

-- Atomar erwerben: räumt verwaiste Sperren (> 3 Min ohne Heartbeat) und
-- meldet, ob die Sperre jetzt uns gehört - sonst wer sie hält.
create or replace function arbeitstage_lock_erwerben(p_employee_id uuid)
returns table (ok boolean, halter text, seit timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row arbeitstage_bearbeitung_lock%rowtype;
begin
  delete from arbeitstage_bearbeitung_lock
   where zuletzt_gesehen < now() - interval '3 minutes';

  select * into v_row
    from arbeitstage_bearbeitung_lock
   where employee_id = p_employee_id
   for update;

  if found and v_row.gesperrt_von <> auth.uid() then
    return query
      select false,
             (select full_name from profiles where id = v_row.gesperrt_von),
             v_row.gesperrt_am;
    return;
  end if;

  insert into arbeitstage_bearbeitung_lock (employee_id, gesperrt_von)
  values (p_employee_id, auth.uid())
  on conflict (employee_id) do update set zuletzt_gesehen = now();

  return query select true, null::text, now();
end;
$$;

grant execute on function arbeitstage_lock_erwerben(uuid) to authenticated;
