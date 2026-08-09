-- UI-Sprache je Nutzer (nicht je Rolle) - Nutzer-Vorgabe 2026-08-08.
-- Betrifft NUR die Bedienoberfläche, keine Dokumente/Formulare. Nutzt die
-- bereits bestehende "profiles_update_self"-Policy (id = auth.uid()) -
-- keine neue RLS-Policy nötig, jeder Nutzer darf sein eigenes Profil
-- bereits ändern.

alter table profiles
  add column sprache text not null default 'de' check (sprache in ('de', 'hr'));
