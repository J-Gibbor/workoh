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
const WARN_LIMIT = 3
const BOT_STATS = {
  startTime: Date.now(),
  messages: 0,
  commands: 0
}


const BOT_VERSION = {
  version: "2.0.0",
  releaseDate: "2026-04-28",
  owner: "GIBBORLEE",
  changelog: [
    "🧠 Smart menu system upgraded",
    "🔐 Advanced mode control added",
    "🌐 Live cyber banner system",
    "⚡ Performance optimizations",
    "🛡️ Stability improvements"
  ]
}

// 🔥 LATEST VERSION (change this when you update bot)
const LATEST_VERSION = "2.1.0"

// 🧠 VERSION CHECKER
const isOutdated = () => BOT_VERSION.version !== LATEST_VERSION


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


const COMMANDS = {
  antidelete: "🧠 Restore deleted messages automatically",
  antilink: "🔗 Delete messages containing links",
  antistatus: "🚫 Block status viewing detection",
  antistatusmention: "📢 Block status mentions",

  settings: "⚙️ Show current bot settings",

  lock: "🔒 Restrict group to admins only",
  unlock: "🔓 Allow all members to chat",

  kick: "👢 Remove a user from group",
  add: "➕ Add a user to group",
  promote: "⬆️ Promote user to admin",
  demote: "⬇️ Remove admin rights",
  warn: "⚠️ Warn user (3 warns = kick)",

  delete: "🗑️ Delete a replied message",
  del: "🧨 Force delete message",

  setname: "✏️ Change group name",
  setdesc: "📝 Change group description",
  groupinfo: "📊 Show group details",
  admins: "👮 Show group admins",
  grouplink: "🔗 Get group invite link",
  revoke: "♻️ Reset group invite link",

  invite: "🔗 Sends group link",
  approve: "✅ Accept join request",
  reject: "❌ Decline join request",


  tagall: "📣 Mention all members",
  hidetag: "📌 Send hidden mention message",
  tagonline: "🟢 Tag only active users",

  vv: "👁️ Recover view-once media",
  pp: "🖼️ Get profile picture HD",
  sticker: "🖼️ Convert image to sticker",
  stickergif: "🎥 Convert video to animated sticker",
  memeSticker: "😂 Text → meme sticker",
  captionSticker: "🖌️ Caption → sticker",
  stickerpack: "🔥 Create sticker pack",

  addowner: "👑 Add bot owner",
  delowner: "👑 Remove bot owner",
  owners: "👑 Show all bot owners",

  whoami: "🆔 Show your WhatsApp JID",
  stats: "📊 View bot uptime, message count, and command usage",
  mode: "when set to private: 🔒 Owner only mode, when public: 🔘 Everyone can use bot ",
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
            try {
              sock.sendPresenceUpdate("unavailable")
            } catch {}
          }, 15000)
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

  let warns = {}

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

    // ================= ANTI STATUS =================
