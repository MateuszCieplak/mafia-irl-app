# 🎭 Mafia IRL

Mobilna aplikacja webowa do grania w imprezową grę **Mafia** „na żywo”. Każdy gracz wchodzi
z własnego telefonu przez przeglądarkę. Jedna osoba jest **Mistrzem gry (Masterem)** — nie gra,
tylko prowadzi rozgrywkę z kokpitu: przełącza fazy, widzi wszystko, co dzieje się w nocy,
i pilnuje tempa. Reszta dostaje tajne role i dostaje do wykonania ruchy prosto na ekranie telefonu,
więc nie trzeba zamykać oczu, rozdawać kartek ani liczyć głosów ręcznie.

> Interfejs jest w całości po polsku. Aplikacja jest mobile-first, ale działa też na komputerze.

---

## Spis treści

1. [Co potrafi aplikacja](#co-potrafi-aplikacja)
2. [Zasady gry i przebieg rundy](#zasady-gry-i-przebieg-rundy)
3. [Tryb „Mafia zaawansowana” (karty mocy)](#tryb-mafia-zaawansowana-karty-mocy)
4. [Ustawienia pokoju](#ustawienia-pokoju)
5. [Architektura](#architektura)
6. [Wymagania](#wymagania)
7. [Konfiguracja (`.env`)](#konfiguracja-env)
8. [Uruchomienie — wybierz wariant](#uruchomienie--wybierz-wariant)
   - [Wariant A: tryb imprezowy `pnpm party` (najprostszy)](#wariant-a-tryb-imprezowy-pnpm-party-najprostszy)
   - [Wariant B: stały serwer za reverse proxy i własną domeną](#wariant-b-stały-serwer-za-reverse-proxy-i-własną-domeną)
   - [Wariant C: Docker (obrazy z repozytorium)](#wariant-c-docker-obrazy-z-repozytorium)
   - [Wariant D: tryb deweloperski](#wariant-d-tryb-deweloperski)
9. [Pierwsze uruchomienie krok po kroku — jak zacząć grę](#pierwsze-uruchomienie-krok-po-kroku--jak-zacząć-grę)
10. [Baza danych PocketBase](#baza-danych-pocketbase)
11. [Aktualizacja, backup, bezpieczeństwo](#aktualizacja-backup-bezpieczeństwo)
12. [Testy](#testy)
13. [Rozwiązywanie problemów](#rozwiązywanie-problemów)
14. [Ograniczenia i dobre do wiedzenia](#ograniczenia-i-dobre-do-wiedzenia)
15. [Struktura repozytorium](#struktura-repozytorium)
16. [Licencja](#licencja)

---

## Co potrafi aplikacja

**Pokoje i gracze**
- Rejestracja i logowanie (e-mail + hasło + nazwa gracza), konta trzymane w PocketBase.
- Master zakłada pokój (5-znakowy kod). Tylko jedno, wskazane w konfiguracji konto może zakładać pokoje.
- Dołączanie przez kod pokoju lub **zaproszenia** — lobby pokazuje, kto jest online, i pozwala zaprosić
  jedną osobę albo wszystkich naraz.
- Wyrzucanie graczy z pokoju, zamykanie pokoju, powrót do lobby po zakończonej grze (bez zakładania nowego pokoju).
- **Boty** — master może dodać boty do lobby (testy, uzupełnienie składu). Boty istnieją tylko w pamięci
  serwera, nie tworzą kont w bazie.
- Obsługa rozłączeń: gracz, który straci połączenie w lobby, jest usuwany dopiero po czasie karencji
  (domyślnie 2 min), w trakcie gry po odświeżeniu strony wraca do swojego stanu (rola, werdykt nocy, głosowanie).

**Rozgrywka**
- Role: **Obywatel, Mafia, Lekarz, Detektyw** — losowane przy starcie albo przypisywane ręcznie przez mastera.
- Konfigurowalna liczba mafii, lekarzy i detektywów. **Wielu lekarzy/detektywów** ma własne tury w nocy
  (nie wiedzą o sobie nawzajem); mafia gra wspólnie w jednej turze.
- Czat dzienny dla wszystkich i **nocny czat mafii** (zamknięty kanał).
- Głosowanie dzienne z możliwością cofnięcia głosu, pominięcia („nikt nie odpada”) i opcjonalnym zakazem głosowania na siebie.
- Notatnik gracza, ściąga z opisem swojej roli, ekran wyniku każdej fazy (kto zginął / kto został uratowany / wynik głosowania).
- Opcjonalne **timery faz** (domyślnie wyłączone — wtedy fazy przełącza tylko master).

**Kokpit mastera**
- Przyciski „następna faza” z podglądem, co będzie dalej, oraz informacja, kto jeszcze nie wykonał ruchu / nie zagłosował.
- **Podgląd na żywo (Master Insight)** — master widzi w czasie rzeczywistym wszystkie tajne akcje (kogo wybrała mafia,
  kogo leczył lekarz, kogo sprawdził detektyw, użyte karty) i pełną historię tych zdarzeń z bieżącej gry.
- Ręczne przypisywanie ról przed startem (z walidacją limitów), podgląd wszystkich ról i kart.

**Ochrona dostępu**
- Opcjonalne **hasło do aplikacji** (`ACCESS_PASSWORD`) — przed wejściem na jakąkolwiek stronę trzeba wpisać hasło
  (ciasteczko ważne 7 dni). Przydatne, gdy gra stoi pod publicznym adresem.

---

## Zasady gry i przebieg rundy

**Cel**
- 🏘️ **Miasto** (obywatele, lekarz, detektyw) wygrywa, gdy wyeliminuje całą mafię.
- 🔪 **Mafia** wygrywa, gdy liczba żywych mafiozów **jest równa lub większa** niż liczba żywych pozostałych graczy.

**Role**
| Rola | Co robi |
|---|---|
| Obywatel | Dyskutuje i głosuje w dzień. |
| Mafia | W nocy wspólnie wybiera ofiarę — wybór musi być **jednomyślny** (każdy mafioso może zmienić lub wycofać głos, aż wszyscy wskażą tę samą osobę). |
| Lekarz | W nocy chroni jedną osobę przed zabiciem. |
| Detektyw | W nocy sprawdza jedną osobę — dowiaduje się, czy to mafia (tak/nie). |

**Domyślna liczba ról** (przy automatycznym doborze): mafia = 1 na każdych 4 graczy (min. 1), po 1 lekarzu i detektywie,
reszta to obywatele. Ręcznie można ustawić mafię (maks. 34% graczy, zaokrąglone w dół, min. 1) oraz liczbę lekarzy i detektywów.

**Fazy** (master przełącza je po kolei z kokpitu):

1. `role_reveal` — gracze zapoznają się z rolami.
2. `night_detective` — tura(y) detektywa.
3. `night_doctor` — tura(y) lekarza.
4. `night_mafia` — wspólna tura mafii (wymagana zgoda wszystkich żywych mafiozów).
5. `night_resolve` — rozstrzygnięcie nocy: ofiara ginie, chyba że chronił ją lekarz.
6. `day_deliberation` — dyskusja.
7. `day_vote` — głosowanie. Wyrzucony zostaje gracz z **największą liczbą głosów**; przy remisie albo gdy
   większość oddała głos „pomiń” — nikt nie odpada.
8. `day_resolve` — wynik głosowania, sprawdzenie warunków zwycięstwa, kolejna runda od nocy.

Fazy nocne nie są pomijane, gdy nie ma już żywego aktora (np. detektyw nie żyje) — master przeklikuje je ręcznie,
dzięki czemu po długości nocy nikt nie odgadnie, kto jeszcze żyje.

---

## Tryb „Mafia zaawansowana” (karty mocy)

Włączany w ustawieniach pokoju. Przy starcie gry losowane są **jednorazowe karty** (żyją tylko w pamięci serwera):

| Karta | Dla kogo | Efekt |
|---|---|---|
| 🔎 **Sprawdzenie** | obywatel | W nocy wskazuje 3 graczy i dowiaduje się, ilu z nich to mafia. |
| 🛡️ **Tarcza** | obywatel | Unieważnia wyrzucenie z głosowania (chroni *każdego* wybranego — także mafię). |
| 🛡️ **Tarcza mafii** | mafia (wspólna) | Jak wyżej, jednorazowa dla całej drużyny. |
| 🕵️ **Alibi** | mafia | Wybrany mafioso przy najbliższym Sprawdzeniu liczy się jako „czysty”. |
| 📡 **Zakłócenie** | mafia | Najbliższe Sprawdzenie pokaże błędny wynik. |
| 🎭 **Fałszywy trop** | mafia | Wybrany niewinny gracz przy najbliższym Sprawdzeniu liczy się jako mafia. |

Jak to działa w praktyce:
- Kartę zgłasza się przyciskiem **„Użyj karty”** w fazie głosowania. Tarcza działa od razu, w tym głosowaniu.
- Karty nocne (Sprawdzenie, Alibi, Zakłócenie, Fałszywy trop) trafiają do kolejki i mają własną turę na początku
  następnej nocy — najpierw mafii, potem obywateli, żeby efekt kart mafii zdążył zadziałać na Sprawdzenie z tej samej nocy.
- Master wie, że ktoś użył karty, i ogłasza to jawnie (bez mówienia jakiej) — nie trzeba blefować.
- Karty nocne można zgłosić dopiero od ustawionej rundy (domyślnie od 3.).
- Każdy typ karty można włączyć/wyłączyć osobno, można ustawić liczbę kart Sprawdzenia i wybrać jedną kartę specjalną mafii
  (albo żadną).

---

## Ustawienia pokoju

Master zmienia je w lobby (zakładki: **Skład, Zasady nocy, Timery, Mafia zaawansowana, Pokój**):

| Ustawienie | Domyślnie | Opis |
|---|---|---|
| Liczba mafii (ręczna) | auto | Auto = 1 na 4 graczy; ręcznie maks. 34% graczy. |
| Liczba detektywów / lekarzy | 1 / 1 | Każdy ma własną turę nocną. |
| Lekarz może leczyć siebie | tak | |
| Lekarz może leczyć tę samą osobę dwie noce z rzędu | nie | |
| Detektyw nie może zginąć w 1. nocy | nie | Dla graczy wygląda to jak spokojna noc; flagę widzi tylko master. |
| Timery faz | wyłączone | Detektyw 30 s, lekarz 30 s, mafia 120 s, dyskusja 300 s, głosowanie 60 s (zakres 5–600 s). |
| Zakaz głosowania na siebie | — | Ustawienie `self_vote` po stronie serwera. |
| Min. / maks. liczba graczy | 4 / 15 | Minimum jest sprawdzane przy starcie gry. |
| Tryb zaawansowany i karty | wyłączony | Patrz wyżej. |

---

## Architektura

```
 Telefony / przeglądarki graczy
            │  HTTPS
            ▼
 ┌───────────────────────┐
 │  proxy (jeden adres)   │   ← w trybie party: scripts/party.mjs, w produkcji: Caddy/nginx
 └─────┬────────┬────────┬┘
  /pb/*│        │/socket.io/*      reszta
       ▼        ▼                    ▼
 PocketBase   Serwer gry          Next.js 14
  :8090     Express+Socket.io      (frontend)
 (konta,        :3002                :3000
 pokoje,    logika gry, stan
 rundy,       partii w pamięci
 wiadomości)
```

- **Frontend** — Next.js 14 (App Router) + Tailwind CSS. Łączy się bezpośrednio z PocketBase (logowanie, rejestracja)
  i z serwerem gry przez Socket.io (cała rozgrywka).
- **Serwer gry** — Express + Socket.io. Zawiera całą logikę: role, fazy, głosowanie, karty, boty, warunki zwycięstwa.
  Loguje się do PocketBase jako administrator, a graczy uwierzytelnia po tokenie z PocketBase.
- **PocketBase 0.36.x** — baza (SQLite) i konta użytkowników. Kolekcje gry (`rooms`, `room_players`, `rounds`,
  `night_actions`, `votes`, `messages`) tworzy automatycznie migracja `pb_migrations/1763500000_init_mafia.js`.
  Reguły API kolekcji są puste = dostęp tylko dla superusera, czyli wyłącznie przez serwer gry.
- **Stan trwającej partii żyje w pamięci serwera gry** — restart procesu `apps/server` w trakcie gry kończy tę partię
  (patrz [ograniczenia](#ograniczenia-i-dobre-do-wiedzenia)).

Porty: `8080` (publiczny, tryb party), `3000` (Next.js), `3002` (serwer gry), `8090` (PocketBase).

---

## Wymagania

- **Node.js 20 LTS** lub nowszy
- **pnpm 9.x** — `corepack enable` + `corepack prepare pnpm@9.15.9 --activate` albo `npm install -g pnpm`
- **PocketBase 0.36.x** — w wariancie A pobierany automatycznie; w pozostałych trzeba go dostarczyć samemu
  (https://pocketbase.io/docs/)
- Dla trybu party z tunelem: dostęp do internetu (pobranie `cloudflared`, połączenie z Cloudflare)
- Systemy: Windows 10/11, Linux (x64/arm64), macOS. Na Linuksie do rozpakowania potrzebny `tar` lub `unzip`.
- Zasoby: gra jest lekka — wystarczy kilkuletni mały komputer / Raspberry Pi klasy 4+ (frontend buduje się ok. minuty).

---

## Konfiguracja (`.env`)

Jeden plik `.env` w **katalogu głównym repozytorium** (wzór: `.env.example`). Nie trafia do gita.

```bash
cp .env.example .env      # Windows (PowerShell): Copy-Item .env.example .env
```

| Zmienna | Wymagana | Opis |
|---|---|---|
| `POCKETBASE_ADMIN_EMAIL` | tak | E-mail **administratora PocketBase** (nie gracza). W trybie party konto jest tworzone samo. |
| `POCKETBASE_ADMIN_PASSWORD` | tak | Hasło admina, min. 10 znaków. |
| `ALLOWED_ROOM_CREATOR_EMAIL` | tak | E-mail konta gracza, które może zakładać pokoje (Master). **Bez tego nikt nie założy pokoju.** |
| `NEXT_PUBLIC_ROOM_HOST_EMAIL` | tak | To samo co wyżej — używane przez frontend do pokazania przycisku „Utwórz pokój”. Wartość jest wbudowana w build, więc po zmianie trzeba przebudować frontend. |
| `ACCESS_PASSWORD` | nie | Hasło wymagane przed wejściem do aplikacji. Puste = bez ochrony. |
| `POCKETBASE_URL` | wariant B–D | Adres PocketBase widziany przez **serwer gry** (np. `http://127.0.0.1:8090`). W trybie party ustawiany sam. |
| `NEXT_PUBLIC_POCKETBASE_URL` | wariant B–D | Adres PocketBase widziany przez **przeglądarkę**. W trybie party = `/pb`. |
| `NEXT_PUBLIC_SOCKET_URL` | wariant B–D | Adres Socket.io widziany przez przeglądarkę. W trybie party = `/`. |
| `SERVER_PORT` | nie | Port serwera gry (domyślnie `3002`). |
| `CORS_ORIGIN` | wariant B–D | Dozwolone originy po przecinku (np. `https://mafia.twojadomena.pl`). Domyślnie `localhost:3000/3001`. |
| `PARTY_PORT` | nie | Port publiczny trybu party (domyślnie `8080`). |
| `POCKETBASE_BIN` | nie | Własna ścieżka do binarki PocketBase (omija automatyczne pobieranie). |
| `CLOUDFLARED_BIN` | nie | Własna ścieżka do `cloudflared`. |

> ⚠️ Zmienne `NEXT_PUBLIC_*` są **wbudowywane w frontend podczas `next build`**. Zmiana ich wartości wymaga
> ponownego zbudowania (w trybie party: `pnpm party --build`).

---

## Uruchomienie — wybierz wariant

| Sytuacja | Wariant |
|---|---|
| Gra na jedną imprezę, serwer włączany na życzenie, brak domeny | **A** — `pnpm party` |
| Serwer chodzi cały czas, jest własna domena i/lub reverse proxy | **B** |
| Kolega woli kontenery | **C** |
| Rozwijanie aplikacji | **D** |

### Wariant A: tryb imprezowy `pnpm party` (najprostszy)

Cała gra działa na jednym komputerze, a gracze wchodzą z telefonów przez internet dzięki darmowemu tunelowi
Cloudflare — **bez domeny, bez konta Cloudflare i bez otwierania portów na routerze**.

**Jednorazowo**

```bash
git clone https://github.com/MateuszCieplak/mafia-irl-app.git
cd mafia-irl-app
pnpm install
cp .env.example .env     # i uzupełnij: POCKETBASE_ADMIN_*, ALLOWED_ROOM_CREATOR_EMAIL, NEXT_PUBLIC_ROOM_HOST_EMAIL
```

**Na każdej imprezie**

```bash
pnpm party
```

Na Windowsie najprościej: **dwuklik na `party.cmd`** (omija blokadę skryptów PowerShell; gdyby `pnpm party` zgłaszał
„running scripts is disabled”, użyj `pnpm.cmd party`).

Skrypt `scripts/party.mjs` robi wszystko sam:

1. pobiera (za pierwszym razem) PocketBase i `cloudflared` do `.tools/`,
2. tworzy bazę w `pb/pb_data/`, uruchamia migracje (`pb_migrations/`) i zakłada konto administratora z `.env`,
3. buduje frontend (tylko za pierwszym razem, po zmianie kodu albo zmianie `NEXT_PUBLIC_ROOM_HOST_EMAIL`;
   wymuszenie: `pnpm party --build`),
4. uruchamia PocketBase (`:8090`), serwer gry (`:3002`) i Next.js (`:3000`) za jednym portem `8080`,
5. otwiera tunel i wypisuje **adres `https://….trycloudflare.com` oraz kod QR** do zeskanowania telefonami.

Dodatkowe opcje:

| Komenda | Co robi |
|---|---|
| `pnpm party:lan` | Bez tunelu — tylko sieć lokalna (Wi‑Fi), adres `http://IP-komputera:8080`. Działa bez internetu. |
| `pnpm party --build` | Wymusza przebudowanie frontendu. |
| `PARTY_PORT=9000` w `.env` | Inny port publiczny. |

Dobrze wiedzieć:
- Adres tunelu jest **losowy przy każdym uruchomieniu** — po prostu wyślij graczom nowy link albo pokaż QR.
  Konta graczy i historia zostają w `pb/pb_data/`.
- Frontend używa adresów względnych (`/pb`, `/`), więc zmiana adresu tunelu **nie wymaga przebudowy**.
- Panel PocketBase: `http://localhost:8080/pb/_/` (login z `POCKETBASE_ADMIN_*`).
- Komputer **nie może usnąć** w trakcie gry — wyłącz uśpienie. Na Windowsie przy pierwszym uruchomieniu w trybie LAN
  zapora zapyta o zgodę — zezwól dla sieci prywatnej.
- Skrypt nie wystartuje drugi raz, gdy porty `8080/8090/3002/3000` są zajęte (chroni to bazę przed uszkodzeniem działającej gry).
- Zatrzymanie: `Ctrl+C`.

**Na serwerze bez monitora (Linux)** — uruchom w `tmux`/`screen` albo jako usługę systemd z poleceniem
`pnpm party` w katalogu repozytorium. Link/QR pojawia się w logu procesu. Ponieważ adres tunelu zmienia się przy każdym
starcie, dla serwera działającego non-stop lepszy jest **wariant B** (stała domena) albo nazwany tunel Cloudflare
(wymaga darmowego konta Cloudflare i własnej domeny — poza zakresem tego README).

### Wariant B: stały serwer za reverse proxy i własną domeną

Odtwarzamy to, co robi `party.mjs`: jeden adres, trzy backendy. Przykład dla **Caddy** (automatyczne HTTPS):

```caddyfile
mafia.twojadomena.pl {
    handle_path /pb/* {
        reverse_proxy 127.0.0.1:8090
    }
    handle /socket.io/* {
        reverse_proxy 127.0.0.1:3002
    }
    handle {
        reverse_proxy 127.0.0.1:3000
    }
}
```

W `.env` (adresy względne — wtedy front nie zależy od domeny):

```env
POCKETBASE_URL=http://127.0.0.1:8090
NEXT_PUBLIC_POCKETBASE_URL=/pb
NEXT_PUBLIC_SOCKET_URL=/
CORS_ORIGIN=https://mafia.twojadomena.pl
SERVER_PORT=3002
POCKETBASE_ADMIN_EMAIL=...
POCKETBASE_ADMIN_PASSWORD=...
ALLOWED_ROOM_CREATOR_EMAIL=...
NEXT_PUBLIC_ROOM_HOST_EMAIL=...
ACCESS_PASSWORD=...          # zalecane przy publicznym adresie
```

Kroki:

```bash
pnpm install

# 1. PocketBase (binarka ze strony pocketbase.io, wersja 0.36.x)
./pocketbase superuser upsert "$POCKETBASE_ADMIN_EMAIL" "$POCKETBASE_ADMIN_PASSWORD" --dir pb/pb_data --migrationsDir pb_migrations
./pocketbase serve --http=127.0.0.1:8090 --dir pb/pb_data --migrationsDir pb_migrations --automigrate=false

# 2. Serwer gry
cd apps/server && node index.js

# 3. Frontend (zmienne NEXT_PUBLIC_* muszą być ustawione już przy budowaniu!)
cd apps/web && pnpm exec next build && pnpm exec next start -H 127.0.0.1 -p 3000
```

Każdy z trzech procesów warto uruchomić jako usługę systemd (albo pm2), żeby wstawały po restarcie maszyny.
Do Next.js trzeba przekazać te same zmienne środowiskowe co wyżej (w szczególności `ACCESS_PASSWORD`).
Na routerze wystarczy przekierować porty 80/443 na maszynę z reverse proxy; porty `3000/3002/8090` **nie** powinny
być wystawiane na zewnątrz.

### Wariant C: Docker (obrazy z repozytorium)

W repozytorium są dwa pliki Dockerfile: `apps/server/Dockerfile` (serwer gry, port `3002`) i `apps/web/Dockerfile`
(frontend, port `3000`). **PocketBase nie ma własnego obrazu w repozytorium** — trzeba go uruchomić osobno
(np. oficjalną binarką lub dowolnym obrazem PocketBase 0.36.x) z podmontowanymi katalogami `pb_data` oraz
`pb_migrations` (migracja tworząca kolekcje gry).

Budowanie z korzenia repozytorium:

```bash
docker build -f apps/server/Dockerfile -t mafia-server .

docker build -f apps/web/Dockerfile -t mafia-web \
  --build-arg NEXT_PUBLIC_SOCKET_URL=/ \
  --build-arg NEXT_PUBLIC_POCKETBASE_URL=/pb \
  --build-arg NEXT_PUBLIC_ROOM_HOST_EMAIL=host@example.com .
```

Uruchomienie kontenerów wymaga zmiennych środowiskowych z tabeli powyżej (serwer: `POCKETBASE_URL`,
`POCKETBASE_ADMIN_*`, `ALLOWED_ROOM_CREATOR_EMAIL`, `CORS_ORIGIN`; web: `ACCESS_PASSWORD`) oraz wspólnego reverse proxy jak
w wariancie B. Wewnątrz sieci Dockera `POCKETBASE_URL` wskazuje na nazwę kontenera PocketBase
(np. `http://pocketbase:8090`).

> ℹ️ Dockerfile'e były używane przy wdrożeniu na EasyPanel, ale **kompletnego `docker-compose.yml` dla całej gry
> w repozytorium jeszcze nie ma** (plik `docker-compose.yml` poza tym katalogiem to pozostałość po bazie Postgres,
> której gra nie używa). Jeśli kolega wybierze Dockera, dopiszemy gotowy compose.

### Wariant D: tryb deweloperski

```bash
pnpm install
pnpm dev:lan
```

Jedna komenda uruchamia PocketBase (jeśli `POCKETBASE_BIN` w `.env` wskazuje binarkę), serwer gry i Next.js w trybie
dev, wykrywa IP w sieci lokalnej i ustawia `CORS_ORIGIN` / `NEXT_PUBLIC_*` na czas działania procesu (bez edycji plików).
Dodatkowo trzeba raz dodać adres frontu (np. `http://192.168.1.42:3000`) w panelu PocketBase →
*Settings → Application → Allowed origins*.

Inne skrypty:

| Komenda | Opis |
|---|---|
| `pnpm dev` | Web + serwer lokalnie (PocketBase odpalasz ręcznie). |
| `pnpm dev:web` / `pnpm dev:server` | Pojedyncze procesy. |
| `pnpm lan-ip` | Wypisuje wykryte IP w LAN. |
| `pnpm test` | Testy serwera (Vitest). |

---

## Pierwsze uruchomienie krok po kroku — jak zacząć grę

1. Uruchom grę dowolnym wariantem i otwórz podany adres.
2. Jeśli ustawiono `ACCESS_PASSWORD` — wpisz hasło dostępu.
3. **Master**: zarejestruj konto **dokładnie tym e-mailem**, który jest w `ALLOWED_ROOM_CREATOR_EMAIL`
   (i `NEXT_PUBLIC_ROOM_HOST_EMAIL`). Tylko to konto zobaczy/użyje „Utwórz pokój”.
4. Master zakłada pokój, ustawia skład i zasady (zakładki ustawień), opcjonalnie dodaje boty.
5. **Gracze** rejestrują się (e-mail, nazwa gracza, hasło min. 8 znaków) i dołączają kodem pokoju lub przez zaproszenie.
6. Gdy jest co najmniej minimalna liczba graczy (domyślnie 4) i wszyscy są online, master klika **„Rozpocznij grę”**
   (może wcześniej ręcznie przypisać role).
7. Master prowadzi grę przyciskami faz. Po zwycięstwie jednej ze stron wszyscy widzą ekran końcowy,
   a master może wrócić do lobby i zagrać kolejną partię w tym samym pokoju.

---

## Baza danych PocketBase

- Dane: `pb/pb_data/` (SQLite + pliki). **To jest cały stan konta/graczy — rób backup tego katalogu.**
- Kolekcje gry tworzy migracja `pb_migrations/1763500000_init_mafia.js` (kolekcja `users` dostaje dodatkowe pole
  `username`). Jeśli kolekcja już istnieje (np. przywrócony backup), jest pomijana.
- `pb_schema/pb_schema.json` to referencyjny zapis schematu (do ręcznego odtworzenia przez panel admina).
- Panel admina: `/_/` (w trybie party: `/pb/_/`).
- Konto admina w trybie party jest tworzone/aktualizowane przy każdym starcie z danych w `.env` — zmiana hasła w `.env`
  zmienia hasło admina.

---

## Aktualizacja, backup, bezpieczeństwo

**Aktualizacja**

```bash
git pull
pnpm install
pnpm party        # frontend przebuduje się sam, gdy wykryje zmiany w kodzie
```

W wariancie B/C po `git pull` trzeba ręcznie przebudować frontend i zrestartować procesy.

**Backup:** kopiuj katalog `pb/pb_data/` (najlepiej przy zatrzymanej grze) oraz plik `.env`.

**Bezpieczeństwo**
- Plik `.env` zawiera hasło administratora — **nie commituj go** (jest w `.gitignore`).
- Przy publicznym adresie ustaw `ACCESS_PASSWORD`.
- Nie wystawiaj na zewnątrz portów `3000`, `3002`, `8090` — tylko reverse proxy / tunel.
- Rejestracja kont jest otwarta (każdy z linkiem i hasłem dostępu może założyć konto gracza); prawo zakładania pokojów
  ma tylko konto z `ALLOWED_ROOM_CREATOR_EMAIL`.
- Jeśli `ALLOWED_ROOM_CREATOR_EMAIL` jest puste, serwer odrzuca tworzenie pokoi (nikt nie może założyć gry).

---

## Testy

Testy serwera (logika gry, fazy nocne, głosowanie, karty, boty, warunki zwycięstwa, pełna gra integracyjna):

```bash
pnpm test
# albo: pnpm --filter mafia-server test
```

Używają mocka PocketBase i nie wymagają działającej bazy. Stan na dzień ostatniej aktualizacji tego README:
**16 plików testowych, 88 testów przechodzi, 1 pominięty.** Frontend nie ma testów automatycznych.

---

## Rozwiązywanie problemów

| Objaw | Co sprawdzić |
|---|---|
| „Gra już działa (zajęte porty…)” | Poprzednia instancja nadal chodzi — zamknij jej okno (`Ctrl+C`) lub zabij procesy na portach 8080/8090/3002/3000. |
| Nie ma przycisku „Utwórz pokój” / `forbidden_create_room` | Zaloguj się kontem o e-mailu równym `ALLOWED_ROOM_CREATOR_EMAIL`; po zmianie `NEXT_PUBLIC_ROOM_HOST_EMAIL` przebuduj frontend (`pnpm party --build`). |
| „Łączenie z serwerem…” bez końca | Serwer gry nie działa, zły `NEXT_PUBLIC_SOCKET_URL`, albo sesja jest nieważna (aplikacja sama wyloguje i poprosi o ponowne logowanie). Sprawdź `http://adres/socket.io/` oraz `/health` na porcie `3002`. |
| Błędy logowania do PocketBase w logach serwera | Zły `POCKETBASE_ADMIN_EMAIL/PASSWORD`. Serwer ponawia próby przez ok. 40 s przy starcie i sam loguje się ponownie, gdy token admina straci ważność. |
| Błąd CORS w przeglądarce | `CORS_ORIGIN` musi zawierać dokładny origin frontu (schemat + host, bez ukośnika na końcu). |
| Telefon z LAN nie łączy się z PocketBase (dev) | Dodaj adres frontu w *Allowed origins* w panelu PocketBase i uruchom PB z `--http=0.0.0.0:8090`. |
| Link tunelu nie otwiera się od razu | Nowa subdomena `trycloudflare.com` potrzebuje kilkunastu sekund na propagację DNS; skrypt czeka na to przed wypisaniem QR. |
| PowerShell: „running scripts is disabled” | Użyj `party.cmd` albo `pnpm.cmd party`. |
| `Brak zależności — uruchom najpierw: pnpm install` | Wykonaj `pnpm install` w katalogu repozytorium. |
| „Nie udało się rozpakować…” (Linux) | Doinstaluj `tar` lub `unzip`, albo wskaż własne binarki przez `POCKETBASE_BIN` / `CLOUDFLARED_BIN`. |

---

## Ograniczenia i dobre do wiedzenia

- **Stan trwającej partii jest w pamięci serwera gry.** Restart `apps/server` (lub awaria procesu) w trakcie gry przerywa
  tę partię; konta i pokoje w PocketBase zostają. Nie aktualizuj/restartuj gry w trakcie rozgrywki.
- Aplikacja zakłada **jedną instancję serwera gry** (brak skalowania poziomego).
- Boty nie mają kont w bazie i są tylko do testów / uzupełniania składu; karty mocy nie trafiają do botów.
- Darmowy tunel Cloudflare (`trycloudflare.com`) nie ma gwarancji dostępności i zmienia adres przy każdym starcie.
- Interfejs jest po polsku, bez przełącznika języka.

---

## Struktura repozytorium

```
apps/
  web/                    Next.js 14 (App Router) + Tailwind — frontend mobile-first
    app/                  strony: /, /login, /register, /lobby, /room/[code], /game/[code], /enter-password
    components/           panele, kokpit mastera, głosowanie, czat, karty mocy…
    lib/                  klient PocketBase, hook Socket.io, kontekst autoryzacji
    middleware.js         ochrona hasłem dostępu (ACCESS_PASSWORD)
  server/                 Express + Socket.io — logika gry
    game/                 role, fazy, noc, dzień, boty, karty mocy, tury wielu ról
    socket/               handlery: lobby, gra, czat, obecność/zaproszenia
    lib/                  klient PocketBase (admin z automatycznym odnawianiem tokenu)
    test/                 testy Vitest
pb_migrations/            migracja tworząca kolekcje gry w PocketBase
pb_schema/                referencyjny schemat kolekcji (JSON)
scripts/
  party.mjs               tryb imprezowy (PocketBase + gra + Next + proxy + tunel + QR)
  run-dev-lan.mjs         dev w sieci lokalnej
  detect-lan-ip.mjs       wykrywanie IP w LAN
party.cmd                 start trybu imprezowego dwuklikiem (Windows)
.env.example              wzór konfiguracji
```

---

## Licencja

Prywatny projekt — wszelkie prawa zastrzeżone.
