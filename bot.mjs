import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} from "@whiskeysockets/baileys"

import sharp from "sharp"
import { createCanvas } from "canvas"
import pino, { levels } from "pino"
import fs from "fs"
import express from "express"
import QRCode from "qrcode"
import path from "path"
import { fileURLToPath } from "url"
import os from "os"
import moment from "moment-timezone"
import ffmpegPath from "ffmpeg-static"
import { exec } from "child_process"
import https from "https"


const __dirname = path.dirname(fileURLToPath(import.meta.url))

const AUTH_FOLDER = path.join(__dirname, "auth")

const app = express()
const logger = pino({ level : "silent"})

// Use host-provided port OR fallback to 3000
const PORT = process.env.PORT || 3000

 let qrCount = 0

app.get("/", (req, res) => {
  try {
    if (!CURRENT_QR) {
      return res.send("✅ Bot is connected and running")
    }

    res.send(`
      <h2>📱 Scan QR</h2>
      <img src="${CURRENT_QR}" />
    `)
  } catch {
    res.send("Server error")
  }
})

app.get("/ping", (req, res) => res.send("alive"))

app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`)
})

// ===== GLOBAL CRASH PROTECTION =====
process.on("uncaughtException", (err) => {
  console.log("🔥 Uncaught Exception:", err)
})

process.on("unhandledRejection", (err) => {
  console.log("🔥 Unhandled Rejection:", err)
})

// ===== GLOBAL STATES =====
let CURRENT_QR = ""
let reconnecting = false


// ================= CONFIG =================
const PREFIX = "."
const BOT_STATS = {
  startTime: Date.now(),
  messages: 0,
  commands: 0
}

let warns = {} // already exists in your code, keep it global
// ================= WARN DATABASE =================
const WARN_DB = global.WARN_DB || (global.WARN_DB = {})

const WARN_LIMIT = 3

const saveWarnDB = () => {
  try {
    fs.writeFileSync(
      "./warn_db.json",
      JSON.stringify(WARN_DB, null, 2)
    )
  } catch (e) {
    console.log("WARN SAVE ERROR:", e)
  }
}

const loadWarnDB = () => {
  try {
    if (fs.existsSync("./warn_db.json")) {
      Object.assign(
        WARN_DB,
        JSON.parse(fs.readFileSync("./warn_db.json"))
      )
    }
  } catch (e) {
    console.log("WARN LOAD ERROR:", e)
  }
}

loadWarnDB()

const addWarn = async (sock, jid, user, reason) => {
  if (!WARN_DB[jid]) WARN_DB[jid] = {}
  if (!WARN_DB[jid][user]) WARN_DB[jid][user] = []

  WARN_DB[jid][user].push({
    reason,
    time: Date.now()
  })

  const count = WARN_DB[jid][user].length

  if (count >= WARN_LIMIT) {
    try {
      await sock.groupParticipantsUpdate(jid, [user], "remove")

      delete WARN_DB[jid][user]

      await sock.sendMessage(jid, {
        text: `🚫 @${user.split("@")[0]} removed (${reason})`,
        mentions: [user]
      })
    } catch (e) {
      console.log("WARN REMOVE ERROR:", e)
    }
  } else {
    await sock.sendMessage(jid, {
      text: `⚠️ @${user.split("@")[0]} warning ${count}/${WARN_LIMIT}\nReason: ${reason}`,
      mentions: [user]
    })
  }

  saveWarnDB()
}

// ===== OPTIONAL LOCAL BACKUP =====
const BACKUP_DIR = "./backups"
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR)

// ===== VERSION FILE =====
const VERSION_FILE = "./version.json"

const getVersionData = () => {
  if (!fs.existsSync(VERSION_FILE)) {
    fs.writeFileSync(
      VERSION_FILE,
      JSON.stringify({
        version: process.env.BOT_VERSION || "1.0.0",
        lastUpdate: new Date().toISOString(),
        rollbackAvailable: false
      }, null, 2)
    )
  }

  return JSON.parse(fs.readFileSync(VERSION_FILE))
}

const saveVersionData = (data) => {
  fs.writeFileSync(VERSION_FILE, JSON.stringify(data, null, 2))
}

// const BOT_VERSION = {
//   version: "2.0.0",
//   releaseDate: "2026-04-28",
//   owner: "GIBBORLEE",
//   changelog: [
//     "🧠 Smart menu system upgraded",
//     "🔐 Advanced mode control added",
//     "🌐 Live cyber banner system",
//     "⚡ Performance optimizations",
//     "🛡️ Stability improvements"
//   ]
// }

// ===== SAFE DEPLOY HOOK =====
const triggerRenderDeploy = async () => {
  return new Promise((resolve, reject) => {
    const hook = process.env.RENDER_DEPLOY_HOOK

    if (!hook) {
      return reject(new Error("Missing RENDER_DEPLOY_HOOK"))
    }

    const req = https.request(hook, { method: "POST" }, (res) => {
      let data = ""

      res.on("data", chunk => data += chunk)

      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data)
        } else {
          reject(new Error(`Deploy failed: ${res.statusCode}`))
        }
      })
    })

    req.on("error", reject)
    req.end()
  })
}


// ===== LOCAL BACKUP =====
const createBackup = () => {
  const timestamp = Date.now()
  const backupPath = `${BACKUP_DIR}/backup-${timestamp}.json`

  const snapshot = {
    owners: BOT_OWNERS,
    settings: SETTINGS,
    groupSettings: GROUP_SETTINGS,
    timestamp
  }

  fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2))

  return backupPath
}

// ===== RESTORE LAST BACKUP =====
const restoreLatestBackup = () => {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".json"))
    .sort()

  if (!files.length) return null

  const latest = files[files.length - 1]
  const data = JSON.parse(
    fs.readFileSync(`${BACKUP_DIR}/${latest}`)
  )

  BOT_OWNERS = data.owners || BOT_OWNERS
  SETTINGS = data.settings || SETTINGS
  GROUP_SETTINGS = data.groupSettings || GROUP_SETTINGS

  saveOwners()
  saveSettings()
  saveGroupSettings()

  return latest
}

// // 🔥 LATEST VERSION (change this when you update bot)
// const LATEST_VERSION = "2.1.0"

// // 🧠 VERSION CHECKER
// const isOutdated = () => BOT_VERSION.version !== LATEST_VERSION


// ==== STICKER META ====

const STICKER_META = {
  packname: "GIBBORLEE BOT 🤖",
  author: "Sticker Engine v2"
}

const createSticker = async (buffer) => {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Invalid buffer")
  }

  try {
    return await sharp(buffer)
      .resize(512, 512, { fit: "contain" })
      .webp({ quality: 80 })
      .toBuffer()
  } catch (e) {
    console.log("Sticker error:", e)
    throw new Error("Unsupported image format")
  }
}

  // =====MENU COMMANDS ====

const COMMANDS = {
  // 🛡️ PROTECTION
  antilink: "🚫 Block WhatsApp & external links",
  antibadword: "🧼 Auto-remove offensive words",
  antidelete: "🧠 Recover deleted messages",
  antistatus: "👁️ Block status viewing detection",
  antistatusmention: "📢 Block status mentions",

  // 👥 ADMIN
  kick: "👢 Remove a user from group",
  add: "➕ Add user to group",
  promote: "⬆️ Promote user to admin",
  demote: "⬇️ Remove admin privileges",
  tagall: "📣 Mention all members",
  hidetag: "👻 Hidden group mention",
  tagonline: "🟢 Tag active members",

  // ⚙️ GROUP
  setname: "✏️ Change group name",
  setdesc: "📝 Update group description",
  groupinfo: "📊 View group analytics",
  grouplink: "🔗 Get invite link",
  revoke: "♻️ Reset invite link",
  lock: "🔒 Lock group (admins only)",
  unlock: "🔓 Unlock group chat",

  // 🎨 MEDIA
  vv: "👁️ Recover view-once media",
  pp: "🖼️ HD profile picture fetch",
  sticker: "🎭 Convert image to sticker",
  stickergif: "🎬 Video → animated sticker",
  memesticker: "😂 Text → meme sticker",
  captionsticker: "✍️ Caption → sticker",
  stickerpack: "📦 Create custom sticker pack",

  // 👑 OWNER
  addowner: "👑 Add bot owner",
  delowner: "🗑️ Remove bot owner",
  owners: "📋 View all owners",
  restart: "🔄 Restart bot system",
  shutdown: "⛔ Shutdown bot safely",
  broadcast: "📢 Send message to all chats",
  ban: "🚷 Block user access",
  unban: "✅ Unblock user access",

    // ⚠️ WARNING SYSTEM
  warn: "⚠️ Warn a user (auto kick at 3 warns)",
  warnlist: "📋 View all warnings in group",
  warninfo: "👤 Check a user warning history",
  unwarn: "🧹 Clear user warnings",

  // 🔐 MODE
 mode: "⚙️ Switch bot operating mode (public/private/group/dm/auto)",

  // ℹ️ INFO
  alive: "💚 Check bot status",
  whoami: "🆔 Show your WhatsApp ID",
  version: "📦 View bot version",
  stats: "📊 Bot usage statistics",
  ping: "🏓 Check bot response speed (latency test)",

  // 🛠️ UPDATE
  updatebot: "🚀 Deploy latest version",
  backupbot: "💾 Create system backup",
  rollbackbot: "♻️ Restore previous backup",

  // 📦 STICKER PACK SYSTEM
packcreate: "📦 Create a new sticker pack",
packadd: "➕ Add sticker to pack",
packview: "📖 View your sticker pack",
packdelete: "🗑️ Delete a sticker pack",
packexport: "📤 Export pack as file"
}

const groupCommands = (cmdObj) => {
  const groups = {
    "🛡️ GROUP PROTECTION": [],
    "👥 ADMIN MODERATION": [],
    "⚙️ GROUP MANAGEMENT": [],
    "⚠️ WARNING SYSTEM": [],
    "🎨 MEDIA": [],
    "📦 STICKER PACK SYSTEM": [],
    "👑 OWNER CONTROL": [],
    "🔐 MODE CONTROL": [],
    "ℹ️ INFO": [],
    "🛠️ BOT UPDATE": []
  }

  for (const [cmd, desc] of Object.entries(cmdObj)) {
    const line = `│ .${cmd} → ${desc}`

    if (["antilink","antibadword","antidelete","antistatus","antistatusmention"].includes(cmd)) {
      groups["🛡️ GROUP PROTECTION"].push(line)
    }

    else if (["kick","add","promote","demote","warn","tagall","hidetag","tagonline"].includes(cmd)) {
      groups["👥 ADMIN MODERATION"].push(line)
    }

    else if (["setname","setdesc","groupinfo","grouplink","revoke","lock","unlock"].includes(cmd)) {
      groups["⚙️ GROUP MANAGEMENT"].push(line)
    }

    else if (["warn","warnlist","warninfo","unwarn"].includes(cmd)) {
  groups["⚠️ WARNING SYSTEM"].push(line)
}

    else if (["vv","pp","sticker","stickergif","memesticker","captionsticker","stickerpack"].includes(cmd)) {
      groups["🎨 MEDIA"].push(line)
    }

    else if (["addowner","delowner","owners","restart","shutdown","broadcast","ban","unban"].includes(cmd)) {
      groups["👑 OWNER CONTROL"].push(line)
    }

    else if (["mode"].includes(cmd)) {
      groups["🔐 MODE CONTROL"].push(line)
    }

    else if (["alive", "ping", "whoami","version","stats"].includes(cmd)) {
      groups["ℹ️ INFO"].push(line)
    }

    else if (["updatebot","backupbot","rollbackbot"].includes(cmd)) {
      groups["🛠️ BOT UPDATE"].push(line)
    }

else if (["packcreate","packadd","packview","packdelete","packexport"].includes(cmd)) {
  groups["📦 STICKER PACK SYSTEM"].push(`│ .${cmd} → ${cmdObj[cmd]}`)
}
  }

  return groups
}


const menuHeaders = [
  "╭─❖ 🤖 𝐆𝐈𝐁𝐁𝐎𝐑𝐋𝐄𝐄 𝐁𝐎𝐓 𝐌𝐄𝐍𝐔 ❖─╮",
  "╭─⚡ 𝐒𝐘𝐒𝐓𝐄𝐌 𝐎𝐍𝐋𝐈𝐍𝐄 • 𝐆𝐈𝐁𝐁𝐎𝐑𝐋𝐄𝐄 ⚡─╮",
  "╭─🚀 𝐌𝐔𝐋𝐓𝐈-𝐅𝐔𝐍𝐂𝐓𝐈𝐎𝐍 𝐏𝐀𝐍𝐄𝐋 🚀─╮",
  "╭─🔥 𝐏𝐎𝐖𝐄𝐑 𝐌𝐎𝐃𝐄: 𝐀𝐂𝐓𝐈𝐕𝐄 🔥─╮",
  "╭─🧠 𝐒𝐌𝐀𝐑𝐓 𝐁𝐎𝐓 𝐈𝐍𝐓𝐄𝐑𝐅𝐀𝐂𝐄 🧠─╮",
  "╭─📡 𝐂𝐎𝐍𝐍𝐄𝐂𝐓𝐄𝐃 • 𝐖𝐇𝐀𝐓𝐒𝐀𝐏𝐏 𝐍𝐄𝐓𝐖𝐎𝐑𝐊 📡─╮",
  "╭─🛡️ 𝐒𝐄𝐂𝐔𝐑𝐈𝐓𝐘 𝐒𝐘𝐒𝐓𝐄𝐌 𝐀𝐂𝐓𝐈𝐕𝐄 🛡️─╮",
  "╭─⚙️ 𝐄𝐍𝐆𝐈𝐍𝐄 𝐋𝐎𝐀𝐃𝐄𝐃 • 𝐑𝐄𝐀𝐃𝐘 ⚙️─╮",
  "╭─🌐 𝐆𝐋𝐎𝐁𝐀𝐋 𝐍𝐄𝐓𝐖𝐎𝐑𝐊 𝐎𝐍𝐋𝐈𝐍𝐄 🌐─╮",
  "╭─💥 𝐔𝐋𝐓𝐑𝐀 𝐏𝐄𝐑𝐅𝐎𝐑𝐌𝐀𝐍𝐂𝐄 💥─╮",
  "╭─📊 𝐋𝐈𝐕𝐄 𝐂𝐎𝐍𝐓𝐑𝐎𝐋 𝐏𝐀𝐍𝐄𝐋 📊─╮",
  "╭─🔔 𝐑𝐄𝐀𝐋-𝐓𝐈𝐌𝐄 𝐌𝐎𝐍𝐈𝐓𝐎𝐑 🔔─╮",
  "╭─👑 𝐎𝐖𝐍𝐄𝐑 𝐂𝐎𝐍𝐓𝐑𝐎𝐋 𝐃𝐀𝐒𝐇𝐁𝐎𝐀𝐑𝐃 👑─╮"
]

const getHeader = () =>
  menuHeaders[Math.floor(Math.random() * menuHeaders.length)]


// ================= PERMISSION SYSTEM =================

// extract only numbers
const getUserId = (jid = "") => {
  if (typeof jid !== "string") return ""
  return jid.split("@")[0].replace(/\D/g, "")
}

// normalize jid safely
const normalizeJid = (jid = "") => {
  if (typeof jid !== "string") return ""

  jid = jid.split(":")[0]

  if (jid.includes("@lid")) {
    jid = jid.replace("@lid", "")
  }

  return jid.includes("@")
    ? jid.split("@")[0] + "@s.whatsapp.net"
    : ""
}

// check roles
const getPermissions = ({ msg, sock, BOT_OWNERS, groupAdmins }) => {
  const senderRaw = msg.key?.participant || msg.key?.remoteJid || ""
  const sender =
  msg.key.participant ||
  msg.key.remoteJid ||
  ""
  const botId = normalizeJid(sock.user?.id || "")

  const senderId = getUserId(sender)
  const botUserId = getUserId(botId)

  const ownerIds = BOT_OWNERS.map(o =>
    getUserId(normalizeJid(o))
  )

  const isBot = msg.key.fromMe

  const isOwner =
    isBot || // 🔥 bot always owner
    senderId === botUserId ||
    ownerIds.includes(senderId)

  const isAdmin = groupAdmins
    ?.map(a => normalizeJid(a))
    .map(getUserId)
    .includes(senderId)

  return {
    sender,
    senderId,
    botId,
    isBot,
    isOwner,
    isAdmin
  }
}

// ================= FILES =================
const GROUP_SETTINGS_FILE = "./group-settings.json"
const STORE_FILE = "./msg-store.json"
const OWNERS_FILE = "./owners.json"
const SETTINGS_FILE = "./settings.json"

let GROUP_SETTINGS = fs.existsSync(GROUP_SETTINGS_FILE) ? JSON.parse(fs.readFileSync(GROUP_SETTINGS_FILE)) : {}

let SETTINGS = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE)) : {}

let MSG_STORE = fs.existsSync(STORE_FILE) ? JSON.parse(fs.readFileSync(STORE_FILE)) : {}

let BOT_OWNERS = fs.existsSync(OWNERS_FILE) ? JSON.parse(fs.readFileSync(OWNERS_FILE)) : []

const saveGroupSettings = () => fs.writeFileSync(GROUP_SETTINGS_FILE, JSON.stringify(GROUP_SETTINGS, null, 2))

const saveSettings = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(SETTINGS, null, 2))

let STICKER_PACKS = fs.existsSync("./stickerpacks.json")
  ? JSON.parse(fs.readFileSync("./stickerpacks.json"))
  : {}

const saveStickerPacks = () =>
  fs.writeFileSync("./stickerpacks.json", JSON.stringify(STICKER_PACKS, null, 2))

// 🔥 FORCE GLOBAL DEFAULT MODE
if (!SETTINGS["global"]) {
  SETTINGS["global"] = { mode: "public" }
  saveSettings()
}

// 🔥 FIX CORRUPTED MODE
if (!["public", "private"].includes(SETTINGS["global"]?.mode)) {
  SETTINGS["global"].mode = "public"
  saveSettings()
}

const saveStore = () => fs.writeFileSync(STORE_FILE, JSON.stringify(MSG_STORE, null, 2))
const saveOwners = () => fs.writeFileSync(OWNERS_FILE, JSON.stringify(BOT_OWNERS, null, 2))

const getGroup_Settings = (jid) => {
  if (!GROUP_SETTINGS[jid]) {
    GROUP_SETTINGS[jid] = { 
      antidelete: false,
      antibadword: false, 
      antilink: false,
      antistatus: false,
      antistatus_mention: false
    }
    saveGroupSettings()
  }
  return GROUP_SETTINGS[jid]
}

const getSettings = (jid) => {
   if (!SETTINGS[jid]) {
    SETTINGS[jid] = {
      mode: "public",
    }
    saveSettings()
  }
    return SETTINGS[jid]
  }


// ================= START =================
async function start(session) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(`${AUTH_FOLDER}/${session}`)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      emitOwnEvents: true,
      syncFullHistory: false,
      browser: ["Chrome (Linux)", "Chrome", "120.0.0"],

        // 🔥 stability boost
  connectTimeoutMs: 60000,
  keepAliveIntervalMs: 25000,
  defaultQueryTimeoutMs: 60000

    })

    sock.ev.on("creds.update", saveCreds)

    // ===== CONNECTION HANDLER =====
    sock.ev.on("connection.update", async (u) => {
      const { connection, qr, lastDisconnect } = u

      if (qr) {
        qrCount++
  if (qrCount > 6) {
    console.log("❌ Too many QR attempts, restarting clean session...")
    process.exit(1)
  }
        CURRENT_QR = await QRCode.toDataURL(qr)
        console.log("📱 QR READY")
      }

      if (connection === "open") {
        CURRENT_QR = ""
        reconnecting = false

        console.log("✅ Bot connected")

        const botId = normalizeJid(sock.user.id)
const myNumber = ["2347044625110@s.whatsapp.net", "2349021540840@s.whatsapp.net"] // 👈 PUT YOUR NUMBER

const ids = [botId, myNumber]

ids.forEach(id => {
  const clean = normalizeJid(id)
  if (!BOT_OWNERS.includes(clean)) {
    BOT_OWNERS.push(clean)
  }
})

saveOwners()

console.log("🤖 Logged in as:", botId)
console.log("👑 Owners:", BOT_OWNERS)

        // ✅ PREVENT MULTIPLE INTERVALS
        
          setInterval(() => {
              sock.sendPresenceUpdate("unavailable")
          }, 60000)
        }

      if (connection === "close") {
        
         const statusCode = lastDisconnect?.error?.output?.statusCode

    console.log("❌ Disconnected:", statusCode)

    // ❌ Logged out (DO NOT reconnect)
    if (statusCode === 401 || statusCode === 405) {
      console.log("⚠️ Logged out → delete auth folder")
      return
    }

      if (!reconnecting) {
    reconnecting = true

    setTimeout(() => {
      reconnecting = false
      start(session)
    }, 5000)
  }

    // 🔄 Safe reconnect
    console.log("🔄 Reconnecting safely in 5s...")
    setTimeout(() => start(session), 5000)
      }
    })

  const react = (jid, key, emoji) =>
    sock.sendMessage(jid, { react: { text: emoji, key } })


 // ================= EVENTS =================

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0]
    const jid = msg.key.remoteJid || ""
    if (!msg.message) return
    let groupAdmins = []

if (jid.endsWith("@g.us")) {
  const meta = await sock.groupMetadata(jid)
  groupAdmins = meta.participants
    .filter(p => p.admin)
    .map(p => p.id)
}

// ✅ NEW PERMISSION SYSTEM
const {
  sender,
  isOwner,
  isAdmin,
  isBot
} = getPermissions({ msg, sock, BOT_OWNERS, groupAdmins })
    // const sender = normalizeJid(msg.key.participant || msg.key.remoteJid)

const cleanSender = normalizeJid(sender)


// const isOwner =
//   normalizedOwners.includes(cleanSender) ||
//   cleanSender === botId
    BOT_STATS.messages++
    // const isBot = msg.key.fromMe
    const isGroup = jid.includes("@g.us")
    const isDM = !isGroup
    const settings = getSettings("global")
    const group_settings = getGroup_Settings(jid || "default")
    if (!msg.message) return


// 🔥 FORCE DM PUSH RECOGNITION
if (isDM) {
  await sock.sendPresenceUpdate("available", jid)
}

const body =
  msg.message?.conversation ||
  msg.message?.extendedTextMessage?.text ||
  msg.message?.imageMessage?.caption ||
  msg.message?.videoMessage?.caption ||
  ""


const reply = async (text) => {
  try {
    await sock.sendMessage(jid, { text }, { quoted: msg })

    await sock.sendPresenceUpdate("paused", jid)

  } catch (e) {
    console.log(e)
  }
}

    const getTarget = () =>
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]

    // ================= SAVE MESSAGE =================
    // ===== LIGHTWEIGHT MESSAGE STORE (ANTI-MEMORY LEAK) =====
    const MAX_STORE = 5000
        // ===== SAFE STORE LIMIT =====
        if (Object.keys(MSG_STORE).length > MAX_STORE) {
          MSG_STORE = {} // reset to prevent memory crash
        }
        

        MSG_STORE[msg.key.id] = {
          message: msg.message,
          sender,
          chat: jid,
        }

        // 💡 SAVE LESS FREQUENTLY (reduce disk load)
        if (Math.random() < 0.1) saveStore()

// ================= ANTI-LINK =================
  if (isGroup && group_settings.antilink && body) {
    const links = ["http", "wa.me", ".com", ".net", "chat.whatsapp.com"]

    if (links.some(l => body.toLowerCase().includes(l))) {
      if (!isAdmin && !isOwner) {

        await sock.sendMessage(jid, { delete: msg.key })

        await addWarn(sock, jid, sender, "Link detected")

        return
      }
    }
  }

   if (group_settings.antistatus && msg.key.remoteJid === "status@broadcast") {
    try {
      await sock.readMessages([msg.key])

      await addWarn(sock, jid, sender, "Status viewing blocked")

    } catch (e) {
      console.log(e)
    }
  }

   if (group_settings.antistatus_mention) {
    const text =
      msg.message?.extendedTextMessage?.text ||
      msg.message?.conversation ||
      ""

    if (text.includes("@")) {
      await sock.sendMessage(jid, { delete: msg.key })

      await addWarn(sock, jid, sender, "Status mention detected")

      await sock.sendMessage(jid, {
        text: "🚫 Status mention blocked"
      })
    }
  }

   if (isGroup && group_settings.antibadword && body) {
    const badwords = ["fuck", "shit", "bitch", "asshole"]

    if (badwords.some(w => body.toLowerCase().includes(w))) {
      if (!isAdmin && !isOwner) {

        await sock.sendMessage(jid, { delete: msg.key })

        await addWarn(sock, jid, sender, "Bad word detected")

        await react(jid, msg.key, "🧼")

        return
      }
    }
  }

    // ================= ANTI DELETE =================
    if (group_settings.antidelete) {
      const proto = msg.message?.protocolMessage
      if (proto?.type === 0) {
        const original = MSG_STORE[proto.key.id]
        if (original) {
          await sock.sendMessage(jid, { text: "🚨 Anti-delete triggered" })

          await sock.sendMessage(jid, {
            forward: {
              key: {
                remoteJid: original.chat,
                fromMe: false,
                id: proto.key.id,
                participant: original.sender
              },
              message: original.message
            }
          })
        }
      }
    }

   

    // ================= COMMAND =================
 // ================= COMMAND HANDLER =================

const isCommand = body.startsWith(PREFIX)
if (!isCommand) return

// ===== PARSE =====
const args = body.slice(1).trim().split(/ +/)
const cmd = args.shift()?.toLowerCase() || ""

// ================= MODES =================
const botMode = settings?.mode || "public"

if (botMode === "private") {
  if (!isOwner && !isBot) return
}

if (botMode === "group") {
  if (!isGroup && !isOwner) return
}

if (botMode === "dm") {
  if (!isDM && !isOwner) return
}

if (botMode === "auto") {
  // 👥 Groups = everyone
  // 💬 DMs = owner only
  if (isDM && !isOwner && !isBot) return
}


// ================= OPTIONAL DEBUG =================
if (isDM) {
  console.log(`📩 DM CMD: ${cmd} from ${sender}`)
  console.log("OWNER CHECK:", cleanSender, isOwner)
}
    
    const commands = {

      
      // ===== MEDIA =====
      vv: async () => {
  if (!isOwner) return reply("❌ Owner only")

  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
  if (!quoted) return reply("❌ Reply to a view-once message")

  const type = Object.keys(quoted)[0]
  const content = quoted[type]

  if (!content) return reply("❌ Invalid message")

  try {
    const stream = await downloadContentFromMessage(
      content,
      type.replace("Message", "")
    )

    let buffer = Buffer.from([])
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk])
    }

    let sendType = "document"
    if (type === "imageMessage") sendType = "image"
    else if (type === "videoMessage") sendType = "video"
    else if (type === "audioMessage") sendType = "audio"

    // 📤 send result
    const sent = await sock.sendMessage(sender, {
      [sendType]: buffer,
      caption: "👁️ View-once recovered"
    })

    // // 💣 delete result AFTER 15s
    // setTimeout(async () => {
    //   try {
    //     await sock.sendMessage(sender, { delete: sent.key })
    //   } catch (e) {
    //     console.log("VV result delete failed:", e)
    //   }
    // }, 15000)

    // 💣 DELETE COMMAND MESSAGE (immediately or slight delay)
    setTimeout(async () => {
      try {
        await sock.sendMessage(sender, {
          delete: msg.key
        })
      } catch (e) {
        console.log("VV command delete failed:", e)
      }
    }, 4000)

  } catch (e) {
    console.log(e)
    reply("❌ Failed to extract media")
  }
},

      pp: async () => {
  if (!isOwner) return reply("❌ Owner only")

  let target = getTarget() || sender

  try {
    const url = await sock.profilePictureUrl(target, "image")

    const sent = await sock.sendMessage(sender, {
      image: { url },
      caption: "🖼️ Profile picture HD"
    })

    // // 💣 delete result after 15s
    // setTimeout(async () => {
    //   try {
    //     await sock.sendMessage(sender, { delete: sent.key })
    //   } catch (e) {
    //     console.log("PP result delete failed:", e)
    //   }
    // }, 15000)

    // 💣 delete command message
    setTimeout(async () => {
      try {
        await sock.sendMessage(sender, {
          delete: msg.key
        })
      } catch (e) {
        console.log("PP command delete failed:", e)
      }
    }, 2000)

  } catch {
    reply("❌ Cannot fetch profile picture")
  }
},

      sticker: async () => {
        if (!isOwner) return reply("❌ Owner only")
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage

  let mediaMessage =
    msg.message?.imageMessage ||
    quoted?.imageMessage

  if (!mediaMessage) return reply("❌ Reply to an image")

  const stream = await downloadContentFromMessage(mediaMessage, "image")

  let buffer = Buffer.from([])
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk])
  }

  const stickerBuffer = await createSticker(buffer)

  await sock.sendMessage(jid, {
    sticker: stickerBuffer
  }, { quoted: msg })
},

stickergif: async () => {
  if (!isOwner) return reply("❌ Owner only")

const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage

const media =
  msg.message?.imageMessage ||
  msg.message?.videoMessage ||
  quoted?.imageMessage ||
  quoted?.videoMessage

  if (!media) return reply("❌ Reply to image, video or GIF")

  const input = "./temp_input"
  const output = "./temp.webp"

  try {
    // detect type
const type =
  msg.message?.imageMessage ? "image" :
  msg.message?.videoMessage ? "video" :
  quoted?.imageMessage ? "image" :
  quoted?.videoMessage ? "video" :
  null

if (!type) return reply("❌ Unsupported media")

const mediaObj =
  msg.message?.imageMessage ||
  msg.message?.videoMessage ||
  quoted?.imageMessage ||
  quoted?.videoMessage

const stream = await downloadContentFromMessage(mediaObj, type)

try {
  const stream = await downloadContentFromMessage(mediaObj, type)

  let buffer = Buffer.from([])
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk])
  }

} catch (e) {
  console.log("DOWNLOAD ERROR:", e)
  return reply("❌ Media download failed (encrypted or expired message)")
}

    let buffer = Buffer.from([])
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk])
    }

    fs.writeFileSync(input, buffer)

    // IMAGE → STICKER (fast path)
    if (type === "image") {
      const sticker = await createSticker(buffer)

      return sock.sendMessage(jid, {
        sticker
      }, { quoted: msg })
    }

    // VIDEO / GIF → STICKER (ffmpeg)
    exec(
      `${ffmpegPath} -y -i ${input} ` +
      `-vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15" ` +
      `-t 6 -r 15 ${output}`,
      async (err) => {
        if (err) {
          console.log(err)
          return reply("❌ Conversion failed")
        }

        const stickerBuffer = fs.readFileSync(output)

        await sock.sendMessage(jid, {
          sticker: stickerBuffer
        }, { quoted: msg })

        // cleanup
      // cleanup (SAFE VERSION)
try {
  if (fs.existsSync(input)) fs.unlinkSync(input)
  if (fs.existsSync(output)) fs.unlinkSync(output)
} catch (e) {
  console.log("Cleanup error:", e)
}
      }
    )

  } catch (e) {
    console.log("STICKER ERROR:", e)
    reply("❌ Failed to convert to sticker")
  }
},