if (group_settings.antistatus || group_settings.antistatus_mention) {
  try {
    const msgType = msg.message

    const isStatus =
      msg.key.remoteJid === "status@broadcast"

    if (isStatus) {
      // delete status view
      if (group_settings.antistatus) {
        await sock.readMessages([msg.key])
      }

      // handle mentions inside status
      if (group_settings.antistatus_mention) {
        const text =
          msg.message?.extendedTextMessage?.text ||
          msg.message?.conversation ||
          ""

        if (text.includes("@")) {
          await sock.sendMessage(jid, {
            text: "🚫 Status mention blocked",
          })
        }
      }
    }
  } catch (e) {
    console.log("Anti-status error:", e)
  }
}

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

    // ================= ANTI LINK =================
   if (isGroup && group_settings.antilink && body) {
  const links = ["http", "wa.me", ".com", ".net", "chat.whatsapp.com"]

  if (links.some(l => body.toLowerCase().includes(l))) {
    if (!isAdmin && !isOwner) {
      await sock.sendMessage(jid, { delete: msg.key })
      warns[sender] = (warns[sender] || 0) + 1

      await react(jid, msg.key, "⚠️")

      if (warns[sender] >= WARN_LIMIT) {
        await sock.groupParticipantsUpdate(jid, [sender], "remove")
        delete warns[sender]
        return reply("🚫 Removed (link spam)")
      }

      return reply(`⚠️ Warning ${warns[sender]}/3`)
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
  if (!quoted) return reply("Reply to a view-once message")

  const type = Object.keys(quoted)[0]
  const content = quoted[type]

  if (!content) return reply("Invalid message")

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

    await sock.sendMessage(sender, {
      [sendType]: buffer,
      caption: "👁️ View-once recovered"
    })

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

          await sock.sendMessage(sender, {
            image: { url },
            caption: "🖼️ Profile picture HD"
          })

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
  const quoted =
    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage

  let mediaMessage =
    msg.message?.videoMessage ||
    quoted?.videoMessage

  if (!mediaMessage) return reply("❌ Reply to a video")

  const input = "./temp.mp4"
  const output = "./temp.webp"

  try {
    // 1. download video
    const stream = await downloadContentFromMessage(mediaMessage, "video")

    let buffer = Buffer.from([])
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk])
    }

    fs.writeFileSync(input, buffer)

    // 2. convert with ffmpeg
    exec(
      `${ffmpegPath} -i ${input} -vf "scale=512:512:force_original_aspect_ratio=decrease" -t 6 -r 15 ${output}`,
      async (err) => {
        if (err) {
          console.log(err)
          return reply("❌ FFmpeg failed")
        }

        // 3. send sticker
        const stickerBuffer = fs.readFileSync(output)

        await sock.sendMessage(jid, {
          sticker: stickerBuffer
        }, { quoted: msg })

        // cleanup
        fs.unlinkSync(input)
        fs.unlinkSync(output)
      }
    )

  } catch (e) {
    console.log(e)
    reply("❌ Failed to create sticker")
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
  const name = args.join(" ") || "Special Pack"

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
    author: "GIBBORLEE PACK CREATOR"
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

        warns[target] = (warns[target] || 0) + 1

        if (warns[target] >= WARN_LIMIT) {
          await sock.groupParticipantsUpdate(jid, [target], "remove")
          delete warns[target]
          return reply("🚫 Removed (3 warns)")
        }

        reply(`⚠️ Warn ${warns[target]}/3`)
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

  await reply("🔄 Restarting bot...")
  process.exit(0)
},

