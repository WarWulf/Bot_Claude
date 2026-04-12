# Branch updaten & Merge-Konflikte lösen (GitHub/Git CLI)

Diese Anleitung hilft, wenn dein Feature-Branch **nicht aktualisiert** werden kann oder beim Merge Konflikte entstehen.

## TL;DR (wenn es schnell gehen muss)

```bash
git fetch origin
git checkout <dein-branch>
git rebase origin/main
# bei Konflikten: Dateien lösen, dann:
git add <datei>
git rebase --continue
# nach erfolgreichem Rebase:
git push --force-with-lease
```

Wenn `git push --force-with-lease` fehlschlägt, erst nochmal `git fetch origin` und dann den Push wiederholen.

## 1) Schnellcheck: warum kann die Branch nicht updaten?

Typische Gründe:
- Dein lokaler Branch ist nicht auf dem neuesten Stand (`origin/main` ist weiter).
- Es gibt Konflikte zwischen deinem Branch und dem Ziel-Branch.
- Branch Protection verlangt einen linearen Verlauf (z. B. Rebase statt Merge).
- CI Checks sind rot ("Update branch" in GitHub ist dann oft blockiert).

Häufige Fehlermeldungen:
- `This branch is out-of-date with the base branch` → Branch muss mit `main` synchronisiert werden (Rebase/Merge).
- `This branch has conflicts that must be resolved` → Konflikte lokal auflösen und neu pushen.
- `non-fast-forward` beim Push → Remote-Branch hat neue Commits, zuerst `fetch` und dann Rebase/Pull-Rebase.

## 2) Empfohlener Weg (sauber): Rebase auf `origin/main`

> Ersetze `main` durch deinen echten Ziel-Branch, falls nötig.

```bash
git fetch origin
git checkout <dein-branch>
git rebase origin/main
```

Wenn **kein Konflikt** kommt:

```bash
git push --force-with-lease
```

Warum `--force-with-lease`?
- Sicherer als `--force`, weil es nur pusht, wenn niemand anders in der Zwischenzeit denselben Remote-Branch geändert hat.

## 3) Konflikte im Rebase lösen

Bei Konflikten stoppt Git und zeigt betroffene Dateien.

### A) Status prüfen
```bash
git status
```

### B) Datei für Datei lösen
Öffne die Datei und suche Marker:

```text
<<<<<<< HEAD
...deine/aktuelle Änderung...
=======
...incoming Änderung...
>>>>>>> origin/main
```

- Entscheide, was bleiben soll (oder kombiniere beide Seiten).
- Entferne die Marker (`<<<<<<<`, `=======`, `>>>>>>>`).

### C) Gelöste Datei markieren
```bash
git add <datei>
```

### D) Rebase fortsetzen
```bash
git rebase --continue
```

Wiederhole B–D bis fertig.

## 4) Nützliche Rebase-Kommandos bei Problemen

Rebase abbrechen (zurück zum Zustand vor Rebase):

```bash
git rebase --abort
```

Aktuellen konfliktbehafteten Commit überspringen (vorsichtig):

```bash
git rebase --skip
```

## 5) Alternative: Merge statt Rebase

Wenn dein Team Merge-Commits erlaubt:

```bash
git fetch origin
git checkout <dein-branch>
git merge origin/main
```

Konflikte analog lösen (`git status` → Datei anpassen → `git add`), dann:

```bash
git commit
git push
```

## 6) GitHub UI: "Update branch" klappt nicht

Prüfe:
- Branch Protection Rules (Rebase required? Linear history?)
- Pflicht-Checks (CI muss grün sein)
- Berechtigungen (write/maintain auf Repo)

Wenn UI blockiert, nutze lokale CLI (oben) und pushe anschließend.

## 6b) Sonderfall: PR aus Fork

Wenn der Branch aus einem Fork kommt, kann "Update branch" in GitHub je nach Rechten blockiert sein.
Dann lokal im Fork-Clone:

```bash
git remote -v
git fetch upstream
git checkout <dein-branch>
git rebase upstream/main
git push --force-with-lease origin <dein-branch>
```

## 7) Konflikte vorbeugen

- Häufig klein rebasen (`git fetch` + `git rebase origin/main`), nicht erst am Ende.
- Kleine PRs statt großer Sammel-PR.
- Frühzeitig Dateien aufteilen (weniger Überschneidung).
- Vor Push lokal testen.

## 8) Mini-Playbook (Copy/Paste)

```bash
git fetch origin
git checkout <dein-branch>
git rebase origin/main
# Konflikte lösen, dann je Datei:
git add <datei>
git rebase --continue
# wenn fertig:
git push --force-with-lease
```