memesticker: async () => {
  if (!isOwner) return reply("❌ Owner only")
  const text = args.join(" ")
  if (!text) return reply("❌ Provide text")

  const svg = `
  <svg width="512" height="512">
    <rect width="100%" height="100%" fill="white"/>
    <text x="50%" y="50%" font-size="40" text-anchor="middle" fill="black">
      ${text}
    </text>
  </svg>`

  try {
    const buffer = Buffer.from(svg)

    const png = await sharp(buffer, {
      density: 300 // 🔥 IMPORTANT FIX
    })
      .png()
      .toBuffer()

    const sticker = await createSticker(png)

    await sock.sendMessage(jid, {
      sticker
    }, { quoted: msg })

  } catch (e) {
    console.log("MEME ERROR:", e)
    reply("❌ Meme sticker failed")
  }
},

captionsticker: async () => {
  if (!isOwner) return reply("❌ Owner only")
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage

  const text =
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    quoted?.imageMessage?.caption ||
    quoted?.videoMessage?.caption

  if (!text) return reply("❌ No caption found")

const canvas = createCanvas(512, 512)
const ctx = canvas.getContext("2d")

ctx.fillStyle = "white"
ctx.fillRect(0, 0, 512, 512)

ctx.fillStyle = "black"
ctx.font = "bold 40px Sans"
ctx.textAlign = "center"

ctx.fillText(text, 256, 256)

const buffer = canvas.toBuffer("image/png")
const sticker = await createSticker(buffer)

  await sock.sendMessage(jid, {
    sticker,
    ...STICKER_META
  }, { quoted: msg })
},

