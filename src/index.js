require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const http = require('http');
const https = require('https');

// ===========================
// HELPER: KOMUNIKACJA Z BACKENDEM
// ===========================
/**
 * Wysyła żądanie HTTP/HTTPS do backendu i zwraca odpowiedź.
 * Automatycznie używa https gdy BACKEND_URL zaczyna się od https://
 * Stripuje cudzysłowy dodawane przez Railway do zmiennych środowiskowych.
 */
const callBackend = (method, path, data = null) => {
  return new Promise((resolve, reject) => {
    const backendBase = (process.env.BACKEND_URL || 'http://localhost:5000').replace(/^["']|["']$/g, '');
    const secret = (process.env.BOT_API_SECRET || '').replace(/^["']|["']$/g, '');
    const parsed = new URL(backendBase);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const body = data ? JSON.stringify(data) : null;
    const options = {
      hostname: parsed.hostname,
      port: parseInt(parsed.port) || (isHttps ? 443 : 80),
      path,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        'x-bot-secret': secret,
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    };
    const req = transport.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => (responseData += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(responseData)); }
        catch { resolve({ success: false, statusCode: res.statusCode }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
};

/**
 * Fire-and-forget – zapisuje akcję bota w dzienniku audytu.
 */
const sendAuditLog = (action, performedByUsername, targetResource, details, success = true) => {
  callBackend('POST', '/api/bot-logs', { action, performedByUsername, targetResource, details, success })
    .catch((err) => console.error(`⚠️ Błąd zapisu logu audytu: ${err.message}`));
};

/**
 * Formatuje minuty jako "Xh Ymin"
 */
const formatMinutes = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}min`;
};

// ===========================
// DEFINICJE KOMEND SLASH
// ===========================
const slashCommands = [
  new SlashCommandBuilder()
    .setName('on')
    .setDescription('🟢 Wejdź na służbę – rozpoczyna liczenie godzin')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('off')
    .setDescription('🔴 Zejdź ze służby – kończy liczenie godzin')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('top')
    .setDescription('🏆 Pokaż ranking czasu służby')
    .toJSON(),
];

// ===========================
// KLIENT DISCORD
// ===========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

// ===========================
// HTTP API (dla backendu)
// ===========================
const app = express();
app.use(express.json({ limit: '1mb' }));

// Weryfikacja sekretu API – wszystkie requesty muszą mieć poprawny sekret
const verifySecret = (req, res, next) => {
  const secret = req.headers['x-bot-secret'];
  const expected = (process.env.BOT_API_SECRET || '').replace(/^["']|["']$/g, '');
  if (!secret || secret !== expected) {
    return res.status(401).json({ success: false, message: 'Nieautoryzowany dostęp do Bot API' });
  }
  next();
};

app.use(verifySecret);

/**
 * POST /api/assign-role
 * Nadaje rolę użytkownikowi na serwerze Discord
 */
app.post('/api/assign-role', async (req, res) => {
  const { discordUserId, roleId } = req.body;

  if (!discordUserId || !roleId) {
    return res.status(400).json({ success: false, message: 'discordUserId i roleId są wymagane' });
  }

  try {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(discordUserId);
    const role = await guild.roles.fetch(roleId);

    if (!role) {
      return res.status(404).json({ success: false, message: 'Rola nie istnieje' });
    }

    await member.roles.add(role);
    console.log(`✅ Nadano rolę ${role.name} użytkownikowi ${member.user.tag}`);
    sendAuditLog('BOT_ASSIGN_ROLE', member.user.tag, `role:${role.id}`, { discordUserId, roleId, roleName: role.name, userTag: member.user.tag });

    res.json({ success: true, message: `Rola "${role.name}" nadana użytkownikowi ${member.user.tag}` });
  } catch (err) {
    console.error(`❌ Błąd nadawania roli: ${err.message}`);
    res.status(500).json({ success: false, message: `Błąd: ${err.message}` });
  }
});

/**
 * POST /api/remove-role
 * Usuwa rolę użytkownikowi na serwerze Discord
 */
app.post('/api/remove-role', async (req, res) => {
  const { discordUserId, roleId } = req.body;

  if (!discordUserId || !roleId) {
    return res.status(400).json({ success: false, message: 'discordUserId i roleId są wymagane' });
  }

  try {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(discordUserId);
    const role = await guild.roles.fetch(roleId);

    if (!role) {
      return res.status(404).json({ success: false, message: 'Rola nie istnieje' });
    }

    await member.roles.remove(role);
    console.log(`✅ Usunięto rolę ${role.name} od użytkownika ${member.user.tag}`);
    sendAuditLog('BOT_REMOVE_ROLE', member.user.tag, `role:${role.id}`, { discordUserId, roleId, roleName: role.name, userTag: member.user.tag });

    res.json({ success: true, message: `Rola "${role.name}" usunięta od ${member.user.tag}` });
  } catch (err) {
    console.error(`❌ Błąd usuwania roli: ${err.message}`);
    res.status(500).json({ success: false, message: `Błąd: ${err.message}` });
  }
});

/**
 * POST /api/swap-roles
 * Zamienia rolę stopnia gracza: usuwa starą, dodaje nową
 * Body: { discordUserId, fromRank, toRank }
 */
const RANK_ROLE_MAP = {
  'Drógówka': 'DISCORD_ROLE_DROGOWKA',
  'Drogówka': 'DISCORD_ROLE_DROGOWKA',
  'Kadet':    'DISCORD_ROLE_KADET',
  'Sierżant': 'DISCORD_ROLE_SIERZANT',
  'Z-szef':   'DISCORD_ROLE_ZSZEF',
  'Szef':     'DISCORD_ROLE_SZEF',
};

app.post('/api/swap-roles', async (req, res) => {
  const { discordUserId, fromRank, toRank } = req.body;

  if (!discordUserId || !fromRank || !toRank) {
    return res.status(400).json({ success: false, message: 'discordUserId, fromRank i toRank są wymagane' });
  }

  const fromEnv = RANK_ROLE_MAP[fromRank];
  const toEnv   = RANK_ROLE_MAP[toRank];
  const fromRoleId = fromEnv ? process.env[fromEnv] : null;
  const toRoleId   = toEnv   ? process.env[toEnv]   : null;

  if (!fromRoleId && !toRoleId) {
    return res.status(400).json({ success: false, message: 'Nieznane stopnie lub brak ID ról w .env' });
  }

  try {
    const guild  = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(discordUserId);
    const errors = [];

    // Usuń starą rolę
    if (fromRoleId) {
      const oldRole = await guild.roles.fetch(fromRoleId).catch(() => null);
      if (oldRole) {
        await member.roles.remove(oldRole).catch((e) => errors.push(`Usuwanie roli: ${e.message}`));
      } else {
        errors.push(`Rola ${fromRank} (${fromRoleId}) nie istnieje na serwerze`);
      }
    }

    // Dodaj nową rolę
    if (toRoleId) {
      const newRole = await guild.roles.fetch(toRoleId).catch(() => null);
      if (newRole) {
        await member.roles.add(newRole).catch((e) => errors.push(`Dodawanie roli: ${e.message}`));
      } else {
        errors.push(`Rola ${toRank} (${toRoleId}) nie istnieje na serwerze`);
      }
    }

    console.log(`🔄 Zamiana ról: ${member.user.tag} | ${fromRank} → ${toRank}${errors.length ? ` (błędy: ${errors.join(', ')})` : ''}`);
    sendAuditLog('BOT_SWAP_ROLES', member.user.tag, `user:${discordUserId}`, { discordUserId, fromRank, toRank, errors });

    res.json({ success: true, errors: errors.length ? errors : undefined });
  } catch (err) {
    console.error(`❌ swap-roles: ${err.message}`);
    res.status(500).json({ success: false, message: `Błąd: ${err.message}` });
  }
});

/**
 * POST /api/send-log
 * Wysyła wiadomość na kanał logów Discord
 */
app.post('/api/send-log', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ success: false, message: 'Treść wiadomości jest wymagana' });
  }

  try {
    const channel = await client.channels.fetch(process.env.DISCORD_LOG_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      return res.status(404).json({ success: false, message: 'Kanał logów nie znaleziony' });
    }

    // Formatuj wiadomość z timestampem
    const timestamp = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
    const formattedMessage = `\`[${timestamp}]\` ${message}`;

    await channel.send(formattedMessage);
    console.log(`📢 Wysłano log: ${message}`);
    sendAuditLog('BOT_SEND_LOG', client.user?.tag || 'KalkulatorBot', null, { message });

    res.json({ success: true, message: 'Log wysłany pomyślnie' });
  } catch (err) {
    console.error(`❌ Błąd wysyłania logu: ${err.message}`);
    res.status(500).json({ success: false, message: `Błąd: ${err.message}` });
  }
});

/**
 * GET /api/guild-roles
 * Zwraca listę ról z serwera Discord
 */
app.get('/api/guild-roles', async (req, res) => {
  try {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const roles = await guild.roles.fetch();

    const roleList = roles
      .filter((r) => !r.managed && r.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        hexColor: r.hexColor,
        position: r.position,
      }));

    res.json({ success: true, roles: roleList });
  } catch (err) {
    console.error(`❌ Błąd pobierania ról: ${err.message}`);
    res.status(500).json({ success: false, message: `Błąd: ${err.message}` });
  }
});

/**
 * POST /api/send-promotion
 * Wysyła awans/degradację jako embed na kanał promocji
 */
app.post('/api/send-promotion', async (req, res) => {
  const { embed, discordUserId } = req.body;
  const channelId = process.env.DISCORD_PROMOTIONS_CHANNEL_ID;
  if (!channelId) return res.status(400).json({ success: false, message: 'DISCORD_PROMOTIONS_CHANNEL_ID nie ustawiony w .env' });

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return res.status(404).json({ success: false, message: 'Kanał promocji nie znaleziony' });

    const payload = { embeds: [embed] };
    if (discordUserId) payload.content = `<@${discordUserId}>`;
    const msg = await channel.send(payload);
    console.log(`🏅 Wysłano awans/degradację na Discord`);
    res.json({ success: true, messageId: msg.id });
  } catch (err) {
    console.error(`❌ send-promotion: ${err.message}`);
    res.status(500).json({ success: false, message: `Błąd: ${err.message}` });
  }
});

