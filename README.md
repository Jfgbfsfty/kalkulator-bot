# 🤖 Kalkulator Mandatów – Bot Discord

Bot Discord dla serwera Polskie RP. Obsługuje:
- ⏱️ Liczenie czasu służby (`/on` / `/off`)
- 🏆 Ranking służby (`/top`)
- 📢 Wysyłanie embedów (awanse, CV) na kanały Discord
- 🔄 Automatyczna zmiana ról po awansie/degradacji

---

## 📋 Wymagania

- Node.js 18+
- Konto bota Discord (token z [Discord Developer Portal](https://discord.com/developers/applications))
- Włączone **Privileged Gateway Intents** w portalu:
  - ✅ Server Members Intent
  - ✅ Message Content Intent
  - ✅ Presence Intent

---

## 🚀 Pierwsze uruchomienie

### 1. Skonfiguruj .env

```bash
cp .env.example .env
```

Edytuj `.env`:

```env
# Token bota (Discord Developer Portal → Bot → Reset Token)
DISCORD_TOKEN=twoj_token_bota

# ID aplikacji (Discord Developer Portal → General Information)
DISCORD_CLIENT_ID=123456789

# ID serwera Discord (PPM na serwer przy włączonym trybie dewelopera)
DISCORD_GUILD_ID=123456789

# ID kanałów Discord (PPM na kanał przy włączonym trybie dewelopera)
DISCORD_LOG_CHANNEL_ID=      # kanał ogólnych logów
DISCORD_DUTY_CHANNEL_ID=     # kanał służby (/on /off)
DISCORD_CV_CHANNEL_ID=       # kanał zgłoszeń CV
DISCORD_PROMOTIONS_CHANNEL_ID= # kanał awansów/degradacji

# Port HTTP API bota (backend komunikuje się z botem przez ten port)
BOT_PORT=3001

# Sekret MUSI być identyczny jak BOT_API_SECRET w backend/.env
BOT_API_SECRET=sekret_min_32_znaki_xyz

# URL backendu (np. https://api.twoja-domena.com)
BACKEND_URL=https://api.twoja-domena.com

# ID ról Discord dla stopni (PPM na rolę → Kopiuj ID roli)
DISCORD_ROLE_KADET=
DISCORD_ROLE_DROGOWKA=
DISCORD_ROLE_SIERZANT=
DISCORD_ROLE_ZSZEF=
DISCORD_ROLE_SZEF=
```

### 2. Zainstaluj i uruchom

```bash
npm install
npm start
```

---

## 🔄 Uruchomienie na VPS (PM2)

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

Przydatne komendy:
```bash
pm2 list                      # status
pm2 logs kalkulator-bot       # logi na żywo
pm2 restart kalkulator-bot --update-env   # restart z nowym .env
```

---

## 🎮 Komendy slash

| Komenda | Opis |
|---------|------|
| `/on` | Wejście na służbę – zaczyna liczenie czasu |
| `/off` | Zejście ze służby – zatrzymuje liczenie, pokazuje czas |
| `/top` | Ranking czasu służby (top 10) |

---

## 🔌 HTTP API (dla backendu)

Bot nasłuchuje na `BOT_PORT` (domyślnie 3001). Każdy request musi mieć nagłówek:
```
x-bot-secret: <BOT_API_SECRET>
```

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/assign-role` | POST | Nadaj rolę użytkownikowi |
| `/api/remove-role` | POST | Usuń rolę użytkownikowi |
| `/api/swap-roles` | POST | Zamień rolę stopnia (awans/degradacja) |
| `/api/send-promotion` | POST | Wyślij embed awansu/degradacji |
| `/api/send-cv` | POST | Wyślij embed zgłoszenia CV |
| `/api/send-log` | POST | Wyślij wiadomość na kanał logów |
| `/api/guild-roles` | GET | Pobierz listę ról serwera |

---

## 📁 Struktura plików

```
bot/
├── src/
│   └── index.js        # Cały bot – klient Discord + HTTP API
├── .env                # Konfiguracja (NIE COMMITUJ do git!)
├── .env.example        # Wzór konfiguracji
├── .gitignore
├── ecosystem.config.js # PM2
├── package.json
└── README.md
```

---

## ⚠️ Ważne

- Nigdy nie udostępniaj tokena bota publicznie
- Jeśli token wycieknie → natychmiast zresetuj go w Discord Developer Portal
- `BOT_API_SECRET` musi być **identyczny** po stronie backendu i bota
- Bot musi mieć uprawnienie **Manage Roles** na serwerze + jego rola musi być **wyżej** niż role które nadaje
