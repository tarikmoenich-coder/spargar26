-- ============================================================================
-- Vertrieb: Stand per Drag & Drop zwischen Touren verschieben (/vertrieb/touren)
-- Nutzer 2026-11-26. Quelle und Ziel werden in EINEM Aufruf (= einer
-- Transaktion) neu gesetzt, damit nie ein halber Zustand entsteht. Erst die
-- Tour, die den Stand abgibt, dann die, die ihn bekommt (Eindeutigkeit
-- Stand je Tagesart). Rechte wie vt_tour_staende_setzen (vt_darf(true)).
-- p_quelle_tour / p_ziel_tour dürfen null sein ("Ohne Tour").
--
-- Eine einzelne Anweisung, wiederholbar.
-- ============================================================================

create or replace function public.vt_touren_umbauen(
  p_quelle_tour bigint,
  p_quelle_staende bigint[],
  p_quelle_nur_ware boolean[],
  p_ziel_tour bigint,
  p_ziel_staende bigint[],
  p_ziel_nur_ware boolean[]
)
returns void language plpgsql
set search_path = public
as $$
begin
  if not vt_darf(true) then
    raise exception 'Keine Berechtigung für die Tourenplanung.';
  end if;
  if p_quelle_tour is not null and p_ziel_tour is not null
     and (select count(distinct tagesart) from vt_tour where id in (p_quelle_tour, p_ziel_tour)) > 1 then
    raise exception 'Stände nur zwischen Touren derselben Tagesart verschieben.';
  end if;
  if p_quelle_tour is not null then
    perform vt_tour_staende_setzen(p_quelle_tour, coalesce(p_quelle_staende, '{}'), coalesce(p_quelle_nur_ware, '{}'));
  end if;
  if p_ziel_tour is not null and p_ziel_tour is distinct from p_quelle_tour then
    perform vt_tour_staende_setzen(p_ziel_tour, coalesce(p_ziel_staende, '{}'), coalesce(p_ziel_nur_ware, '{}'));
  end if;
end;
$$;
revoke all on function public.vt_touren_umbauen(bigint, bigint[], boolean[], bigint, bigint[], boolean[]) from public, anon;
grant execute on function public.vt_touren_umbauen(bigint, bigint[], boolean[], bigint, bigint[], boolean[]) to authenticated;
