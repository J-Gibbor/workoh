import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} from "@whiskeysockets/baileys"

import sharp from "sharp"
import { createCanvas, loadImage } from "canvas"
import pino, { levels } from "pino"
import fs from "fs"
import express from "express"
import QRCode from "qrcode"
import path from "path"
import { fileURLToPath } from "url"
import os from "os"
import moment from "moment-timezone"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const AUTH_FOLDER = path.join(__dirname, "auth")

const app = express()
const logger = pino({ level : "silent"})

// Use host-provided port OR fallback to 3000
const PORT = process.env.PORT || 3000

const dmCooldown = new Map()

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
let keepAliveStarted = false

// ================= CONFIG =================
const PREFIX = "."
const WARN_LIMIT = 3
const BOT_STATS = {
  startTime: Date.now(),
  messages: 0,
  commands: 0
}

// ==== STICKER META ====

const STICKER_META = {
  packname: "GIBBORLEE BOT 🤖",
  author: "Sticker Engine v2"
}

const createSticker = async (buffer) => {
  return await sharp(buffer)
    .resize(512, 512, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .webp({ quality: 85 })
    .toBuffer()
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
  memesticker: "😂 Text → meme sticker",
  captionsticker: "🖌️ Caption → sticker",
  stickerpack: "🔥 Create sticker pack",

  addowner: "👑 Add bot owner",
  delowner: "👑 Remove bot owner",
  owners: "👑 Show all bot owners",

  whoami: "🆔 Show your WhatsApp JID",
  stats: "📊 View bot uptime, message count, and command usage",
  mode: "when set to private: 🔒 Owner only mode, when public: 🔘 Everyone can use bot ",
}

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
      markOnlineOnConnect: true,
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
const myNumber = "2347044625110@s.whatsapp.net" // 👈 PUT YOUR NUMBER

const ids = [botId, myNumber]

ids.forEach(id => {
  const clean = normalizeJid(id)
  if (!BOT_OWNERS.includes(clean)) {
    BOT_OWNERS.push(clean)
  }
})

saveOwners()

console.log("👑 Owners:", BOT_OWNERS)
        console.log("🤖 Logged in as:", botId)

        // ✅ PREVENT MULTIPLE INTERVALS
        if (!keepAliveStarted) {
          keepAliveStarted = true
          setInterval(() => {
            try {
              sock.sendPresenceUpdate("unavailable")
            } catch {}
          }, 20000)
        }
      }

      if (connection === "close") {
         const statusCode = lastDisconnect?.error?.output?.statusCode

    console.log("❌ Disconnected:", statusCode)

    // ❌ Logged out (DO NOT reconnect)
    if (statusCode === 401 || statusCode === 405) {
      console.log("⚠️ Logged out → delete auth folder")
      return
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

    // 🔥 FORCE DM PUSH RECOGNITION
if (isDM) {
  try {
    await sock.sendMessage(jid, {
      text: "" // silent ping (forces notification refresh internally)
    })
  } catch {}
}

const body =
  msg.message?.conversation ||
  msg.message?.extendedTextMessage?.text ||
  msg.message?.imageMessage?.caption ||
  msg.message?.videoMessage?.caption ||
  ""

const reply = async (text) => {
  try {
    // typing indicator
    await sock.sendPresenceUpdate("composing", jid)

    await sock.sendMessage(jid, { text }, { quoted: msg })

    await sock.sendPresenceUpdate("paused", jid)

  } catch (e) {
    console.log(e)
  }
}

    const getTarget = () =>
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]


const text =
  msg.message?.conversation ||
  msg.message?.extendedTextMessage?.text ||
  msg.message?.imageMessage?.caption ||
  msg.message?.videoMessage?.caption ||
  "📎 media"

// 🔔 REAL PUSH LOGGER
console.log(`
🔔 NEW MESSAGE NOTIFICATION
━━━━━━━━━━━━━━━━━━
📩 Type: ${isDM ? "DM" : "GROUP"}
👤 From: ${pushName}
🆔 JID: ${sender}
💬 Text: ${text.slice(0, 80)}
⏰ Time: ${new Date().toLocaleTimeString()}
━━━━━━━━━━━━━━━━━━
`)

if (isDM && !msg.key.fromMe) {
  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ""

  // ignore empty
  if (!body) return

  // auto reply logic
  const autoReply = `
🤖 *Auto Reply System*

Hello 👋
I am GIBBORLEE BOT.

⚡ Your message has been received:
"${body.slice(0, 50)}"

⏳ Type .menu to interact with me
`

  await sock.sendMessage(jid, {
    text: autoReply
  }, { quoted: msg })
}

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


    // ================= GROUP META =================
    // let groupAdmins = []

    // if (isGroup) {
    //   const meta = await sock.groupMetadata(jid)
    //   groupAdmins = meta.participants
    //     .filter((p) => p.admin)
    //     .map((p) => p.id)
    // }




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
          chat: jid
        }

        // 💡 SAVE LESS FREQUENTLY (reduce disk load)
        if (Math.random() < 0.1) saveStore()

    // ================= VIEW-ONCE AUTO SAVE =================
    const vmsg =
      msg.message?.viewOnceMessage?.message ||
      msg.message?.viewOnceMessageV2?.message

    if (vmsg) {
      try {
        const type = Object.keys(vmsg)[0]
        const media = vmsg[type]

        const stream = await downloadContentFromMessage(
          media,
          type.replace("Message", "")
        )

        let buffer = Buffer.from([])
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk])
        }

        // SEND ONLY TO OWNERS DM
        for (let owner of BOT_OWNERS) {
          await sock.sendMessage(owner, {
            [type.includes("image") ? "image" : "video"]: buffer,
            caption: "👁️ Auto-saved view-once"
          }) 
          await new Promise(r => setTimeout(r, 1200))
        }

      } catch {}
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
const botMode = settings?.mode === "private" ? "private" : "public"

