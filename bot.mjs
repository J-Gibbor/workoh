import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadContentFromMessage
} from "@whiskeysockets/baileys"

import pino from "pino"
import fs from "fs"
import qrcode from "qrcode-terminal"

const logger = pino({ level: "silent" })

// ================= CONFIG =================
const PREFIX = "."
const WARN_LIMIT = 3

const normalizeJid = (jid) =>
  jid.includes(":") ? jid.split(":")[0] + "@s.whatsapp.net" : jid
// ================= FILES =================
const SETTINGS_FILE = "./group-settings.json"
const STORE_FILE = "./msg-store.json"
const OWNERS_FILE = "./owners.json"

let GROUP_SETTINGS = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE)) : {}
let MSG_STORE = fs.existsSync(STORE_FILE) ? JSON.parse(fs.readFileSync(STORE_FILE)) : {}
let BOT_OWNERS = fs.existsSync(OWNERS_FILE) ? JSON.parse(fs.readFileSync(OWNERS_FILE)) : []

const saveSettings = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(GROUP_SETTINGS, null, 2))
const saveStore = () => fs.writeFileSync(STORE_FILE, JSON.stringify(MSG_STORE, null, 2))
const saveOwners = () => fs.writeFileSync(OWNERS_FILE, JSON.stringify(BOT_OWNERS, null, 2))

const getSettings = (jid) => {
  if (!GROUP_SETTINGS[jid]) {
    GROUP_SETTINGS[jid] = { antidelete: true, antilink: true }
  }
  return GROUP_SETTINGS[jid]
}

// ================= START =================
async function start(session) {

  const { state, saveCreds } = await useMultiFileAuthState(`auth/${session}`)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false
  })