stickerpack: async () => {
  if (!isOwner) return reply("❌ Owner only")
  const name = args.join(" ") || "🎭 Special Pack"
const author = msg.pushName || "Bot User"

  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage

  let media =
    msg.message?.imageMessage ||
    quoted?.imageMessage

  if (!media) return reply("❌ Reply to image")

  const stream = await downloadContentFromMessage(media, "image")

  let buffer = Buffer.from([])
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

  const sticker = await createSticker(buffer)

await sock.sendMessage(jid, {
  sticker,
  packname: name,
  author
}, { quoted: msg })
},

// =========== PACKS ===========

//  CREATE PACK

pack_create: async () => {
  const name = args[0]?.toLowerCase()

  if (!name)
    return reply("❌ Usage: .pack create <name>")

  if (STICKER_PACKS[name])
    return reply("❌ Pack already exists")

  STICKER_PACKS[name] = {
    owner: sender,
    created: Date.now(),
    stickers: []
  }

  saveStickerPacks()

  reply(`📦 Pack *${name}* created successfully`)
},

// ADD PACK

pack_add: async () => {
 pack_add: async () => {
  const name = args[0]?.toLowerCase()
  const emoji = args[1] || "🙂"

  if (!name)
    return reply("❌ Usage: .pack add <name> [emoji]")

  const pack = STICKER_PACKS[name]
  if (!pack)
    return reply("❌ Pack not found")

  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage

  let media =
    msg.message?.imageMessage ||
    msg.message?.videoMessage ||
    quoted?.imageMessage ||
    quoted?.videoMessage

  if (!media)
    return reply("❌ Reply to image/video")

  const type = media.imageMessage ? "image" : "video"

  const stream = await downloadContentFromMessage(media, type)

  let buffer = Buffer.from([])
  for await (const chunk of stream)
    buffer = Buffer.concat([buffer, chunk])

  pack.stickers.push({
    type,
    emoji,
    data: buffer.toString("base64")
  })

  saveStickerPacks()

  reply(`➕ Sticker added to *${name}* ${emoji}`)
}

  if (!name)
    return reply("❌ Usage: .pack add <name> [emoji]")

  const pack = STICKER_PACKS[name]
  if (!pack)
    return reply("❌ Pack not found")

  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage

  let media =
    msg.message?.imageMessage ||
    msg.message?.videoMessage ||
    quoted?.imageMessage ||
    quoted?.videoMessage

  if (!media)
    return reply("❌ Reply to image/video")

  const type = media.imageMessage ? "image" : "video"

  const stream = await downloadContentFromMessage(media, type)

  let buffer = Buffer.from([])
  for await (const chunk of stream)
    buffer = Buffer.concat([buffer, chunk])

  pack.stickers.push({
    type,
    emoji,
    data: buffer.toString("base64")
  })

  saveStickerPacks()

  reply(`➕ Sticker added to *${name}* ${emoji}`)
},

