-- ============================================================================
-- Migration 2026-11-26e: Verbesserungsvorschläge ("Glühbirne" auf jeder Seite)
--
-- Nutzer 2026-11-26: Auf jeder Seite ein Knopf "Änderung vorschlagen". Wer
-- eingeloggt ist, schreibt hinein, was er gerne geändert hätte - Seite
-- (automatisch), Text, optional ein Bildschirmfoto mit Markierungen, wer und
-- wann. Sichtbar NUR für Admin (Seite /vorschlaege), der sie abarbeitet.
--
-- Rechte: eintragen jeder aktive Nutzer (nur als er selbst), lesen/ändern/
-- löschen nur admin. Ohne Login nichts.
-- Jede Anweisung einzeln wiederholbar.
-- ============================================================================

create table if not exists public.verbesserungsvorschlag (
  id bigint generated always as identity primary key,
  erstellt_am timestamptz not null default now(),
  erstellt_von uuid not null default auth.uid() references public.profiles (id) on delete set null,
  seite text not null,            -- Pfad inkl. Parameter, z.B. /vertrieb/grundplan?tour=3
  seite_titel text,               -- Überschrift der Seite zum leichteren Lesen
  text text not null check (length(trim(text)) > 0),
  screenshot text,                -- verkleinertes JPEG als data-URL, mit Markierungen
  status text not null default 'offen' check (status in ('offen', 'in_arbeit', 'erledigt', 'abgelehnt')),
  admin_notiz text,
  erledigt_am timestamptz
);
create index if not exists idx_verbesserungsvorschlag_status on public.verbesserungsvorschlag (status, erstellt_am desc);

alter table public.verbesserungsvorschlag enable row level security;

drop policy if exists "vorschlag_eintragen" on public.verbesserungsvorschlag;
create policy "vorschlag_eintragen" on public.verbesserungsvorschlag for insert to authenticated
  with check (
    erstellt_von = auth.uid()
    and cardinality((select public.current_rollen())) > 0
  );
drop policy if exists "vorschlag_admin_lesen" on public.verbesserungsvorschlag;
create policy "vorschlag_admin_lesen" on public.verbesserungsvorschlag for select to authenticated
  using ((select public.is_admin()));
drop policy if exists "vorschlag_admin_aendern" on public.verbesserungsvorschlag;
create policy "vorschlag_admin_aendern" on public.verbesserungsvorschlag for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
drop policy if exists "vorschlag_admin_loeschen" on public.verbesserungsvorschlag;
create policy "vorschlag_admin_loeschen" on public.verbesserungsvorschlag for delete to authenticated
  using ((select public.is_admin()));

revoke all on public.verbesserungsvorschlag from anon;
grant select, insert, update, delete on public.verbesserungsvorschlag to authenticated;