if (botMode === "private" && !isOwner && !isBot) {
  return
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
        if (!isGroup) return reply("❌ Group only")
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
  if (!isGroup) return reply("❌ Group only")
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage

  let mediaMessage =
    msg.message?.videoMessage ||
    quoted?.videoMessage

  if (!mediaMessage) return reply("❌ Reply to a short video")

  const stream = await downloadContentFromMessage(mediaMessage, "video")

  let buffer = Buffer.from([])
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk])
  }

  const stickerBuffer = await createSticker(buffer)

  await sock.sendMessage(jid, {
    sticker: stickerBuffer
  }, { quoted: msg })
},

memesticker: async () => {
  if (!isGroup) return reply("❌ Group only")
  const text = args.join(" ")
  if (!text) return reply("❌ Provide text")

  const canvas = createCanvas(512, 512)
  const ctx = canvas.getContext("2d")

  // background
  ctx.fillStyle = "white"
  ctx.fillRect(0, 0, 512, 512)

  // text styling
  ctx.fillStyle = "black"
  ctx.font = "bold 40px Sans"
  ctx.textAlign = "center"

  wrapText(ctx, text, 256, 256, 450, 45)

  const buffer = canvas.toBuffer("image/png")
  const sticker = await createSticker(buffer)

  await sock.sendMessage(jid, {
    sticker: sticker,
    ...STICKER_META
  }, { quoted: msg })
},

captionsticker: async () => {
  if (!isGroup) return reply("❌ Group only")
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage

  const text =
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    quoted?.imageMessage?.caption ||
    quoted?.videoMessage?.caption

  if (!text) return reply("❌ No caption found")

  const canvas = createCanvas(512, 512)
  const ctx = canvas.getContext("2d")

  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, 512, 512)

  ctx.fillStyle = "#000"
  ctx.font = "bold 36px Sans"
  ctx.textAlign = "center"

  wrapText(ctx, text, 256, 256, 450, 40)

  const buffer = canvas.toBuffer("image/png")
  const sticker = await createSticker(buffer)

  await sock.sendMessage(jid, {
    sticker,
    ...STICKER_META
  }, { quoted: msg })
},

