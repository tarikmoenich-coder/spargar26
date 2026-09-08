-- Prämien Zuckermais stornieren (Nutzer-Vorgabe 2026-09-08): bei
-- Qualitätsreklamationen soll die Tagesprämie einzelner Personen oder eines
-- ganzen Tages mit Begründung storniert werden können ("die Leute
-- disziplinieren"). Die Rohdaten (Kisten/Stunden) bleiben erhalten - sie
-- werden weiter für Statistik/Kolben-Schnitt/Kulturkosten gebraucht -, nur
-- die ausgezahlte Tagesprämie fällt auf 0. Der Grund erscheint in der Suche
-- (Mitarbeiter-Auskunft) und im dortigen Ausdruck.
--
-- Re-runnable: add column if not exists / drop constraint if exists /
-- create or replace view.

alter table zuckermais_rohdaten
  add column if not exists praemie_storniert boolean not null default false,
  add column if not exists storno_grund text,
  add column if not exists storno_am timestamptz,
  add column if not exists storno_von uuid references profiles (id);

alter table zuckermais_rohdaten
  drop constraint if exists zuckermais_rohdaten_storno_grund_check;
alter table zuckermais_rohdaten
  add constraint zuckermais_rohdaten_storno_grund_check
  check (
    not praemie_storniert
    or (storno_grund is not null and length(btrim(storno_grund)) > 0)
  );

-- praemie = 0 sobald storniert. Storno-Infos zusätzlich mit ausgeben; ans
-- Ende angehängt, weil "create or replace view" das Verschieben bestehender
-- Spaltenpositionen verbietet (42P16).
create or replace view zuckermais_praemie_tag as
select
  r.id,
  r.employee_id,
  r.datum,
  r.kisten,
  r.stunden,
  s.norm_kolben_pro_stunde,
  s.kolben_pro_kiste,
  s.satz_pro_kolben,
  r.kisten * s.kolben_pro_kiste as kolben,
  case
    when r.praemie_storniert then 0::numeric
    else greatest(
      (r.kisten * s.kolben_pro_kiste - r.stunden * coalesce(s.norm_kolben_pro_stunde, 0))
        * coalesce(s.satz_pro_kolben, 0),
      0
    )
  end as praemie,
  -- Negativprämie (Kosten-Kennzahl "Wer kostet am meisten?") bleibt vom
  -- Storno unberührt - der Arbeitseinsatz hat trotzdem Geld gekostet.
  greatest(
    (r.stunden * coalesce(s.norm_kolben_pro_stunde, 0) - r.kisten * s.kolben_pro_kiste)
      * coalesce(s.satz_pro_kolben, 0),
    0
  ) as negativpraemie,
  r.praemie_storniert,
  r.storno_grund,
  r.storno_am
from zuckermais_rohdaten r
left join lateral (
  select z.norm_kolben_pro_stunde, z.kolben_pro_kiste, z.satz_pro_kolben
  from zuckermais_saetze z
  where z.gueltig_ab <= r.datum
  order by z.gueltig_ab desc
  limit 1
) s on true;

alter view zuckermais_praemie_tag set (security_invoker = true);
grant select on zuckermais_praemie_tag to authenticated;