// VIEW PACKS

pack_view: async () => {
  const name = args[0]?.toLowerCase()

  if (!name)
    return reply("❌ Usage: .pack view <name>")

  const pack = STICKER_PACKS[name]

  if (!pack)
    return reply("❌ Pack not found")

  let text = `📦 *PACK: ${name}*\n\n`

  pack.stickers.forEach((s, i) => {
    text += `${i + 1}. ${s.emoji} ${s.type}\n`
  })

  reply(text)
},

// LIST PACKS

pack_list: async () => {
  const packs = Object.keys(STICKER_PACKS)

  if (!packs.length)
    return reply("❌ No packs available")

  let text = "📦 *STICKER PACKS*\n\n"

  packs.forEach(p => {
    text += `• ${p} (${STICKER_PACKS[p].stickers.length})\n`
  })

  reply(text)
},

// DELETE PACK

pack_delete: async () => {
  const name = args[0]?.toLowerCase()

  if (!name)
    return reply("❌ Usage: .pack delete <name>")

  if (!STICKER_PACKS[name])
    return reply("❌ Pack not found")

  delete STICKER_PACKS[name]
  saveStickerPacks()

  reply(`🗑️ Pack *${name}* deleted`)
},

// SEND PACK

pack_send: async () => {
  const name = args[0]?.toLowerCase()

  if (!name)
    return reply("❌ Usage: .pack send <name>")

  const pack = STICKER_PACKS[name]

  if (!pack || !pack.stickers.length)
    return reply("❌ Empty or missing pack")

  const random =
    pack.stickers[Math.floor(Math.random() * pack.stickers.length)]

  const buffer = Buffer.from(random.data, "base64")

  await sock.sendMessage(jid, {
    sticker: buffer,
    caption: random.emoji
  }, { quoted: msg })
},

      // ===== TOGGLES =====
      antidelete: async () => {
        if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")
        group_settings.antidelete = args[0] === "on"
        saveGroupSettings()
        reply(`🧠 Anti-delete ${group_settings.antidelete ? "ON" : "OFF"}`)
      },

      antilink: async () => {
        if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")
        group_settings.antilink = args[0] === "on"
        saveGroupSettings()
        reply(`🔗 Anti-link ${group_settings.antilink ? "ON" : "OFF"}`)
      },

      antibadword: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin only  or Bot owner only")

  group_settings.antibadword = args[0] === "on"
  saveGroupSettings()

  reply(`🧼 Anti-badword ${group_settings.antibadword ? "ON" : "OFF"}`)
},

      settings: async () => {
        reply(`⚙️ SETTINGS\n
          AntiDelete: ${group_settings.antidelete}\n
          AntiLink: ${group_settings.antilink}\n
          Bot Mode: ${settings.mode}\n
          Anti-Status: ${group_settings.antistatus}\n
          Antistatus_Mention: ${group_settings.antistatus_mention}`)
      },

      // ===== ADMIN =====
      kick: async () => {
        if (!isGroup) return reply("❌ Group only")
        if (!isOwner && !isAdmin) return reply("❌ Owner only")
        const target = getTarget()
        if (!target) return reply("Mention user")
        await sock.groupParticipantsUpdate(jid, [target], "remove")
      },

      promote: async () => {
        if (!isGroup) return reply("❌ Group only")
        if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")
        const target = getTarget()
        await sock.groupParticipantsUpdate(jid, [target], "promote")
        return reply(" Added as Admin 👮")
      },

      demote: async () => {
        if (!isGroup) return reply("❌ Group only")
        if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")
        const target = getTarget()
        await sock.groupParticipantsUpdate(jid, [target], "demote")
        return reply(" Removed as Admin 👮")
      },

      warn: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  const target = getTarget()
  if (!target) return reply("❌ Mention user")

  const reason = args.slice(1).join(" ") || "No reason provided"

  if (!WARN_DB[jid]) WARN_DB[jid] = {}
  if (!WARN_DB[jid][target]) WARN_DB[jid][target] = []

  WARN_DB[jid][target].push({
    reason,
    by: sender,
    time: Date.now()
  })

  saveWarnDB()

  const count = WARN_DB[jid][target].length

  await reply(
`⚠️ *WARNING ISSUED*

👤 User: @${target.split("@")[0]}
⚠️ Warn: ${count}/3
📝 Reason: ${reason}`
  )

  // AUTO KICK SYSTEM
  if (count >= 3) {
    await sock.groupParticipantsUpdate(jid, [target], "remove")

    delete WARN_DB[jid][target]
    saveWarnDB()

    return reply("🚫 User removed after 3 warnings")
  }
},