/**
 * POST /api/send-cv
 * Wysyła zgłoszenie CV jako embed na kanał CV
 */
app.post('/api/send-cv', async (req, res) => {
  const { embed } = req.body;
  const channelId = process.env.DISCORD_CV_CHANNEL_ID;
  if (!channelId) return res.status(400).json({ success: false, message: 'DISCORD_CV_CHANNEL_ID nie ustawiony w .env' });

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return res.status(404).json({ success: false, message: 'Kanał CV nie znaleziony' });

    const msg = await channel.send({ embeds: [embed] });
    console.log(`📄 Wysłano CV na Discord`);
    res.json({ success: true, messageId: msg.id });
  } catch (err) {
    console.error(`❌ send-cv: ${err.message}`);
    res.status(500).json({ success: false, message: `Błąd: ${err.message}` });
  }
});

/**
 * POST /api/send-dismissal
 * Wystawia zwolnienie: usuwa wszystkie role stopnia z gracza, wysyła DM i embed na kanał awansów.
 * Body: { embed, discordUserId }
 */
app.post('/api/send-dismissal', async (req, res) => {
  const { embed, discordUserId, sendToChannel = true } = req.body;
  const channelId = process.env.DISCORD_DISMISSALS_CHANNEL_ID;
  const errors = [];
  let dmSent = false;
  let roleRemoved = false;

  try {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);

    if (discordUserId) {
      try {
        const member = await guild.members.fetch(discordUserId);

        // Usuń wszystkie role stopnia
        const uniqueEnvKeys = [...new Set(Object.values(RANK_ROLE_MAP))];
        for (const envKey of uniqueEnvKeys) {
          const roleId = (process.env[envKey] || '').replace(/^["']|["']$/g, '');
          if (!roleId) continue;
          const role = await guild.roles.fetch(roleId).catch(() => null);
          if (role && member.roles.cache.has(role.id)) {
            await member.roles.remove(role).catch((e) => errors.push(`Usuwanie roli ${role.name}: ${e.message}`));
            roleRemoved = true;
          }
        }

        // Wyślij DM do gracza
        const dmEmbed = {
          color: 0xff0000,
          title: '🚫 ZWOLNIENIE ZE SŁUŻBY',
          description: 'Zostałeś zwolniony ze służby w **Kalkulator Mandatów | Polskie RP**.',
          fields: embed?.fields || [],
          timestamp: new Date().toISOString(),
          footer: { text: 'Kalkulator Mandatów | Polskie RP' },
        };
        try {
          await member.send({ embeds: [dmEmbed] });
          dmSent = true;
        } catch (dmErr) {
          errors.push(`DM nieudany (prywatność Discord): ${dmErr.message}`);
        }
      } catch (memberErr) {
        errors.push(`Nie znaleziono członka serwera: ${memberErr.message}`);
      }
    }

    // Wyślij embed na kanał zwolnień (jeśli włączone)
    let messageId = null;
    if (sendToChannel && channelId) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel?.isTextBased()) {
          const payload = { embeds: [embed] };
          if (discordUserId) payload.content = `<@${discordUserId}>`;
          const msg = await channel.send(payload);
          messageId = msg.id;
        }
      } catch (chanErr) {
        errors.push(`Kanał: ${chanErr.message}`);
      }
    }

    console.log(`🚫 Zwolnienie wysłane${discordUserId ? ` dla ${discordUserId}` : ''}`);
    sendAuditLog('BOT_SEND_DISMISSAL', 'system', discordUserId || null, { discordUserId, errors });

    res.json({ success: true, messageId, dmSent, roleRemoved, errors: errors.length ? errors : undefined });
  } catch (err) {
    console.error(`❌ send-dismissal: ${err.message}`);
    res.status(500).json({ success: false, message: `Błąd: ${err.message}` });
  }
});

