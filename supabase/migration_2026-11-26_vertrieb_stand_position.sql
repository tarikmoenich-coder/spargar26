-- ============================================================================
-- Vertrieb: Standposition und Radius auf der Karte (/vertrieb/karte)
-- Nutzer 2026-11-26: nur Admin und Management setzen Position/Radius von
-- Hand (HR braucht das nicht). Management hat sonst keine Schreibrechte im
-- Vertrieb (vt_darf(true) = admin/hr) - deshalb eine eng begrenzte Funktion,
-- die NUR lat/lng/radius_m eines Stands ändert.
--
-- Eine einzelne Anweisung, wiederholbar.
-- ============================================================================

create or replace function public.vt_stand_position_setzen(
  p_stand_id bigint,
  p_lat double precision,
  p_lng double precision,
  p_radius_m int
)
returns void language plpgsql security definer
set search_path = public
as $$
begin
  if not ('VT' = any (current_bereiche())
          and hat_rolle(array['admin', 'management']::user_role[])) then
    raise exception 'Keine Berechtigung: Standposition setzen dürfen nur Admin und Management (Bereich Vertrieb).'
      using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Ungültige Position.';
  end if;
  update vt_stand
     set lat = round(p_lat::numeric, 6),
         lng = round(p_lng::numeric, 6),
         radius_m = p_radius_m
   where id = p_stand_id;
  if not found then
    raise exception 'Stand % nicht gefunden.', p_stand_id;
  end if;
end;
$$;
revoke all on function public.vt_stand_position_setzen(bigint, double precision, double precision, int) from public, anon;
grant execute on function public.vt_stand_position_setzen(bigint, double precision, double precision, int) to authenticated, service_role;