warnlist: async () => {
  if (!isGroup) return reply("❌ Group only")
if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  const data = WARN_DB[jid]
  if (!data || Object.keys(data).length === 0)
    return reply("📭 No warnings in this group")

  let text = "⚠️ *GROUP WARNINGS*\n\n"

  for (const user in data) {
    const warns = data[user]

    text += `👤 @${user.split("@")[0]}\n`
    text += `⚠️ Count: ${warns.length}\n`

    warns.forEach((w, i) => {
      text += `   ${i + 1}. ${w.reason}\n`
    })

    text += "\n"
  }

  await sock.sendMessage(jid, {
    text,
    mentions: Object.keys(data)
  })
},

unwarn: async () => {
  if (!isGroup) return reply("❌ Group only")
if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  const target = getTarget()
  if (!target) return reply("❌ Mention user")

  if (!WARN_DB[jid] || !WARN_DB[jid][target])
    return reply("❌ No warnings found")

  delete WARN_DB[jid][target]
  saveWarnDB()

  reply(`✅ Warnings cleared for @${target.split("@")[0]}`)
},

warninfo: async () => {
  if (!isGroup) return reply("❌ Group only")
if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  const target = getTarget() || sender

  const warns = WARN_DB[jid]?.[target] || []

  if (!warns.length)
    return reply("✅ No warnings for this user")

  let text = `⚠️ *WARN INFO*\n\n👤 @${target.split("@")[0]}\n\n`

  warns.forEach((w, i) => {
    text += `⚠️ ${i + 1}. ${w.reason}\n`
  })

  reply(text)
},

      viewadmins: async () => {
  if (!isGroup) return reply("❌ Group only")
    if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  try {
    const meta = await sock.groupMetadata(jid)

    const admins = meta.participants
      .filter(p => p.admin)
      .map(p => p.id)

    if (!admins.length) {
      return reply("❌ No admins found")
    }

    const text =
      "👑 *Group Admins*\n\n" +
      admins.map((a, i) => ` ${i + 1}. @${a.split("@")[0]}`).join("\n")

    await sock.sendMessage(jid, {
      text,
      mentions: admins
    })

  } catch (e) {
    console.log(e)
    reply("❌ Failed to fetch admins (bot may not be admin)")
  }
},

      // ===== OWNER =====
  addowner: async () => {
        if (!isOwner) return reply("❌ Owner only")

        const target = getTarget()
        if (!target) return reply("Mention user")

        const clean = normalizeJid(target)

        if (!BOT_OWNERS.includes(clean)) {
          BOT_OWNERS.push(clean)
          saveOwners()
          reply("👑 Owner added successfully ✅")
        } else {
          reply("Already owner")
        }
      },

      delowner: async () => {
        if (!isOwner) return reply("❌ Owner only")

        const target = getTarget()
        if (!target) return reply("Mention user")

        const clean = normalizeJid(target)

        BOT_OWNERS = BOT_OWNERS.filter(
          (x) => normalizeJid(x) !== clean
        )

        saveOwners()
        reply("👑 Owner removed successfully ❌")
      },

      owners: async () => {
        reply(
          "👑 Owners:\n" +
            BOT_OWNERS.map((o) => "@" + o.split("@")[0]).join("\n")
        )
      },

   restart: async () => {
  if (!isOwner) return reply("❌ Owner only")

  await reply("🔄 Restarting bot safely...")

  try {
    // optional: log restart event or save state
    console.log("🔄 Bot restart requested by owner")

    // small delay to ensure message is sent
    setTimeout(() => {
      // clean exit so Render restarts container properly
      process.exit(0)
    }, 1500)

  } catch (e) {
    console.log("Restart error:", e)
    reply("❌ Restart failed")
  }
},