/**
 * POST /api/send-audit
 * Wysyła embed audytu na kanał DISCORD_AUDIT_CHANNEL_ID.
 * Wywoływane automatycznie przez backend po każdej ważnej akcji.
 */
app.post('/api/send-audit', async (req, res) => {
  const { embed } = req.body;
  const channelId = process.env.DISCORD_AUDIT_CHANNEL_ID;
  if (!channelId) {
    return res.status(400).json({ success: false, message: 'DISCORD_AUDIT_CHANNEL_ID nie ustawiony w .env' });
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      return res.status(404).json({ success: false, message: 'Kanał audytu nie znaleziony' });
    }
    await channel.send({ embeds: [embed] });
    console.log(`🔍 Wysłano log audytu: ${embed?.title || '—'}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`❌ send-audit: ${err.message}`);
    res.status(500).json({ success: false, message: `Błąd: ${err.message}` });
  }
});

// ===========================
// EVENTY DISCORD
// ===========================
client.once('ready', async () => {
  console.log(`\n🤖 Bot zalogowany jako: ${client.user.tag}`);
  console.log(`📡 Obsługiwany serwer: ${process.env.DISCORD_GUILD_ID}`);
  console.log(`🔵 HTTP API nasłuchuje na porcie ${process.env.BOT_PORT || 3001}\n`);

  client.user.setActivity('Kalkulator Mandatów | Polskie RP', {
    type: ActivityType.Watching,
  });

  // Rejestracja komend slash (guild scope – działają natychmiast)
  if (!process.env.DISCORD_CLIENT_ID) {
    console.warn('⚠️  DISCORD_CLIENT_ID nie ustawiony – komendy slash nie zostaną zarejestrowane');
    return;
  }
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: slashCommands }
    );
    console.log(`✅ Zarejestrowano ${slashCommands.length} komend slash`);
  } catch (err) {
    console.error(`❌ Błąd rejestracji komend: ${err.message}`);
  }
});

// ===========================
// KOMENDY SLASH: /on /off /top
// ===========================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user, guild } = interaction;

  // ────────── /on ──────────
  if (commandName === 'on') {
    await interaction.deferReply();
    try {
      const result = await callBackend('POST', '/api/bot-duty/on', {
        discordId: user.id,
        discordUsername: user.username,
        guildId: guild?.id || null,
      });

      if (!result.success) {
        const msg = result.alreadyOnDuty
          ? '⚠️ Już jesteś na służbie! Użyj `/off` żeby zejść ze służby.'
          : `❌ Błąd: ${result.message || 'nieznany błąd'}`;
        await interaction.editReply(msg);
        return;
      }

      const embed = {
        color: 0x00cc66,
        title: '🟢 Wejście na służbę',
        description: `**${user.username}** wszedł na służbę`,
        timestamp: new Date().toISOString(),
        footer: { text: 'Kalkulator Mandatów | Polskie RP' },
      };

      await interaction.editReply({ embeds: [embed] });

      sendAuditLog('BOT_DUTY_ON', user.username, null, { discordId: user.id });
    } catch (err) {
      console.error(`❌ /on error: ${err.message}`);
      await interaction.editReply('❌ Błąd połączenia z serwerem. Spróbuj ponownie.');
    }
    return;
  }

  // ────────── /off ──────────
  if (commandName === 'off') {
    await interaction.deferReply();
    try {
      const result = await callBackend('POST', '/api/bot-duty/off', {
        discordId: user.id,
      });

      if (!result.success) {
        const msg = result.notOnDuty
          ? '⚠️ Nie jesteś na służbie! Użyj `/on` żeby wejść na służbę.'
          : `❌ Błąd: ${result.message || 'nieznany błąd'}`;
        await interaction.editReply(msg);
        return;
      }

      const sessionTime = formatMinutes(result.durationMinutes || 0);
      const totalTime = formatMinutes(result.totalMinutes || 0);

      // Wykryj stopień gracza z ról Discord (od najwyższego)
      const RANK_PRIORITY = ['Szef', 'Z-szef', 'Sierżant', 'Kadet', 'Drogówka'];
      let detectedRank = null;
      try {
        const member = await guild.members.fetch(user.id);
        for (const rankName of RANK_PRIORITY) {
          const envKey = RANK_ROLE_MAP[rankName];
          if (!envKey) continue;
          const roleId = (process.env[envKey] || '').replace(/^["']|["']$/g, '');
          if (roleId && member.roles.cache.has(roleId)) {
            detectedRank = rankName;
            break;
          }
        }
      } catch (e) {
        console.error(`⚠️ Błąd pobierania ról gracza: ${e.message}`);
      }

      // Oblicz zarobki na podstawie stawki godzinowej
      let earnedStr = null;
      if (detectedRank) {
        try {
          const salaryRes = await callBackend('GET', '/api/salary-config');
          const rateEntry = salaryRes.data?.find((r) => r.rankName === detectedRank);
          const hourlyRate = rateEntry?.hourlyRate || 0;
          if (hourlyRate > 0) {
            const earned = Math.round((result.durationMinutes / 60) * hourlyRate);
            earnedStr = `${earned.toLocaleString('pl-PL')} zł`;
          }
        } catch (e) {
          console.error(`⚠️ Błąd pobierania stawek: ${e.message}`);
        }
      }

      const fields = [
        { name: '⏱️ Czas tej zmiany', value: sessionTime, inline: true },
        { name: '📊 Łączny czas służby', value: totalTime, inline: true },
      ];
      if (earnedStr) {
        fields.push({ name: '💰 Zarobiono', value: earnedStr, inline: true });
      }

      const embed = {
        color: 0xff4444,
        title: '🔴 Zejście ze służby',
        description: `**${user.username}** zszedł ze służby`,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'Kalkulator Mandatów | Polskie RP' },
      };

      await interaction.editReply({ embeds: [embed] });

      sendAuditLog('BOT_DUTY_OFF', user.username, null, {
        discordId: user.id,
        durationMinutes: result.durationMinutes,
        totalMinutes: result.totalMinutes,
      });
    } catch (err) {
      console.error(`❌ /off error: ${err.message}`);
      await interaction.editReply('❌ Błąd połączenia z serwerem. Spróbuj ponownie.');
    }
    return;
  }

  // ────────── /top ──────────
  if (commandName === 'top') {
    await interaction.deferReply();
    try {
      const result = await callBackend('GET', `/api/bot-duty/stats${guild?.id ? `?guildId=${guild.id}` : ''}`);

      if (!result.success || !result.data?.length) {
        await interaction.editReply('📊 Brak danych o czasie służby. Nikt jeszcze nie był na służbie.');
        return;
      }

      const medals = ['🥇', '🥈', '🥉'];
      const leaderboard = result.data
        .slice(0, 10)
        .map((entry, i) => {
          const medal = medals[i] || `**${i + 1}.**`;
          return `${medal} **${entry.discordUsername}** — ${formatMinutes(entry.totalMinutes)} *(${entry.sessions} zmian)*`;
        })
        .join('\n');

      const embed = {
        color: 0xffd700,
        title: '🏆 Ranking czasu służby',
        description: leaderboard,
        timestamp: new Date().toISOString(),
        footer: { text: 'Kalkulator Mandatów | Polskie RP' },
      };

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(`❌ /top error: ${err.message}`);
      await interaction.editReply('❌ Błąd połączenia z serwerem.');
    }
    return;
  }
});

client.on('guildMemberAdd', async (member) => {
  console.log(`👤 Nowy członek: ${member.user.tag}`);
});

client.on('error', (err) => {
  console.error(`❌ Discord błąd: ${err.message}`);
});

// ===========================
// START
// ===========================
// Railway injectuje PORT automatycznie; lokalnie używamy BOT_PORT
const BOT_PORT = process.env.PORT || process.env.BOT_PORT || 3001;

app.listen(BOT_PORT, () => {
  console.log(`\n🚀 Bot HTTP API uruchomione na porcie ${BOT_PORT}`);
});

// Zaloguj bota do Discord
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error(`❌ Błąd logowania bota: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM – zamykanie bota...');
  client.destroy();
  process.exit(0);
});
