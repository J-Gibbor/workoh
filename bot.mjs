import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadContentFromMessage
} from "@whiskeysockets/baileys"

import pino from "pino"
import fs from "fs"
import qrcode from "qrcode-terminal"
import express from "express"

const app = express()

// Use host-provided port OR fallback to 3000
const PORT = process.env.PORT || 3000

app.get("/", (req, res) => {
  res.send("🤖 GibborLee Bot is LIVE")
})

app.get("/health", (req, res) => {
  res.send("OK")
})

app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`)
})

const logger = pino({ level: "silent" })

// ================= CONFIG =================
const PREFIX = "."
const WARN_LIMIT = 3
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
  viewadmins: "👮 Show group admins",
  grouplink: "🔗 Get group invite link",
  revoke: "♻️ Reset group invite link",

  approve: "✅ Accept join request",
  reject: "❌ Decline join request",

  welcome: "👋 Toggle welcome messages",
  goodbye: "👋 Toggle goodbye messages",

  tagall: "📣 Mention all members",
  hidetag: "📌 Send hidden mention message",
  tagonline: "🟢 Tag only active users",

  vv: "👁️ Recover view-once media",
  pp: "🖼️ Get profile picture HD",

  addowner: "➕ Add bot owner",
  delowner: "➖ Remove bot owner",
  owners: "👑 Show all bot owners",

  whoami: "🆔 Show your WhatsApp JID"
}

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
    GROUP_SETTINGS[jid] = { 
      antidelete: false, 
      antilink: false,
      welcome: true,
      goodbye: true,
      antistatus: false,
      antistatus_mention: false
    }
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
    printQRInTerminal: false,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    browser: ["GibborLee", "Chrome", "1.0.0"]
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

      const botName = "GibborLee"

      console.log(`🤖 ${botName} is now online`)
      console.log("📌 Bot ID:", botId)

      console.log("✅ Owner set:", botId)
      console.log(`✅ ${session} connected`)


    // SAFE NOW
    setTimeout(() => {
      sock.sendPresenceUpdate("available")
    }, 3000)
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
    if (!msg.message) return
    

    const jid = msg.key.remoteJid || ""
    const isBot = msg.key.fromMe
    const isGroup = jid.includes("@g.us")
    const sender = normalizeJid(msg.key.participant || msg.key.remoteJid)
    const isDM = !isGroup
    const settings = getSettings(jid || "default")

const body =
  msg.message?.conversation ||
  msg.message?.extendedTextMessage?.text ||
  msg.message?.imageMessage?.caption ||
  msg.message?.videoMessage?.caption ||
  ""

    const reply = (text) =>
      sock.sendMessage(jid, { text }, { quoted: msg })

    const getTarget = () =>
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]

    // ================= ANTI STATUS =================
if (settings.antistatus || settings.antistatus_mention) {
  try {
    const msgType = msg.message

    const isStatus =
      msg.key.remoteJid === "status@broadcast"

    if (isStatus) {
      // delete status view
      if (settings.antistatus) {
        await sock.readMessages([msg.key])
      }

      // handle mentions inside status
      if (settings.antistatus_mention) {
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

  // ====== WELCOME AND GOODBYE EVENTS ====

sock.ev.on("group-participants.update", async (update) => {
  try {
    const { id, participants, action } = update

    if (!id || !participants || !action) return

    const settings = getSettings(id)

    let meta
    try {
      meta = await sock.groupMetadata(id)
    } catch (e) {
      console.log("Metadata error:", e)
      return
    }

    const groupName = meta.subject

    for (const user of participants) {
      const name =
        typeof user === "string"
          ? user.split("@")[0]
          : String(user).split("@")[0]


      // ===== WELCOME =====
      if (action === "add" && settings.welcome) {
        await sock.sendMessage(id, {
          text: `╔═══〔 👋 WELCOME 〕═══╗
┃ Hello @${name} 🎉
┃ Welcome to *${groupName}*
┃
┃ 📜 Follow group rules
┃ 🚫 No links or spam ❌
┃ 🤝 Respect everyone
╚═══════════════════╝`,
          mentions: [jid]
        })
      }

      // ===== GOODBYE =====
      if (action === "remove" && settings.goodbye) {
        await sock.sendMessage(id, {
          text: `╔═══〔 👋 GOODBYE 〕═══╗