restart_force: async () => {
  if (!isOwner) return reply("❌ Owner only")

  await reply("🔄 Restarting bot safely...")

  setTimeout(() => {
    // intentional crash → Render auto-redeploys container
    throw new Error("BOT_RESTART_TRIGGER")
  }, 1500)
},

shutdown: async () => {
  if (!isOwner) return reply("❌ Owner only")

  try {
    await reply("⛔ Shutting down bot safely...")

    console.log("⛔ Shutdown triggered by owner")

    // small delay to ensure message delivery
    setTimeout(() => {
      // clean exit signal for Render
      process.exit(0)
    }, 1500)

  } catch (e) {
    console.log("Shutdown error:", e)
    process.exit(1)
  }
},

shutdown_force: async () => {
  if (!isOwner) return reply("❌ Owner only")

  await reply("⛔ Bot shutting down...")

  setTimeout(() => {
    throw new Error("BOT_SHUTDOWN_TRIGGER")
  }, 1500)
},


update: async () => {
  if (!isOwner) return reply("❌ Owner only")

  reply("🛠️ Pulling latest bot updates...")

  exec("git pull", async (err, stdout, stderr) => {
    if (err) {
      console.log(err)
      return reply("❌ Update failed")
    }

    if (stderr) {
      console.log(stderr)
    }

    reply(`✅ Update complete:\n${stdout || "No new updates"}`)
  })
},


broadcast: async () => {
  if (!isOwner) return reply("❌ Owner only")

  const message = args.join(" ")
  if (!message) return reply("❌ Provide message")

  try {
    const allChats = Object.keys(sock.store?.chats || MSG_STORE)

    let success = 0

    for (const chat of allChats) {
      try {
        await sock.sendMessage(chat, {
          text: `📢 OWNER BROADCAST\n\n${message}`
        })

        success++

        await new Promise(r => setTimeout(r, 800))
      } catch {}
    }

    reply(`✅ Broadcast sent to ${success} chats`)
  } catch (e) {
    console.log(e)
    reply("❌ Broadcast failed")
  }
},

ban: async () => {
  if (!isOwner) return reply("❌ Owner only")

  const target = normalizeJid(getTarget())
  if (!target) return reply("❌ Mention user")

  if (!SETTINGS.banned) SETTINGS.banned = []

  if (!SETTINGS.banned.includes(target)) {
    SETTINGS.banned.push(target)
    saveSettings()
  }

  reply(`🚷 User banned:\n@${target.split("@")[0]}`)
},

unban: async () => {
  if (!isOwner) return reply("❌ Owner only")

  const target = normalizeJid(getTarget())
  if (!target) return reply("❌ Mention user")

  if (!SETTINGS.banned) SETTINGS.banned = []

  SETTINGS.banned = SETTINGS.banned.filter(
    u => normalizeJid(u) !== target
  )

  saveSettings()

  reply(`✅ User unbanned:\n@${target.split("@")[0]}`)
},

      // ===== BOT MODE =====

      mode: async () => {
  if (!isOwner) return reply("❌ Owner only")

  const current = settings.mode || "public"
  const newMode = args[0]?.toLowerCase()

  if (!newMode) {
    return reply(`🤖 Current mode: ${current}\n\nUse:\n.mode public\n.mode private`)
  }

  if (newMode !== "public" && newMode !== "private") {
    return reply("❌ Use: .mode public OR .mode private")
  }

  settings.mode = newMode
  saveSettings()

  reply(`✅ Bot mode changed to: *${newMode.toUpperCase()}*`)
},

      // ===== TAG =====
     tageveryone: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  try {
    const meta = await sock.groupMetadata(jid)

    const members = meta.participants
      .map(p => p.id)
      .filter(Boolean)

    if (!members.length) return reply("❌ No members found")

    await reply(`📢 Tagging ${members.length} members...`)

    for (let i = 0; i < members.length; i++) {
      const user = members[i]

      await sock.sendMessage(jid, {
        text: `👋 Hi @${user.split("@")[0]}`,
        mentions: [user]
      })

      // 🔥 delay = anti-ban protection
      await new Promise(res => setTimeout(res, 1200))
    }

    reply("✅ Tagging completed")

  } catch (e) {
    console.log("Tagall Delay Error:", e)
    reply("❌ Failed to tag members")
  }
},

tagall: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  try {
    const meta = await sock.groupMetadata(jid)

    const members = meta.participants
      .map(p => p.id)
      .filter(Boolean)

    if (!members.length) return reply("❌ No members found")

    const chunkSize = 20 // 🔥 safe limit per message
    const chunks = []

    for (let i = 0; i < members.length; i += chunkSize) {
      chunks.push(members.slice(i, i + chunkSize))
    }

    await reply(`📢 Tagging ${members.length} members in ${chunks.length} batches...`)

    for (let i = 0; i < chunks.length; i++) {
      const batch = chunks[i]

      const text =
        `📢 *Tag Batch ${i + 1}/${chunks.length}*\n\n` +
        batch.map(u => `👤 @${u.split("@")[0]}`).join("\n")

      await sock.sendMessage(jid, {
        text,
        mentions: batch
      })

      // 🔥 delay between batches
      await new Promise(res => setTimeout(res, 2500))
    }

    reply("✅ All members tagged safely")

  } catch (e) {
    console.log("Paginated Tagall Error:", e)
    reply("❌ Failed to execute paginated tag")
  }
},
tagonline: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  try {
    const meta = await sock.groupMetadata(jid)

    const members = meta.participants
      .map(p => p.id)
      .filter(Boolean)

    if (!members.length) return reply("❌ No members found")

    // 🟡 Active users tracker (simple in-memory fallback)
    const activeUsers = members.filter(u => {
      // If bot has seen them recently in chat memory
      const lastMsg = MSG_STORE?.[u]
      return lastMsg ? true : false
    })

    // 🔥 fallback if no tracked active users
    const targets = activeUsers.length > 0 ? activeUsers : members.slice(0, 30)

    await reply(`📢 Tagging ${targets.length} active users...`)

    const text =
      `📢 *Active Members Ping*\n\n` +
      targets.map(u => `🟢 @${u.split("@")[0]}`).join("\n")

    await sock.sendMessage(jid, {
      text,
      mentions: targets
    })

  } catch (e) {
    console.log("tagonline error:", e)
    reply("❌ Failed to fetch active users")
  }
},
    hidetag: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  try {
    const meta = await sock.groupMetadata(jid)

    const members = meta.participants
      .map(p => p.id)
      .filter(Boolean)

    if (!members.length) return reply("❌ No members found")

    const text = args.length > 0
      ? args.join(" ")
      : "📢 Announcement"

    // 📤 send hidetag message
    await sock.sendMessage(jid, {
      text,
      mentions: members
    })

    // ⏱️ delete command after 3 seconds
    setTimeout(async () => {
      try {
        await sock.sendMessage(jid, {
          delete: msg.key
        })
      } catch (e) {
        console.log("Command auto-delete failed:", e)
      }
    }, 3000)

  } catch (e) {
    console.log("Hidetag Error:", e)
    reply("❌ Failed to send hidden tag")
  }
},

      lock: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  try {
    await sock.groupSettingUpdate(jid, "announcement")
    reply("🔒 Group locked (admins only)")
  } catch {
    reply("❌ Failed to lock group")
  }
},