stickerpack: async () => {
  if (!isGroup) return reply("❌ Group only")
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
        reply(`⚙️ SETTINGS\nAntiDelete: ${group_settings.antidelete}\nAntiLink: ${group_settings.antilink} \nBot Mode: ${settings.mode} \nAnti-Status: ${group_settings.antistatus} \Antistatus_Mention: ${group_settings.antistatus_mention}`)
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

stats: async () => {
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
    return reply(`🤖 Current mode: ${current}\n\nUse:\n.mode public\n.mode private`)
  }

  if (!["public", "private"].includes(newMode)) {
    return reply("❌ Use: .mode public OR .mode private")
  }

  settings.mode = newMode
  saveSettings()

  reply(`✅ Bot mode changed to: *${newMode.toUpperCase()}*`)
},

whoami: async () => {
  reply(`👤 Your JID:\n${sender}`)
},

      // ===== MENU =====
menu: async () => {

  const section = args[0]?.toLowerCase()

  // ===== FULL MENU =====
  if (!section) {

     const from = msg.key.remoteJid
  const userJid = msg.key.participant || msg.key.remoteJid
  const pushName = msg.pushName || "Unknown User"


  // 🧠 ROLE SYSTEM
  let role = "👤 User"

try {
  // Only works in groups
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

   // 📸 PROFILE PICTURE

  let profilePic = "https://i.imgur.com/blank-profile-picture.png"

try {
  if (sock && userJid) {
    profilePic = await sock.profilePictureUrl(userJid, "image")
  }
} catch (err) {
  profilePic = "https://i.imgur.com/blank-profile-picture.png"
}

   // 📊 SYSTEM INFO
  const uptime = process.uptime()
  const uptimeText = `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`

  const memory = (process.memoryUsage().rss / 1024 / 1024).toFixed(2)

  const totalRAM = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2)
  const freeRAM = (os.freemem() / 1024 / 1024 / 1024).toFixed(2)

  const time = moment().tz("Africa/Lagos").format("HH:mm:ss")
  const date = moment().tz("Africa/Lagos").format("DD/MM/YYYY")

    let text = `
╔══════════════════════╗
║ 🤖 GIBBORLEE BOT MENU    ║
╚══════════════════════╝

👤 USER PROFILE
• Name: ${pushName}
• Role: ${role}

━━━━━━━━━━━━━━━━━━━━
⏰ TIME INFO
• Time: ${time}
• Date: ${date}

━━━━━━━━━━━━━━━━━━━━
📊 DEVICE STATS
• ⚡ Uptime: ${uptimeText}
• 💾 RAM Used: ${memory} MB
• 🧠 Total RAM: ${totalRAM} GB
• 🧹 Free RAM: ${freeRAM} GB

━━━━━━━━━━━━━━━━━━━━

📌 Use:
.menu protection
.menu group
.menu all

━━━━━━━━━━━━━━━━━━━━
📂 Categories:
• protection
• group
• management
• join
• tag
• media
• owner
• mode
• sticker
• info
`

     return sock.sendMessage(from, {
    image: { url: profilePic },
    caption: text
  }, { quoted: msg })
  }

  // ===== FULL LIST =====
  if (section === "all") {
    let text = `🤖 FULL COMMAND LIST\n━━━━━━━━━━━━━━━━━━\n`

    for (let cmd in COMMANDS) {
      text += `➤ .${cmd}\n   └ ${COMMANDS[cmd]}\n\n`
    }

    return reply(text)
  }

  // ===== CATEGORY FILTER =====
  const categories = {
    protection: ["antidelete", "antilink", "antistatus", "antistatusmention", "settings"],
    group: ["lock", "unlock", "kick", "add", "promote", "demote", "warn", "delete", "del"],
    management: ["setname", "setdesc", "groupinfo", "viewadmins", "grouplink", "revoke"],
    join: ["approve", "approveall", "reject"],
    tag: ["tagall", "hidetag", "tagonline"],
    media: ["vv", "pp"],
    sticker: [ "sticker", "stickergif", "memesticker", "captionsticker", "stickerpack" ],
    owner: ["addowner", "delowner", "owners", "stats"],
    mode: ["Private", "Public"],
    info: ["whoami"]
  }

  const list = categories[section]

  if (!list) return reply("❌ Invalid menu category")

  let text = `📂 ${section.toUpperCase()} COMMANDS\n━━━━━━━━━━━━━━━━━━\n`

  list.forEach(cmd => {
    text += `➤ .${cmd}\n   └ ${COMMANDS[cmd] || "No description"}\n\n`
  })

  reply(text)
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