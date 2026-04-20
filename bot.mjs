import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} from '@whiskeysockets/baileys'

import pino from 'pino'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import express from 'express'

const logger = pino({ level: 'silent' })

// ================= OWNERS =================
const OWNERS = [
  "2347044625110@s.whatsapp.net",
  "2349021540840@s.whatsapp.net"
]

// auto owner checker
const isOwner = (jid) => OWNERS.includes(jid)

// ================= DATABASE =================
const DB_FILE = './db.json'

let db = {
  warns: {},
  groups: {} // { antilink: false default }
}

// ================= EXPRESS KEEP ALIVE =================
const app = express()
app.get('/', (_, res) => res.send('BOT RUNNING'))
app.listen(3000)

// ================= LOAD DB =================
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE))
  } catch {}
}

const saveDB = () =>
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))

// ================= GROUP DEFAULT =================
const getGroup = (jid) => {
  db.groups[jid] ??= { antilink: false } // OFF BY DEFAULT
  return db.groups[jid]
}

// ================= LINK DETECTOR (VERY STRONG) =================
const linkRegex =
  /(https?:\/\/|www\.|wa\.me|t\.me|bit\.ly|tinyurl|discord\.gg|chat\.whatsapp\.com|\.com|\.net|\.org|\.io|\.xyz)/gi

// ================= WARNING SYSTEM =================
async function handleWarnKick(sock, jid, user) {
  const count = db.warns[user] ?? 0

  if (count >= 3) {
    if (isOwner(user)) return

    await sock.groupParticipantsUpdate(jid, [user], 'remove')

    db.warns[user] = 0
    saveDB()

    await sock.sendMessage(jid, {
      text: `🚫 @${user.split('@')[0]} removed after 3 warns`,
      mentions: [user]
    })
  }
}

// ================= REACTION SYSTEM =================
const react = async (sock, msg, emoji) => {
  await sock.sendMessage(msg.key.remoteJid, {
    react: { text: emoji, key: msg.key }
  })
}

// ================= PLUGIN SYSTEM (OWNER ONLY) =================
const plugins = new Map()

function loadPlugins() {
  if (!fs.existsSync('./plugins')) return
  const files = fs.readdirSync('./plugins').filter(f => f.endsWith('.js'))

  for (const file of files) {
    const plugin = import(`./plugins/${file}`)
    plugins.set(file.replace('.js', ''), plugin)
  }
}

// ================= BOT START =================
async function start(session) {

  const { state, saveCreds } = await useMultiFileAuthState(`auth/${session}`)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false
  })

  // ================= CONNECTION =================
  sock.ev.on('connection.update', (u) => {

    if (u.qr) qrcode.generate(u.qr, { small: true })

    if (u.connection === 'open')
      console.log(`✅ ${session} connected`)

    if (u.connection === 'close') {
      if (u.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        start(session)
      }
    }
  })

  sock.ev.on('creds.update', saveCreds)

  // ================= MESSAGE HANDLER =================
  sock.ev.on('messages.upsert', async ({ messages }) => {

    const msg = messages[0]
    if (!msg.message) return

    const jid = msg.key.remoteJid
    const sender = msg.key.participant || jid

    const isGroup = jid.endsWith('@g.us')
    const group = isGroup ? getGroup(jid) : null

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ''

    const reply = (t) => sock.sendMessage(jid, { text: t })

    // ================= ANTI LINK =================
    if (
      isGroup &&
      group?.antilink &&
      text &&
      linkRegex.test(text.replace(/\s+/g, ''))
    ) {
      if (!isOwner(sender)) {

        await sock.sendMessage(jid, { delete: msg.key })

        db.warns[sender] = (db.warns[sender] ?? 0) + 1
        saveDB()

        await handleWarnKick(sock, jid, sender)
        return
      }
    }

    // ================= NO PREFIX FAST HANDLER =================
    if (!text.startsWith('.')) return

    const cmd = text.slice(1).split(' ')[0]

    // ================= COMMAND MAP (FAST ENGINE) =================
    const commands = {

      // ================= MENU =================
      menu: async () => {
        await react(sock, msg, '📜')

        await reply(`
✨ 𝑩𝑶𝑻 𝑴𝑬𝑵𝑼 ✨

👮 ADMIN COMMANDS
.antilink .kick .promote .demote

⚠️ MODERATION
.warn

👤 USER
.getpp

👁 MEDIA
.vv
        `)
      },

      // ================= ANTILINK TOGGLE =================
      antilink: async () => {

        if (!isGroup) return reply('Group only')

        const meta = await sock.groupMetadata(jid)
        const admins = meta.participants
          .filter(p => p.admin)
          .map(p => p.id)

        if (!isOwner(sender) && !admins.includes(sender))
          return reply('Admins only')

        group.antilink = !group.antilink
        saveDB()

        await react(sock, msg, '🔗')
        await reply(`Antilink: ${group.antilink ? 'ON' : 'OFF'}`)
      },

      // ================= WARN SYSTEM =================
      warn: async () => {

        const target =
          msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
          sender

        db.warns[target] = (db.warns[target] ?? 0) + 1
        saveDB()

        await react(sock, msg, '⚠️')
        await reply(`Warn: ${db.warns[target]}`)

        await handleWarnKick(sock, jid, target)
      },

      // ================= GET PROFILE PIC =================
      getpp: async () => {

        const target =
          msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
          sender

        let pp

        try {
          pp = await sock.profilePictureUrl(target, 'image')
        } catch {
          pp = 'https://i.imgur.com/1X8cV7x.png'
        }

        await react(sock, msg, '🖼')

        // AUTO FORWARD TO OWNERS ONLY
        for (const owner of OWNERS) {
          await sock.sendMessage(owner, {
            image: { url: pp },
            caption: `📤 Enjoy`
          })
        }
      },

      // ================= VIEW ONCE BYPASS =================
      vv: async () => {

        const quoted =
          msg.message.extendedTextMessage?.contextInfo?.quotedMessage

        if (!quoted) return reply('Reply to view-once')

        const key = Object.keys(quoted)[0]
        const content = quoted[key]

        let type = 'image'
        if (key === 'videoMessage') type = 'video'
        if (key === 'audioMessage') type = 'audio'

        const stream = await downloadContentFromMessage(content, type)

        let buffer = Buffer.from([])
        for await (const chunk of stream)
          buffer = Buffer.concat([buffer, chunk])

        const out = { mimetype: content.mimetype }

        if (type === 'image') out.image = buffer
        if (type === 'video') out.video = buffer
        if (type === 'audio') out.audio = buffer

        await react(sock, msg, '👁')
        await sock.sendMessage(jid, out)
      },

      // ================= GROUP CONTROL =================
      kick: async () => {
        if (!isGroup) return

        const target =
          msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]

        if (!target) return

        await sock.groupParticipantsUpdate(jid, [target], 'remove')
      },

      promote: async () => {
        if (!isGroup) return

        const target =
          msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]

        if (!target) return

        await sock.groupParticipantsUpdate(jid, [target], 'promote')
      },

      demote: async () => {
        if (!isGroup) return

        const target =
          msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]

        if (!target) return

        await sock.groupParticipantsUpdate(jid, [target], 'demote')
      }
    }

    // ================= EXECUTE =================
    if (commands[cmd]) {
      await commands[cmd]()
    }
  })
}

// ================= START MULTI SESSION =================
['session1', 'session2'].forEach(start)