unlock: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  try {
    await sock.groupSettingUpdate(jid, "not_announcement")
    reply("🔓 Group unlocked (everyone can chat)")
  } catch {
    reply("❌ Failed to unlock group")
  }
},

// ==== GROUP MANAGEMENT =====
setname: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")
  await sock.groupUpdateSubject(jid, args.join(" "))
  reply("Group name updated ✅")
},

setdesc: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")
  await sock.groupUpdateDescription(jid, args.join(" "))
  reply("📝Group Description updated successfully ✅")
},

groupinfo: async () => {
  if (!isGroup) return reply("❌ Group only")
    if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  try {
    const meta = await sock.groupMetadata(jid)

    const admins = meta.participants
      .filter(p => p.admin)
      .map(p => p.id)

    const owner = meta.owner || "Unknown"

    const text =
`📛 ${meta.subject}

👥 Members: ${meta.participants.length}
👑 Owner: @${owner.split("@")[0]}
🛡️ Admins: ${admins.length}

📝 Description:
${meta.desc || "None"}

👑 Admin List:
${admins.map((a, i) => ` ${i + 1}. @${a.split("@")[0]}`).join("\n")}
`

    await sock.sendMessage(jid, {
      text,
      mentions: [owner, ...admins].filter(Boolean)
    })

  } catch (e) {
    console.log(e)
    reply("❌ Failed to fetch group info")
  }
},

grouplink: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")
  const code = await sock.groupInviteCode(jid)
  reply("🔗 https://chat.whatsapp.com/" + code)
},

revoke: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")
  await sock.groupRevokeInvite(jid)
  reply("🔄 Group link reset successful")
},

add: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  const target = normalizeJid(getTarget())
  if (!target) return reply("❌ Mention user")

  try {
    await sock.groupParticipantsUpdate(jid, [target], "add")
    return reply("✅ User added successfully")
  } catch (e) {
    console.log("Add failed, switching to invite fallback")

    try {
      const code = await sock.groupInviteCode(jid)
      const link = "https://chat.whatsapp.com/" + code

      await sock.sendMessage(target, {
        text: `⚠️ Could not add you automatically.\n\nJoin manually:\n🔗 ${link}`
      })

      reply("⚠️ Could not add user → invite link sent")
    } catch (err) {
      console.log(err)
      reply("❌ Failed to add or send invite")
    }
  }
},

invite: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  const target = normalizeJid(getTarget())
  if (!target) return reply("❌ Mention a user")

  try {
    const code = await sock.groupInviteCode(jid)
    const link = "https://chat.whatsapp.com/" + code

    await sock.sendMessage(target, {
      text: `👋 You are invited to join a group:\n\n🔗 ${link}`
    })

    reply("✅ Invite sent in DM")
  } catch (e) {
    console.log(e)
    reply("❌ Failed to generate invite link")
  }
},

approve: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")
  const target = normalizeJid(getTarget())
  if (!target) return reply("Mention user")

  try {
    await sock.groupRequestParticipantsUpdate(jid, [target], "approve")
    reply("✅ Request approved")
  } catch {
    reply("❌ Failed (ensure join approval is ON)")
  }
},

approveall: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  try {
    const requests = await sock.groupRequestParticipantsList(jid)

    if (!requests || requests.length === 0) {
      return reply("❌ No pending join requests")
    }

    const users = requests.map(u => u.jid)

    await sock.groupRequestParticipantsUpdate(jid, users, "approve")

    reply(`✅ Approved ${users.length} join request(s)`)
  } catch (e) {
    console.log(e)
    reply("❌ Failed to approve requests (maybe join approval is OFF)")
  }
},

reject: async () => {
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")
  const target = normalizeJid(getTarget())
  if (!target) return reply("Mention user")

  try {
    await sock.groupRequestParticipantsUpdate(jid, [target], "reject")
    reply("❌ Request rejected")
  } catch {
    reply("❌ Failed (ensure join approval is ON)")
  }
},

// ================= ANTI STATUS =================
antistatus: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  group_settings.antistatus = args[0] === "on"
  saveGroupSettings()

  reply(`🚫 Anti-status ${group_settings.antistatus ? "ON" : "OFF"}`)
},

antistatusmention: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  group_settings.antistatus_mention = args[0] === "on"
  saveGroupSettings()

  reply(`📢 Anti-status mention ${group_settings.antistatus_mention ? "ON" : "OFF"}`)
},

delete: async () => {
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  const quoted = msg.message?.extendedTextMessage?.contextInfo

  if (!quoted) return reply("❌ Reply to a message to delete")

  const key = {
    remoteJid: jid,
    fromMe: false,
    id: quoted.stanzaId,
    participant: quoted.participant
  }

  try {
    await sock.sendMessage(jid, { delete: key })
    reply("🗑️ Message deleted")
  } catch (e) {
    console.log(e)
    reply("❌ Failed to delete message")
  }
},

del: async () => {
  if (!isAdmin && !isOwner) return reply("❌ Admin or Bot owner only")

  const quoted = msg.message?.extendedTextMessage?.contextInfo

  if (!quoted) return reply("Reply to message")

  try {
    await sock.sendMessage(jid, {
      delete: {
        remoteJid: jid,
        fromMe: false,
        id: quoted.stanzaId,
        participant: quoted.participant
      }
    })
  } catch (e) {
    console.log(e)
    reply("❌ Cannot delete (WhatsApp limitation)")
  }
},