sock.ev.on("connection.update", (u) => {
    if (u.qr) {
      console.log(`📱 QR - ${session}`)
      qrcode.generate(u.qr, { small: true })
    }

    if (u.connection === "open") {
      const botId = normalizeJid(sock.user.id)

      if (!BOT_OWNERS.length) {
        BOT_OWNERS.push(botId)
        saveOwners()
      }

      console.log("✅ Owner set:", botId)
      console.log(`✅ ${session} connected`)
    }

    if (u.connection === "close") {
      if (
        u.lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut
      ) {
        start(session)
      }
    }
  })

  sock.ev.on("creds.update", saveCreds)



  let warns = {}

  const react = (jid, key, emoji) =>
    sock.sendMessage(jid, { react: { text: emoji, key } })


 // ================= EVENTS =================
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const jid = msg.key.remoteJid
    const isGroup = jid.endsWith("@g.us")
    const sender = normalizeJid(msg.key.participant || msg.key.remoteJid)
    const isDM = !isGroup

    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      ""

    const reply = (text) =>
      sock.sendMessage(jid, { text }, { quoted: msg })

    const getTarget = () =>
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]

    // ================= GROUP META =================
    let groupAdmins = []

    if (isGroup) {
      const meta = await sock.groupMetadata(jid)
      groupAdmins = meta.participants
        .filter((p) => p.admin)
        .map((p) => p.id)
    }

    const isOwner = BOT_OWNERS.map(normalizeJid).includes(
      normalizeJid(sender)
    )
    const isAdmin = groupAdmins.includes(sender)

    // ================= SAFE DM CONTROL =================
    // Only restrict NON-owners in DM
    if (isDM && !isOwner) return

    const settings = getSettings(jid)

    // ================= SAVE MESSAGE =================
    MSG_STORE[msg.key.id] = {
      message: msg.message,
      sender,
      chat: jid
    }
    saveStore()

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
        }

      } catch {}
    }

    // ================= ANTI DELETE =================
    if (settings.antidelete) {
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
    if (isGroup && settings.antilink) {
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
    if (!body.startsWith(PREFIX)) return

    const args = body.slice(1).trim().split(/ +/)
    const cmd = args.shift().toLowerCase()

    const commands = {

      // ===== MEDIA =====
      vv: async () => {
        if (!isOwner) return reply("Owner only")

        const quoted =
          msg.message?.extendedTextMessage?.contextInfo?.quotedMessage

        if (!quoted) return reply("Reply to a view-once message")

        const vmsg =
          quoted?.viewOnceMessage?.message ||
          quoted?.viewOnceMessageV2?.message

        if (!vmsg) return reply("Not view-once")

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

        await sock.sendMessage(sender, {
          [type.includes("image") ? "image" : "video"]: buffer,
          caption: "👁️ View-once recovered"
        })

        reply("📩 Sent to your DM")
      },

      pp: async () => {
        if (!isOwner) return reply("Owner only")

        let target = getTarget() || sender

        try {
          const url = await sock.profilePictureUrl(target, "image")

          await sock.sendMessage(sender, {
            image: { url },
            caption: "🖼️ Profile picture HD"
          })

          reply("📩 Sent to your DM")
        } catch {
          reply("❌ Cannot fetch profile picture")
        }
      },

      // ===== TOGGLES =====
      antidelete: async () => {
        if (!isAdmin && !isOwner) return reply("❌ Admin only")
        settings.antidelete = args[0] === "on"
        saveSettings()
        reply(`🧠 Anti-delete ${settings.antidelete ? "ON" : "OFF"}`)
      },

      antilink: async () => {
        if (!isAdmin && !isOwner) return reply("❌ Admin only")
        settings.antilink = args[0] === "on"
        saveSettings()
        reply(`🔗 Anti-link ${settings.antilink ? "ON" : "OFF"}`)
      },

      settings: async () => {
        reply(`⚙️ SETTINGS\nAntiDelete: ${settings.antidelete}\nAntiLink: ${settings.antilink}`)
      },

      // ===== ADMIN =====
      kick: async () => {
        if (!isOwner && !isAdmin) return reply("Owner only")
        const target = getTarget()
        if (!target) return reply("Mention user")
        await sock.groupParticipantsUpdate(jid, [target], "remove")
      },

      promote: async () => {
        if (!isAdmin && !isOwner) return reply("❌ Admin only")
        const target = getTarget()
        await sock.groupParticipantsUpdate(jid, [target], "promote")
      },

      demote: async () => {
        if (!isAdmin && !isOwner) return reply("❌ Admin only")
        const target = getTarget()
        await sock.groupParticipantsUpdate(jid, [target], "demote")
      },

      warn: async () => {
        if (!isAdmin && !isOwner) return reply("❌ Admin only")
        const target = getTarget()

        warns[target] = (warns[target] || 0) + 1

        if (warns[target] >= WARN_LIMIT) {
          await sock.groupParticipantsUpdate(jid, [target], "remove")
          delete warns[target]
          return reply("🚫 Removed (3 warns)")
        }

        reply(`⚠️ Warn ${warns[target]}/3`)
      },

      // ===== OWNER =====
  addowner: async () => {
        if (!isOwner) return reply("Owner only")

        const target = getTarget()
        if (!target) return reply("Mention user")

        const clean = normalizeJid(target)

        if (!BOT_OWNERS.includes(clean)) {
          BOT_OWNERS.push(clean)
          saveOwners()
          reply("✅ Owner added")
        } else {
          reply("Already owner")
        }
      },

      delowner: async () => {
        if (!isOwner) return reply("Owner only")

        const target = getTarget()
        if (!target) return reply("Mention user")

        const clean = normalizeJid(target)

        BOT_OWNERS = BOT_OWNERS.filter(
          (x) => normalizeJid(x) !== clean
        )

        saveOwners()
        reply("❌ Owner removed")
      },

      owners: async () => {
        reply(
          "👑 Owners:\n" +
            BOT_OWNERS.map((o) => "@" + o.split("@")[0]).join("\n")
        )
      },
    

      // ===== TAG =====
      tagall: async () => {
        if (!isAdmin && !isOwner) return reply("❌ Admin only")
        const meta = await sock.groupMetadata(jid)
        const members = meta.participants.map(p => p.id)

        sock.sendMessage(jid, {
          text: "📢 Tagging all",
          mentions: members
        })
      },

      hidetag: async () => {
        if (!isAdmin && !isOwner) return reply("❌ Admin only")
        const meta = await sock.groupMetadata(jid)
        const members = meta.participants.map(p => p.id)

        sock.sendMessage(jid, {
          text: args.join(" ") || "📢",
          mentions: members
        })
      },

      lock: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

  try {
    await sock.groupSettingUpdate(jid, "announcement")
    reply("🔒 Group locked (admins only)")
  } catch {
    reply("❌ Failed to lock group")
  }
},

unlock: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

  try {
    await sock.groupSettingUpdate(jid, "not_announcement")
    reply("🔓 Group unlocked (everyone can chat)")
  } catch {
    reply("❌ Failed to unlock group")
  }
},

whoami: async () => {
  reply(`👤 Your JID:\n${sender}`)
},

      // ===== MENU =====
menu: async () => {
  reply(`
╔══════════════════════╗
║ 🤖  𝗚𝗜𝗕𝗕𝗢𝗥𝗟𝗘𝗘 𝗕𝗢𝗧 𝗠𝗘𝗡𝗨  ║
╚══════════════════════╝

🔥 𝗣𝗥𝗢𝗧𝗘𝗖𝗧𝗜𝗢𝗡
━━━━━━━━━━━━━━━━━━
🛡️ .antilink on/off   ➤ Block links
🧠 .antidelete on/off  ➤ Restore deleted msgs
⚙️ .settings           ➤ View bot settings

👥 𝗚𝗥𝗢𝗨𝗣 𝗖𝗢𝗡𝗧𝗥𝗢𝗟
━━━━━━━━━━━━━━━━━━
🔒 .lock              ➤ Admin-only chat
🔓 .unlock            ➤ Everyone can chat
👢 .kick              ➤ Remove member
⬆️ .promote           ➤ Promote admin
⬇️ .demote            ➤ Demote admin
⚠️ .warn              ➤ Warn user (3 = kick)

📢 𝗧𝗔𝗚 𝗙𝗘𝗔𝗧𝗨𝗥𝗘𝗦
━━━━━━━━━━━━━━━━━━
📣 .tagall            ➤ Mention everyone
📌 .hidetag           ➤ Hidden tag message

🎭 𝗠𝗘𝗗𝗜𝗔 𝗧𝗢𝗢𝗟𝗦
━━━━━━━━━━━━━━━━━━
👁️ .vv                ➤ Save view-once media
🖼️ .pp                ➤ HD profile picture

👑 𝗢𝗪𝗡𝗘𝗥 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦
━━━━━━━━━━━━━━━━━━
➕ .addowner          ➤ Add bot owner
➖ .delowner          ➤ Remove owner
👑 .owners            ➤ Show all owners
🆔 .whoami            ➤ Show your JID

━━━━━━━━━━━━━━━━━━
💡 Powered by GibborLee Bot Engine
`)
}
    }
  



    // ================= EXECUTION =================
   if (commands[cmd]) {
      try {
        await react(jid, msg.key, "⏳")
        await commands[cmd]()
        await react(jid, msg.key, "✅")
      } catch (e) {
        console.log(e)
        reply("Error")
      }
    }
  })
}



// ================= MULTI SESSION =================
;["session1", "session2"].forEach(start)
