# ernte-ingest

Supabase Edge Function. Nimmt die Scan-/Batterie-Ereignisse einer
Spargelspinne entgegen (Absender: `tools/ernte-scan-agent/agent.sh` auf dem
TRB246) und schreibt sie roh in `ernte_scan` — siehe
`docs/erntewirtschaft-plan.md`, Teil C.

**Der Waagen-Pfad ruft diese Funktion NICHT auf** — `tools/ernte-waage-agent/`
schreibt bewusst direkt mit dem Service-Key in `ernte_scan` (siehe dessen
`index.mjs`). Diese Funktion kennt deshalb nur das Maschinen-Payload-Format
(`{"box": "...", "events": [...]}`), nicht das Waagen-Format aus dem Plan.

## Vor dem ersten Deploy: Migration einspielen

`supabase/migration_2026-10-17_ernte_scan_idempotenz.sql` **muss zuerst** in
der Supabase SQL-Konsole laufen — die Funktion verlässt sich beim
`upsert(...)` auf den dort angelegten Unique-Index
(`idx_ernte_scan_idempotenz`), um doppelt zugestellte Wiederholungen (Retry
nach Netzausfall, siehe Warteschlange im Agenten) lautlos zu verwerfen statt
doppelt zu zählen.

## Deploy

```bash
# einmalig, falls noch nicht geschehen
supabase login
supabase link --project-ref cmlbugppwhytloxjkxmt

# Secret setzen (eigener, frei gewählter Token - NICHT der Service-Role-Key)
supabase secrets set ERNTE_INGEST_TOKEN=<langer-zufaelliger-token>

supabase functions deploy ernte-ingest --project-ref cmlbugppwhytloxjkxmt
```

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` müssen NICHT manuell gesetzt
werden — die stellt Supabase jeder Edge Function automatisch als
Umgebungsvariable zur Verfügung.

Danach `ERNTE_INGEST_TOKEN` (derselbe Wert) in
`/etc/ernte-scan-agent/agent.conf` auf dem TRB246 eintragen, zusammen mit
`INGEST_URL=https://cmlbugppwhytloxjkxmt.supabase.co/functions/v1/ernte-ingest`.

## Manuell testen

```bash
curl -i -X POST \
  https://cmlbugppwhytloxjkxmt.supabase.co/functions/v1/ernte-ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ERNTE_INGEST_TOKEN>" \
  -d '{"box":"TEST-BOX","events":[{"typ":"scan","code":"K-00001","ts":"2026-10-17T12:00:00Z"}]}'
```

Erwartete Antwort: `{"angenommen":1,"dubletten":0,"klassifizierung":[{"code":"K-00001","typ":"kiste"}]}`.
Denselben Befehl ein zweites Mal ausführen (identischer Payload) — jetzt
sollte `"angenommen":0,"dubletten":1` kommen (Idempotenz greift). Danach in
Supabase `select * from ernte_scan order by id desc` prüfen: nur EINE Zeile,
nicht zwei.

Für einen `P-`-Code (Mitarbeiter-Badge): ist der Code noch nicht in
`ernte_tag` angelernt, kommt `"typ":"person_unbekannt"` zurück (Zeile wird
trotzdem gespeichert, nur ohne aufgelöste Mitarbeiter-Zuordnung — die läuft
später über `ernte_tag` im Processor).

## Lokal mit `deno check` typprüfen

```bash
cd supabase/functions/ernte-ingest
deno check index.ts
```
