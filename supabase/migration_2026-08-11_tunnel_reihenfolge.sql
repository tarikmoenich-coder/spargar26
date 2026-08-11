-- Migration 2026-08-11: Tunnel frei sortierbar
--
-- Nutzer-Vorgabe: "Bei der Anbauplanung waere es schon hilfreich, wenn ich
-- die Tunnel einfach 'nehmen' und nach oben oder unten ziehen koennte,
-- damit praktisch die Anordnung auf dem Feld auch die Anordnung in der
-- Liste widerspiegelt. Die Reihenfolge in der Excel stimmt ja ueberhaupt
-- nicht, da die Tunnel nur nach ihrer Gemeinsamkeit: Der Laenge gruppiert
-- sind."
--
-- Neue Spalte position; sortiert wird ab jetzt danach statt nach der
-- Tunnelnummer. Bestehende Tunnel werden nach ihrer bisherigen
-- Sortierung (Nummer, natuerlich sortiert) initialisiert, damit sich
-- optisch zunaechst nichts aendert.
--
-- In der Supabase SQL-Konsole ausfuehren.

alter table erdbeeren_tunnel add column if not exists position int;

-- Bestehende Tunnel je Feld durchnummerieren. "nummer" ist Text, deshalb
-- vor dem Sortieren in eine Zahl wandeln, wo das moeglich ist - sonst
-- stuende "10" vor "2".
with sortiert as (
  select
    id,
    row_number() over (
      partition by anbau_id
      order by
        case when nummer ~ '^[0-9]+$' then nummer::int else null end
          nulls last,
        nummer
    ) as pos
  from erdbeeren_tunnel
)
update erdbeeren_tunnel t
set position = s.pos
from sortiert s
where s.id = t.id and t.position is null;

-- Sammelanlage: neue Tunnel hinten anhaengen, damit eine bestehende
-- Sortierung erhalten bleibt.
create or replace function erdbeeren_tunnel_sammelanlage(
  p_anbau_id bigint,
  p_von int,
  p_bis int,
  p_laenge_m numeric,
  p_reihen_anzahl int,
  p_pflanzen_pro_lfm numeric
)
returns int language plpgsql security invoker as $$
declare
  i int;
  angelegt int := 0;
  naechste_position int;
begin
  select coalesce(max(position), 0) into naechste_position
  from erdbeeren_tunnel where anbau_id = p_anbau_id;

  for i in p_von..p_bis loop
    naechste_position := naechste_position + 1;
    insert into erdbeeren_tunnel (
      anbau_id, nummer, laenge_m, reihen_anzahl, pflanzen_pro_lfm, position
    )
    values (
      p_anbau_id, i::text, p_laenge_m, p_reihen_anzahl, p_pflanzen_pro_lfm,
      naechste_position
    )
    on conflict (anbau_id, nummer) do nothing;
    if found then angelegt := angelegt + 1; end if;
  end loop;
  return angelegt;
end;
$$;

grant execute on function erdbeeren_tunnel_sammelanlage(bigint, int, int, numeric, int, numeric) to authenticated;

-- Vorjahr-Uebernahme: Sortierung mit uebernehmen.
create or replace function erdbeeren_anbau_vorjahr_uebernehmen(
  p_saison_jahr int,
  p_quelle_jahr int
)
returns int language plpgsql security invoker as $$
declare
  v_alt record;
  v_neu_anbau_id bigint;
  v_alt_tunnel record;
  v_neu_tunnel_id bigint;
  uebernommen int := 0;
begin
  for v_alt in
    select * from erdbeeren_anbau where saison_jahr = p_quelle_jahr
  loop
    -- Feld schon fürs Zieljahr geplant? Dann unangetastet lassen.
    if exists (
      select 1 from erdbeeren_anbau
      where parzelle_id = v_alt.parzelle_id and saison_jahr = p_saison_jahr
    ) then
      continue;
    end if;

    insert into erdbeeren_anbau (parzelle_id, saison_jahr, notiz)
    values (v_alt.parzelle_id, p_saison_jahr, v_alt.notiz)
    returning id into v_neu_anbau_id;

    for v_alt_tunnel in
      select * from erdbeeren_tunnel where anbau_id = v_alt.id
    loop
      insert into erdbeeren_tunnel (
        anbau_id, nummer, laenge_m, reihen_anzahl, pflanzen_pro_lfm,
        cotura_nr, notiz, position
      )
      values (
        v_neu_anbau_id, v_alt_tunnel.nummer, v_alt_tunnel.laenge_m,
        v_alt_tunnel.reihen_anzahl, v_alt_tunnel.pflanzen_pro_lfm,
        v_alt_tunnel.cotura_nr, v_alt_tunnel.notiz, v_alt_tunnel.position
      )
      returning id into v_neu_tunnel_id;

      -- Bepflanzung mitnehmen, aber OHNE Pflanzdatum und mit erhöhtem
      -- Standjahr: die Fläche steht ein Jahr länger, neu gepflanzt wird
      -- erst durch eine bewusste Eingabe.
      insert into erdbeeren_bepflanzung (
        tunnel_id, sorte, reihen_anzahl, standjahr, pflanztyp
      )
      select
        v_neu_tunnel_id, b.sorte, b.reihen_anzahl,
        case when b.standjahr is not null then b.standjahr + 1 end,
        b.pflanztyp
      from erdbeeren_bepflanzung b
      where b.tunnel_id = v_alt_tunnel.id;
    end loop;

    uebernommen := uebernommen + 1;
  end loop;
  return uebernommen;
end;
$$;

grant execute on function erdbeeren_anbau_vorjahr_uebernehmen(int, int) to authenticated;
