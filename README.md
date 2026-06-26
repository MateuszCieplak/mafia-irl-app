# Mafia IRL

Mobile-first web application for the party game "Mafia". Players join from their phones — one is the Master (host) who controls the game flow through night and day phases.

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **Backend**: Express + Socket.io (game logic, real-time)
- **Database & Auth**: PocketBase (self-hosted)

## Project Structure

```
apps/
  web/        — Next.js frontend (mobile-first)
  server/     — Express + Socket.io backend
pb_schema/    — PocketBase collection schema (reference JSON)
```

## Prerequisites

- **Node.js** 20.x LTS or later
- **pnpm** 9.x — `corepack enable` then `corepack prepare pnpm@9.15.9 --activate`, or: `npm install -g pnpm`
- **PocketBase** binary — download from https://pocketbase.io/docs/

## Local Development

### 1. PocketBase

```bash
# Download and unpack PocketBase for your OS, then:
./pocketbase serve
```

Open `http://127.0.0.1:8090/_/` on first run to create an admin account. Then create the collections listed in `pb_schema/pb_schema.json` (manually through the Admin UI or via PocketBase migrations).

### 2. Environment Variables

```bash
cp .env.example .env
```

Fill in the values — at minimum:

| Variable | Description |
|---|---|
| `POCKETBASE_URL` | URL PocketBase **dla procesu Node** (serwer gry) — zwykle `http://127.0.0.1:8090` (ten sam komputer co PB) |
| `NEXT_PUBLIC_POCKETBASE_URL` | URL PocketBase **w przeglądarce** — na telefonach w LAN ustaw IP Wi‑Fi Maca (lub użyj `pnpm dev:lan`) |
| `SERVER_PORT` | Express port (default `3002` — avoids clash when Next uses `3000`/`3001`) |
| `CORS_ORIGIN` | Optional comma-separated origins; if unset, `http://localhost:3000` and `:3001` are allowed |
| `NEXT_PUBLIC_SOCKET_URL` | Socket.io URL for the browser — must match `SERVER_PORT` (e.g. `http://localhost:3002`) |
| `POCKETBASE_ADMIN_EMAIL` | PocketBase admin email (server only) |
| `POCKETBASE_ADMIN_PASSWORD` | PocketBase admin password (server only) |

**Where to put `.env`:** keep a single `.env` in the **repository root** (next to root `package.json`). The Express app loads `../../.env` automatically when started via `pnpm dev`.

**Next.js public vars:** `next dev` reads env files from `apps/web/`. Copy the `NEXT_PUBLIC_*` lines into `apps/web/.env.local` (or symlink), otherwise the browser may not see PocketBase / Socket URLs.

### 3. Install & Run

Z katalogu głównego repozytorium:

```bash
pnpm install
pnpm dev:lan
```

To **jedna komenda** uruchamia wszystkie trzy procesy:

1. **PocketBase** (port `8090`) — jeśli `POCKETBASE_BIN` w `.env` wskazuje na binarkę
2. **Express + Socket.io** (port `3002`)
3. **Next.js** (port `3000`)

I automatycznie:

- wykrywa IP LAN (np. `192.168.200.55`)
- ustawia `NEXT_PUBLIC_SOCKET_URL`, `NEXT_PUBLIC_POCKETBASE_URL` i `CORS_ORIGIN` na to IP (na czas procesu — bez edycji plików)
- ustawia `POCKETBASE_URL=http://127.0.0.1:8090` dla serwera Node (zawsze stabilne)
- przekazuje IP do Next.js przez `allowedDevOrigins`

**Co musisz zrobić jednorazowo:**

1. W `.env` w katalogu głównym ustaw ścieżkę do binarki PocketBase:
   ```
   POCKETBASE_BIN=~/Downloads/pocketbase_0.36.8_darwin_amd64/pocketbase
   ```
   Jeśli pominiesz, `dev:lan` wypisze przypomnienie i musisz odpalić PB w osobnym terminalu (`./pocketbase serve --http=0.0.0.0:8090`).

2. W panelu PocketBase (`http://localhost:8090/_/` → Settings → Application → Allowed Origins) dodaj swój adres LAN, np. `http://192.168.200.55:3000`. Adres pokazuje `dev:lan` na starcie.

**Localhost-only (bez telefonów):** możesz użyć `pnpm dev` (też uruchomi web + server, ale BEZ PocketBase i bez nadpisywania IP — PB musisz odpalić ręcznie). W praktyce `pnpm dev:lan` działa zawsze i jest prostsze.

**Testy serwera (Vitest):**

```bash
pnpm test
# albo: pnpm --filter mafia-server test
```

### 4. Testing on Phones (LAN)

**`0.0.0.0` vs IP Wi‑Fi**

- **`0.0.0.0` w `pocketbase serve --http="0.0.0.0:8090"`** oznacza: „nasłuchuj na **wszystkich** interfejsach sieciowych tego komputera”. To **nie** jest adres, który wpisujesz w przeglądarce.
- **`192.168.x.x` (IP Wi‑Fi)** to adres, pod którym **telefon w tej samej sieci** łączy się z Twoim Maciem: `http://192.168.x.x:3000` (Next), `:3002` (Socket), `:8090` (PocketBase).

**Automatyczne IP (bez ręcznej edycji `.env` przy każdej zmianie DHCP)**

Z katalogu głównego repozytorium:

```bash
pnpm lan-ip    # tylko wypisze wykryte IP
pnpm dev:lan   # wykryje IP, ustawi CORS + NEXT_PUBLIC_* na czas tego procesu i uruchomi web (Next -H 0.0.0.0) + server
```

`dev:lan` **nadpisuje** na czas uruchomienia: `CORS_ORIGIN`, `NEXT_PUBLIC_SOCKET_URL`, `NEXT_PUBLIC_POCKETBASE_URL`. Nie musisz za każdym razem zmieniać plików — po restarcie routera IP może się zmienić; wtedy ponownie `pnpm dev:lan`.

**Co nadal musisz zrobić ręcznie (raz na dany adres lub po zmianie IP):**

- W panelu PocketBase (`/_/`) dodać do **Allowed origins** adres frontu, np. `http://192.168.1.142:3000` (ten sam, który pokazuje `dev:lan`).
- Uruchomić PocketBase tak, by był dostępny z LAN: `./pocketbase serve --http="0.0.0.0:8090"`.

**Gdzie jeszcze bywa IP (poza `.env`):**

- Root `.env`: `CORS_ORIGIN` — przy `dev:lan` ustawiane automatycznie; przy zwykłym `pnpm dev` musi zawierać `http://TWOJE_IP:3000`.
- `apps/web/.env.local`: `NEXT_PUBLIC_*` — opcjonalne przy pracy wyłącznie z `pnpm dev`; przy `dev:lan` **zmienne ze skryptu mają pierwszeństwo** nad plikiem (o ile Next nie trzyma innej kolejności — wtedy usuń lub zakomentuj stare IP w `.env.local`).
- Firewall macOS: zezwól na porty 3000, 3002, 8090 dla sieci lokalnej.

Z tunelu (ngrok / Cloudflare Tunnel) ustawiasz **publiczny** URL w `CORS_ORIGIN` i `NEXT_PUBLIC_*` zamiast IP LAN.

## Game Roles (Phase 1)

- **Citizen** — votes during the day
- **Mafia** — selects a player to eliminate at night (consensus required)
- **Doctor** — protects one player at night
- **Detective** — investigates one player at night (is_mafia: true/false)

## License

Private — all rights reserved.
