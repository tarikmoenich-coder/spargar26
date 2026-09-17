-- Migration 2026-09-17: Bescheinigung "Doppelte Haushaltsführung" doch als
-- Scan hochladbar.
--
-- Nutzer-Vorgabe: "Für das Finanzamt brauche ich die Bescheinigung für
-- Doppelte Haushaltsführung tatsächlich als Scan im Anhang" - der
-- Lohnsteuerabzug-Sammelantrag ans Finanzamt Bensheim braucht das
-- unterschriebene Original, nicht nur die auf "Personal → Lohnsteuer"
-- erfassten Angaben (Familienstand/Wohnsituation). Ersetzt damit die zuvor
-- gebaute generierte Druckansicht als Anlage für den Sammelantrag.
--
-- WICHTIG: die 2026-08-11-Entscheidung bleibt für die Anreiseliste-
-- Checkliste (personal_kandidaten_checkliste.lohnsteuerabzug_erfuellt)
-- unverändert bestehen - die prüft weiterhin die erfassten Angaben, nicht
-- diesen neuen Upload. Der Upload ist ausschließlich für den
-- Lohnsteuerabzug-Sammelantrag relevant.
alter table employee_documents
  drop constraint if exists employee_documents_kategorie_check;
alter table employee_documents
  add constraint employee_documents_kategorie_check check (kategorie in (
    'Hochzeitsurkunde',
    'Ausweiskopie',
    'Führerschein Kopie',
    'Arbeitsvertrag',
    'Werks- und Mietvertrag',
    'Doppelte Haushaltsführung Bescheinigung',
    'Sonstiges'
  ));