┃ @${name} left the group 😢
┃ We will miss you!
╚═══════════════════╝`,
          mentions: [jid]
        })
      }
    }
  } catch (e) {
    console.log("❌ Welcome/Goodbye Error:", e)
  }
})


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
  const isCommand = body.startsWith(PREFIX)

  if (!body.startsWith(PREFIX)) return

if (isDM && !body.startsWith(PREFIX)) return

// allow DM commands, but restrict spam if needed
if (isDM) {
  if (!isCommand) return
}

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
   if (isGroup && settings.antilink && body) {
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

// prevent loop spam
if (isBot && !BOT_OWNERS.includes(sender)) return

    const args = body.slice(1).trim().split(/ +/)
    const cmd = args.shift().toLowerCase()

    const commands = {

      // ===== MEDIA =====
      vv: async () => {
  if (!isOwner) return reply("Owner only")

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

    reply("📩 Sent to your DM")

  } catch (e) {
    console.log(e)
    reply("❌ Failed to extract media")
  }
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
        return reply(" Added as Admin 👮")
      },

      demote: async () => {
        if (!isAdmin && !isOwner) return reply("❌ Admin only")
        const target = getTarget()
        await sock.groupParticipantsUpdate(jid, [target], "demote")
        return reply(" Removed as Admin 👮")
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

      admins: async () => {
  if (!isGroup) return reply("❌ Group only")

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
        if (!isOwner) return reply("Owner only")

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
        if (!isOwner) return reply("Owner only")

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

      // ==== WELCOME AND GOODBYE
      welcome: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

  settings.welcome = args[0] === "on"
  saveSettings()

  reply(`👋 Welcome messages ${settings.welcome ? "ON" : "OFF"}`)
},

goodbye: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

  settings.goodbye = args[0] === "on"
  saveSettings()

  reply(`👋 Goodbye messages ${settings.goodbye ? "ON" : "OFF"}`)
},
    

      // ===== TAG =====
     tageveryone: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

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
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

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
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

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
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

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

// ==== GROUP MANAGEMENT =====
setname: async () => {
  if (!isGroup) return reply("Group only")
  if (!isOwner && !isAdmin) return reply("Admin only")

  await sock.groupUpdateSubject(jid, args.join(" "))
  reply("✅ Group name updated")
},

setdesc: async () => {
  if (!isGroup) return reply("Group only")
  if (!isOwner && !isAdmin) return reply("Admin only")

  await sock.groupUpdateDescription(jid, args.join(" "))
  reply("📝 Description updated")
},

groupinfo: async () => {
  if (!isGroup) return reply("Group only")

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
  if (!isOwner && !isAdmin) return reply("Admin only")

  const code = await sock.groupInviteCode(jid)
  reply("🔗 https://chat.whatsapp.com/" + code)
},

revoke: async () => {
  if (!isOwner && !isAdmin) return reply("Admin only")

  await sock.groupRevokeInvite(jid)
  reply("🔄 Group link reset successful")
},

add: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

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
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

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
  if (!isOwner && !isAdmin) return reply("Admin only")

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
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

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
  if (!isOwner && !isAdmin) return reply("Admin only")

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
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

  settings.antistatus = args[0] === "on"
  saveSettings()

  reply(`🚫 Anti-status ${settings.antistatus ? "ON" : "OFF"}`)
},

antistatusmention: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

  settings.antistatus_mention = args[0] === "on"
  saveSettings()

  reply(`📢 Anti-status mention ${settings.antistatus_mention ? "ON" : "OFF"}`)
},

delete: async () => {
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

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
  if (!isGroup) return reply("❌ Group only")
  if (!isAdmin && !isOwner) return reply("❌ Admin only")

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

whoami: async () => {
  reply(`👤 Your JID:\n${sender}`)
},

      // ===== MENU =====
menu: async () => {

  const section = args[0]?.toLowerCase()

  // ===== FULL MENU =====
  if (!section) {
    let text = `
╔══════════════════════╗
║ 🤖 GIBBORLEE MENU    ║
╚══════════════════════╝

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
• welcome
• tag
• media
• owner
• info
`

    return reply(text)
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
    welcome: ["welcome", "goodbye"],
    tag: ["tagall", "hidetag", "tagonline"],
    media: ["vv", "pp"],
    owner: ["addowner", "delowner", "owners"],
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
        await react(jid, msg.key, "✅")
      } catch (e) {
        console.log(e)
        await react(jid, msg.key, "❌")
        reply("Error")
      }
    }
  })
}




// ================= MULTI SESSION =================
;["session1", "session2"].forEach(start)