alive: async () => {
  if (!isOwner) return reply("❌ Owner only")

  const uptime = Date.now() - BOT_STATS.startTime
  const seconds = Math.floor(uptime / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  reply(`
🤖 GIBBORLEE BOT STATS

⏱️ Uptime: ${hours}h ${minutes % 60}m ${seconds % 60}s
💬 Messages: ${BOT_STATS.messages}
⚡ Commands used: ${BOT_STATS.commands}

📊 Status: ACTIVE
`)
},

mode: async () => {
  if (!isOwner) return reply("❌ Owner only")

  const current = settings.mode || "public"
  const newMode = args[0]?.toLowerCase()

  if (!newMode) {
    return reply(
`🔐 𝐁𝐎𝐓 𝐌𝐎𝐃𝐄 𝐂𝐎𝐍𝐓𝐑𝐎𝐋

🌍 *PUBLIC MODE*
➤ Everyone can use the bot
➤ Best for open groups & communities

🔒 *PRIVATE MODE*
➤ Only bot owner can use commands
➤ Maximum security mode

👥 *GROUP MODE*
➤ Works only in group chats
➤ Ignores all DMs

💬 *DM MODE*
➤ Works only in private chats
➤ Ignores all groups

⚡ *AUTO MODE*
➤ Smart switching system:
   • Groups → Public access
   • DMs → Owner-only access

━━━━━━━━━━━━━━━━━━━━
📊 Current Mode: *${current.toUpperCase()}*

Usage:
.mode public
.mode private
.mode group
.mode dm
.mode auto`
    )
  }

  const valid = ["public", "private", "group", "dm", "auto"]

  if (!valid.includes(newMode)) {
    return reply("❌ Invalid mode\nUse: public / private / group / dm / auto")
  }

  settings.mode = newMode
  saveSettings()

  reply(`✅ Bot mode changed to: *${newMode.toUpperCase()}*`)
},

whoami: async () => {
  reply(`👤 Your JID:\n${sender}`)
},

ping: async () => {
  const start = Date.now()

  const sent = await sock.sendMessage(jid, {
    text: "🏓 Pinging..."
  })

  const end = Date.now()
  const speed = end - start

  await sock.sendMessage(jid, {
    text:
`🏓 *PONG!. I AM ACTIVE TO ASSIST YOU*

⚡ Speed: ${speed}ms
🤖 Status: Online
📡 Server: Active`
  }, { quoted: msg })
},

// 🔥 .version
version: async () => {
  if (!isOwner) return reply("❌ Owner only")

  try {
    const v = getVersionData()

    reply(
`🤖 BOT VERSION INFO

📌 Version: ${v.version}
🕒 Last Update: ${v.lastUpdate}
💾 Rollback: ${v.rollbackAvailable ? "Available" : "Unavailable"}
🌐 Repo: ${process.env.GITHUB_REPO || "Not Set"}
`)
  } catch (e) {
    console.log(e)
    reply("❌ Failed to fetch version")
  }
},

// 🔥 .backupbot
backupbot: async () => {
  if (!isOwner) return reply("❌ Owner only")

  try {
    const backup = createBackup()

    reply(`✅ Backup created:\n${backup}`)
  } catch (e) {
    console.log(e)
    reply("❌ Backup failed")
  }
},

// 🔥 .rollbackbot
rollbackbot: async () => {
  if (!isOwner) return reply("❌ Owner only")

  try {
    const restored = restoreLatestBackup()

    if (!restored) {
      return reply("❌ No backup available")
    }

    reply(`✅ Rollback restored:\n${restored}\n♻️ Restarting...`)

    process.exit(0)
  } catch (e) {
    console.log(e)
    reply("❌ Rollback failed")
  }
},

// 🔥 .updatebot
updatebot: async () => {
  if (!isOwner) return reply("❌ Owner only")

  try {
    await reply("💾 Creating backup before update...")
    const backup = createBackup()

    const version = getVersionData()
    version.rollbackAvailable = true
    version.lastBackup = backup
    saveVersionData(version)

    await reply("🚀 Triggering Render deployment...")

    await triggerRenderDeploy()

    reply("✅ Render redeploy started successfully")
  } catch (e) {
    console.log("UPDATEBOT ERROR:", e)
    reply(`❌ Update failed: ${e.message}`)
  }
},

      // ===== MENU =====
      
menu: async () => {
  
  // ===== BOT VERSION =====
  const BOT_VERSION = getVersionData ? getVersionData() : {
    version: "1.0.0",
    latest: "1.0.0"
  }

    const isOutdated =
    BOT_VERSION.version !== BOT_VERSION.latest


  const header = getHeader()
  
 const from = msg.key.remoteJid 
 const userJid = msg.key.participant || msg.key.remoteJid

  const pushName =
    msg.pushName ||
    msg.name ||
    "Unknown User"

 // ===== ROLE SYSTEM =====
  let role = "👤 User"

  try {
    if (from.endsWith("@g.us")) {
      const metadata = await sock.groupMetadata(from)

      const participant = metadata.participants.find(
        p => p.id === userJid
      )

      if (participant) {
        if (participant.admin === "superadmin") {
          role = "👑 Group Owner"
        } else if (participant.admin === "admin") {
          role = "🛡️ Group Admin"
        } else {
          role = "👤 Member"
        }
      }
    }
  } catch {
    role = "👤 User"
  }

// 📸 PROFILE PICTURE 

 // ===== PROFILE PICTURE FIX =====
  let profileBuffer = null

  try {
    // First try direct profile picture
    const ppUrl = await sock.profilePictureUrl(userJid, "image")

    if (ppUrl) {
      const response = await fetch(ppUrl)
      const arrayBuffer = await response.arrayBuffer()
      profileBuffer = Buffer.from(arrayBuffer)
    }
  } catch (err) {
    console.log("Profile pic fetch failed:", err)
  }

  // ===== FALLBACK TO CYBER MENU IMAGE =====
  if (!profileBuffer) {
    try {
      const fallbackImages = [
        "https://files.catbox.moe/7an50c.jpg",
        "https://files.catbox.moe/j7w0r3.jpg",
        "https://files.catbox.moe/0f8v6t.jpg"
      ]

      const fallback =
        fallbackImages[
          Math.floor(Math.random() * fallbackImages.length)
        ]

      const response = await fetch(fallback)
      const arrayBuffer = await response.arrayBuffer()
      profileBuffer = Buffer.from(arrayBuffer)

    } catch {
      profileBuffer = null
    }
  }

  // 📊 SYSTEM INFO
  const uptime = process.uptime()
  const uptimeText = `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`

  const memory = (process.memoryUsage().rss / 1024 / 1024).toFixed(2)

  const totalRAM = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2)
  const freeRAM = (os.freemem() / 1024 / 1024 / 1024).toFixed(2)

  const time = moment().tz("Africa/Lagos").format("HH:mm:ss")
  const date = moment().tz("Africa/Lagos").format("DD/MM/YYYY")

  const ownerText = BOT_OWNERS.length
    ? BOT_OWNERS.map(o => `• @${o.split("@")[0]}`).join("\n")
    : "• No owners set"

  // 🌅 GREETING SYSTEM
  const hour = new Date().getHours()
  const greet =
    hour < 12 ? "🌅 Good Morning" :
    hour < 16 ? "🌞 Good Afternoon" :
                "🌙 Good Evening"

 if (!isOwner) return reply("❌ Owner only")
  

  // 📜 MENU TEXT

  let text = `
${header}
╰━━━━━━━━━━━━━━━━━━━╯

${greet}, ${pushName} 👋
How can I be of help to you now?
I am glad to help you out

━━━━━━━━━━━━━━━━━━━━
👑 *OWNER PANEL*
╭───────────────╮
│ 👥 Owners: ${BOT_OWNERS.length}
╰───────────────╯
${ownerText}

━━━━━━━━━━━━━━━━━━━━
👤 *USER PROFILE*
╭───────────────╮
│ 🏷️ Name: ${pushName}
│ 🎭 Role: ${role}
╰───────────────╯

━━━━━━━━━━━━━━━━━━━━
⏰ *TIME & DATE*
╭───────────────╮
│ 🕒 ${time}
│ 📅 ${date}
╰───────────────╯

━━━━━━━━━━━━━━━━━━━━
📊 *SYSTEM STATS*
╭───────────────╮
│ ⚡ Uptime: ${uptimeText}
│ 💾 RAM: ${memory} MB
│ 🧠 Total: ${totalRAM} GB
│ 🧹 Free: ${freeRAM} GB
╰───────────────╯
`
const grouped = groupCommands(COMMANDS)

  for (const [title, cmds] of Object.entries(grouped)) {
    if (!cmds.length) continue

    text += `
━━━━━━━━━━━━━━━━━━━━
╭─「 ${title} 」─╮
${cmds.join("\n")}
╰────────────────────╯
`
  }

  text += `
━━━━━━━━━━━━━━━━━━━━
📦 *BOT VERSION*
╭───────────────╮
│ 📌 Current: ${BOT_VERSION.version}
│ 🆕 Latest: ${BOT_VERSION.latest}
│ 📊 Status: ${isOutdated ? "⚠️ OUTDATED" : "✅ UP TO DATE"}
╰───────────────╯

━━━━━━━━━━━━━━━━━━━━

╔════════════════════════════╗
║ ✨ Clean • Smart • Powerful ✨ 
║   Your wish is my command 🤭   
╚════════════════════════════╝
`


 // ===== SEND MENU WITH WORKING IMAGE =====
  if (profileBuffer) {
    return sock.sendMessage(
      from,
      {
        image: profileBuffer,
        caption: text,
        mentions: BOT_OWNERS
      },
      { quoted: msg }
    )
  }

  // fallback to text-only if image fully fails
  return sock.sendMessage(
    from,
    {
      text,
      mentions: BOT_OWNERS
    },
    { quoted: msg }
  )
}
    }

    


    // ================= EXECUTION =================
   if (commands[cmd]) {
     try {
       await react(jid, msg.key, "⏳")
       await commands[cmd]()
       BOT_STATS.commands++
       await react(jid, msg.key, "✅")
      } catch (e) {
        console.log(e)
        await react(jid, msg.key, "❌")
        reply("Error")
      }
    }
  })

return sock
} catch (err) {
    console.log("🔥 Start error:", err)

    if (!reconnecting) {
      reconnecting = true
      setTimeout(() => start(session), 5000)
    }

}
}

// =================  SESSION =================
;["session1", "session2"].forEach(start)