shutdown: async () => {
  if (!isOwner) return reply("❌ Owner only")

  await reply("⛔ Shutting down bot safely...")
  process.exit(1)
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

backup: async () => {
  if (!isOwner) return reply("❌ Owner only")

  try {
    const backupData = {
      owners: BOT_OWNERS,
      settings: SETTINGS,
      groups: GROUP_SETTINGS,
      stats: BOT_STATS,
      timestamp: new Date().toISOString()
    }

    const backupFile = "./backup.json"

    fs.writeFileSync(
      backupFile,
      JSON.stringify(backupData, null, 2)
    )

    await sock.sendMessage(jid, {
      document: fs.readFileSync(backupFile),
      mimetype: "application/json",
      fileName: `backup-${Date.now()}.json`,
      caption: "📂 Bot backup created"
    }, { quoted: msg })

  } catch (e) {
    console.log(e)
    reply("❌ Backup failed")
  }
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

    await sock.sendMessage(jid, {
      text,
      mentions: members
    })

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

  // 📊 SHOW CURRENT MODE
  if (!newMode) {
    return reply(
`🔐 BOT MODE PANEL

🌍 public  → Everyone can use bot
🔒 private → Owner only
👥 group   → Group chats only
💬 dm      → Direct messages only
⚡ auto    → Smart mode:
   • Groups = Public
   • DMs = Owner only

📊 Current Mode: *${current.toUpperCase()}*

Usage:
.mode public
.mode private
.mode group
.mode dm
.mode auto`
    )
  }

  // ✅ VALIDATE
  const validModes = ["public", "private", "group", "dm", "auto"]

  if (!validModes.includes(newMode)) {
    return reply("❌ Invalid mode.\nUse: public / private / group / dm / auto")
  }

  settings.mode = newMode
  saveSettings()

  reply(`✅ Bot mode changed to: *${newMode.toUpperCase()}*`)
},

whoami: async () => {
  reply(`👤 Your JID:\n${sender}`)
},

version: async () => {
   if (!isOwner) return reply("❌ Owner only")
  const status = isOutdated()
    ? "⚠️ OUTDATED - UPDATE AVAILABLE"
    : "✅ LATEST VERSION"

  const changelogText = BOT_VERSION.changelog
    .map(v => `• ${v}`)
    .join("\n")

  reply(`
🤖 *BOT VERSION INFO*

📦 Version: ${BOT_VERSION.version}
🆕 Latest: ${LATEST_VERSION}
📅 Release: ${BOT_VERSION.releaseDate}

📊 Status: ${status}

━━━━━━━━━━━━━━
🧠 *CHANGELOG*
${changelogText}

━━━━━━━━━━━━━━
👑 Owner: ${BOT_VERSION.owner}
  `)
},


updatebot: async () => {
  if (!isOwner) return reply("❌ Owner only")

  reply("🔄 Updating bot from repository...")

  exec("git pull && npm install", (err, stdout) => {
    if (err) return reply("❌ Update failed")

    reply(`
✅ Update completed

${stdout}

♻️ Restarting bot...
    `)

    setTimeout(() => process.exit(0), 3000)
  })
},

      // ===== MENU =====
      
menu: async () => {

  
const BOT_VERSION = {
  version: "2.0.0",
  latest: "2.1.0",
  status: "stable"
}

const isOutdated = BOT_VERSION.version !== BOT_VERSION.latest

  const header = getHeader()
  

  const from = msg.key.remoteJid
  const userJid = msg.key.participant || msg.key.remoteJid

  const pushName =
    msg.pushName ||
    msg.name ||
    "Unknown User"

  // 🧠 ROLE SYSTEM
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
  } catch (err) {
    role = "👤 User"
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
    hour < 18 ? "🌞 Good Afternoon" :
                "🌙 Good Evening"

 if (!isOwner) return reply("❌ Owner only")

  // 📜 MENU TEXT
  let text = `
${header}
╰━━━━━━━━━━━━━━━━━━━╯

${greet}, ${pushName} 👋

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

━━━━━━━━━━━━━━━━━━━━
🛡️ *GROUP PROTECTION*
╭───────────────╮
│ 🚫 .antilink → Block links
│ 🧼 .antibadword → Filter bad words
│ 🕵️ .antidelete → Recover deleted msgs
╰───────────────╯

━━━━━━━━━━━━━━━━━━━━
👥 *ADMIN MODERATION*
╭───────────────╮
│ ➕ .add → Add member
│ 🥾 .kick → Remove member
│ ⬆️ .promote → Make admin
│ ⬇️ .demote → Remove admin
│ 📣 .tagall → Mention everyone
╰───────────────╯

━━━━━━━━━━━━━━━━━━━━
⚙️ *GROUP MANAGEMENT*
╭───────────────╮
│ ✏️ .setname → Change group name
│ 📝 .setdesc → Set group description
│ 🔒 .lock → Lock group
│ 🔓 .unlock → Unlock group
╰───────────────╯

━━━━━━━━━━━━━━━━━━━━
🎨 *MEDIA*
╭───────────────╮
│ 🎥 .vv → View once extraction
│ 🖼️ .pp → Profile picture
│ 🧩 .sticker → Create sticker
╰───────────────╯

━━━━━━━━━━━━━━━━━━━━
👑 *OWNER*
╭───────────────╮
│ 🔄 .restart → Reboot system instantly
│ ⛔ .shutdown → Power off bot safely
│ 🛠️ .update → Refresh bot files
│ 📂 .backup → Save bot data
│ 📡 .broadcast → Send message to all chats
│ 🚷 .ban → Block user access
│ ✅ .unban → Restore user access
╰───────────────╯
━━━━━━━━━━━━━━━━━━━━
🔐 *MODE CONTROL*
╭───────────────╮
│ 🌍 .mode public → Everyone can use bot
│ 🔒 .mode private → Owner-only access
│ 👥 .mode group → Group chats only
│ 💬 .mode dm → Direct messages only
│ ⚡ .mode auto → Smart access control
│ 📊 .mode → View current mode
╰───────────────╯

━━━━━━━━━━━━━━━━━━━━
ℹ️ *INFO*
╭───────────────╮
│ 🏓 .ping → Bot speed
│ 🤖 .alive → Bot status
│ 📜 .menu → Show menu
╰───────────────╯

━━━━━━━━━━━━━━━━━━━━
🛠️ *BOT UPDATE*
╭───────────────╮
│📦 .Version  → View bot current version
│⚙️ .updatebot  → Version update
╰───────────────╯

━━━━━━━━━━━━━━━━━━━━
ℹ️ *BOT INFO*
╭───────────────╮
│ 📦 Version: ${BOT_VERSION.version}
│  🆕 Latest: ${BOT_VERSION.latest}
│  📊 Status: ${isOutdated ? "⚠️ OUTDATED" : "✅ UP TO DATE"}
╰───────────────╯

━━━━━━━━━━━━━━━━━━━━
⚡ *𝐆𝐈𝐁𝐁𝐎𝐑𝐋𝐄𝐄 𝐁𝐎𝐓* ⚡
✨ Clean • Smart • Powerful
 Your wish is my command 🤭
`

  // 📤 SEND TEXT MENU (NO IMAGE)
  return sock.sendMessage(from, {
    text: text,
    mentions: BOT_OWNERS
  }, { quoted: msg })
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