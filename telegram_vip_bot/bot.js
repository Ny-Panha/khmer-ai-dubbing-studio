require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ Error: BOT_TOKEN is missing in .env!');
  process.exit(1);
}

// Create Bot instance with polling
const bot = new TelegramBot(token, { polling: true });

// Configuration variables
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID ? String(process.env.ADMIN_CHAT_ID).trim() : null;
let VIP_CHANNEL_ID = process.env.VIP_CHANNEL_ID ? String(process.env.VIP_CHANNEL_ID).trim() : null;
const PLAN_NAME = process.env.PLAN_NAME || 'Dragon Town VIP 1 Month';
const PRICE_USD = process.env.SUBSCRIPTION_PRICE_USD || '2.50';
const PRICE_KHR = process.env.SUBSCRIPTION_PRICE_KHR || '10,000';
const DURATION_DAYS = parseInt(process.env.SUBSCRIPTION_DAYS || '30', 10);
const BANK_NAME = process.env.BANK_NAME || 'ABA Bank';
const ACCOUNT_NAME = process.env.ACCOUNT_NAME || 'PANHA NY';
const ACCOUNT_USD = process.env.ACCOUNT_USD || '007 830 386';
const ACCOUNT_KHR = process.env.ACCOUNT_KHR || '009 858 816';
const KHQR_IMAGE_PATH = process.env.KHQR_IMAGE_PATH || 'assets/khqr.jpg';

console.log('🤖 Dragon Town Member Bot is running...');
console.log(`📌 Admin Chat ID: ${ADMIN_CHAT_ID || 'NOT SET'}`);
console.log(`📌 VIP Channel ID: ${VIP_CHANNEL_ID || 'NOT SET'}`);

// Helper: Escape HTML
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Helper: Format Date
function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Helper: Post announcement to General Topic in VIP Group
async function postToGeneralTopic(chatId, text) {
  try {
    await bot.sendMessage(chatId, text, { message_thread_id: 1, parse_mode: 'HTML' });
  } catch (err) {
    try {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (e) {
      console.warn('Could not post announcement to group:', e.message);
    }
  }
}

// Global polling error logger
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code, error.message);
});

// -------------------------------------------------------------
// 1. /myid and /getid command
// -------------------------------------------------------------
bot.onText(/\/(myid|getid|id)/i, async (msg) => {
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup' || msg.chat.type === 'channel';

  try {
    if (isGroup) {
      const groupText = `📍 <b>Group / Channel Info:</b>\n\n` +
        `- Title: <b>${escapeHTML(msg.chat.title)}</b>\n` +
        `- <b>Chat ID:</b> <code>${chatId}</code>\n\n` +
        `👉 Copy Chat ID នេះយកទៅដាក់ក្នុង <code>VIP_CHANNEL_ID</code> នៃ file <code>.env</code>!`;

      await bot.sendMessage(chatId, groupText, { parse_mode: 'HTML' });
    } else {
      const userText = `👤 <b>ព័ត៌មានគណនីរបស់អ្នក:</b>\n\n` +
        `- Name: <b>${escapeHTML(msg.from.first_name || '')} ${escapeHTML(msg.from.last_name || '')}</b>\n` +
        `- Username: @${escapeHTML(msg.from.username || 'គ្មាន')}\n` +
        `- <b>User ID:</b> <code>${msg.from.id}</code>\n\n` +
        `👉 Copy User ID នេះយកទៅដាក់ក្នុង <code>ADMIN_CHAT_ID</code> នៃ file <code>.env</code>!`;

      await bot.sendMessage(chatId, userText, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('Error in /myid:', err.message);
  }
});

// -------------------------------------------------------------
// 2. /start command
// -------------------------------------------------------------
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const user = db.getUser(userId);

  try {
    // Check if user is already an active VIP
    if (user && user.status === 'active' && new Date(user.expiryDate) > new Date()) {
      const daysLeft = Math.ceil((new Date(user.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
      return bot.sendMessage(
        chatId,
        `👑 <b>សួស្តី ${escapeHTML(msg.from.first_name)}!</b>\n\n` +
        `អ្នកជាសមាជិក <b>VIP សកម្ម</b> រួចហើយ៖\n\n` +
        `- កញ្ចប់៖ <b>${escapeHTML(PLAN_NAME)}</b>\n` +
        `- ផុតកំណត់នៅ៖ <b>${formatDate(user.expiryDate)}</b>\n` +
        `- នៅសល់៖ <b>${daysLeft} ថ្ងៃទៀត</b>\n\n` +
        `🎬 សូមរីករាយទស្សនារឿងភាគចិន/Anime ទាំងអស់ក្នុង VIP Group!`,
        { parse_mode: 'HTML' }
      );
    }

    // Welcome message with payment information
    const welcomeText = `🎬 <b>សូមស្វាគមន៍មកកាន់ ${escapeHTML(PLAN_NAME)}!</b>\n\n` +
      `ទស្សនារឿងភាគចិន/Anime បញ្ចូលសំឡេងខ្មែរ ច្បាស់ត្រជាក់ភ្នែក គ្មានពាណិជ្ជកម្មរំខាន ភាគថ្មីៗមុនគេ!\n\n` +
      `💎 <b>តម្លៃសមាជិក VIP:</b>\n` +
      `- រយៈពេល៖ <b>${DURATION_DAYS} ថ្ងៃ (១ ខែ)</b>\n` +
      `- តម្លៃ៖ <b>$${PRICE_USD}</b> ឬ <b>${PRICE_KHR} ៛</b>\n\n` +
      `💳 <b>ព័ត៌មានបង់ប្រាក់:</b>\n` +
      `- ធនាគារ៖ <b>${escapeHTML(BANK_NAME)}</b>\n` +
      `- ឈ្មោះគណនី៖ <b>${escapeHTML(ACCOUNT_NAME)}</b>\n` +
      `- USD Account: <code>${escapeHTML(ACCOUNT_USD)}</code>\n` +
      `- KHR Account: <code>${escapeHTML(ACCOUNT_KHR)}</code>\n\n` +
      `📩 <b>របៀបភ្ជាប់ VIP:</b>\n` +
      `1. ផ្ទេរប្រាក់តាមគណនីខាងលើ (ឬស្កេន KHQR)\n` +
      `2. <b>ផ្ញើរូបភាពវិក្កយបត្រ (Payment Slip/Screenshot)</b> ចូលមកក្នុង Chat នេះ\n` +
      `3. ប្រព័ន្ធនឹងផ្ទៀងផ្ទាត់ និងផ្ញើ <b>Link ចូល VIP ជូនភ្លាមៗ!</b>`;

    const khqrPath = path.resolve(__dirname, KHQR_IMAGE_PATH);
    if (fs.existsSync(khqrPath)) {
      await bot.sendPhoto(chatId, khqrPath, { caption: welcomeText, parse_mode: 'HTML' });
    } else {
      await bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('Error in /start:', err.message);
  }
});

// -------------------------------------------------------------
// 3. /status command
// -------------------------------------------------------------
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const user = db.getUser(userId);

  try {
    if (!user || user.status !== 'active' || new Date(user.expiryDate) <= new Date()) {
      return bot.sendMessage(chatId, `⚠️ អ្នកមិនទាន់ជាសមាជិក VIP ឬកញ្ចប់របស់អ្នកបានផុតកំណត់ហើយ។\n\nចុច /start ដើម្បីមើលព័ត៌មានបង់ប្រាក់ចូល VIP!`);
    }

    const daysLeft = Math.ceil((new Date(user.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
    bot.sendMessage(
      chatId,
      `👑 <b>ស្ថានភាព VIP របស់អ្នក:</b>\n\n` +
      `- ស្ថានភាព៖ <b>សកម្ម (Active)</b>\n` +
      `- ថ្ងៃចូល៖ <b>${formatDate(user.joinedAt)}</b>\n` +
      `- ថ្ងៃផុតកំណត់៖ <b>${formatDate(user.expiryDate)}</b>\n` +
      `- នៅសល់៖ <b>${daysLeft} ថ្ងៃ</b>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('Error in /status:', err.message);
  }
});

// -------------------------------------------------------------
// 4. Handle Payment Slip (Photo upload from User)
// -------------------------------------------------------------
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const user = msg.from;

  // Ignore photos sent in groups
  if (msg.chat.type !== 'private') return;

  const photo = msg.photo[msg.photo.length - 1]; // Highest resolution
  const fileUniqueId = photo.file_unique_id;

  // 1. Anti-Fraud: Check if this exact slip image was already submitted/used before!
  if (db.isSlipUsed(fileUniqueId)) {
    console.log(`[FRAUD PREVENTED] Duplicate slip rejected for user ${userId} (${user.first_name})`);
    return bot.sendMessage(
      chatId,
      `⚠️ <b>វិក្កយបត្រនេះធ្លាប់ត្រូវបានប្រើប្រាស់រួចហើយ!</b>\n\n` +
      `ប្រព័ន្ធបានរកឃើញថារូបភាពវិក្កយបត្រនេះ ធ្លាប់បានប្រើប្រាស់រួចមកហើយ។ សូមកុំផ្ញើវិក្កយបត្រចាស់ ឬដដែល។\n\n` +
      `ប្រសិនបើមានបញ្ហា ឬការយល់ច្រឡំ សូមទាក់ទងមក Admin ដោយផ្ទាល់!`,
      { parse_mode: 'HTML' }
    );
  }

  // 2. Prevent spamming: Check if user already has a pending payment waiting for approval
  if (db.hasPendingPayment(userId)) {
    return bot.sendMessage(
      chatId,
      `⏳ <b>អ្នកមានសំណើមួយកំពុងស្ថិតក្នុងការត្រួតពិនិត្យរួចហើយ!</b>\n\n` +
      `សូមមេត្តារង់ចាំ Admin ពិនិត្យបន្តិច ប្រព័ន្ធនឹងផ្ញើ Link ជូនភ្លាមៗនៅពេលបាន Approve។ មិនចាំបាច់ផ្ញើរូបភាពដដែលៗច្រើនដងទេ។`,
      { parse_mode: 'HTML' }
    );
  }

  const paymentId = `pay_${Date.now()}`;

  // Notify User
  await bot.sendMessage(
    chatId,
    `✅ <b>ទទួលបានវិក្កយបត្រហើយ!</b>\n\n` +
    `Admin កំពុងត្រួតពិនិត្យ ពេលផ្ទៀងផ្ទាត់រួច ប្រព័ន្ធនឹងផ្ញើ Link ចូល VIP ជូនអ្នកភ្លាមៗ។ សូមអរគុណ!`,
    { parse_mode: 'HTML' }
  );

  // If Admin is configured, forward slip for 1-Click Approval
  if (ADMIN_CHAT_ID) {
    const adminCaption = `📩 <b>សំណើសុំចូល VIP ថ្មី!</b>\n\n` +
      `👤 ឈ្មោះ: <b>${escapeHTML(user.first_name || '')} ${escapeHTML(user.last_name || '')}</b>\n` +
      `🔗 Username: @${escapeHTML(user.username || 'គ្មាន')}\n` +
      `🆔 User ID: <code>${userId}</code>\n` +
      `💰 កញ្ចប់: <b>${escapeHTML(PLAN_NAME)}</b>\n` +
      `📅 ម៉ោង: <b>${formatDate(new Date())}</b>`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Approve (1 ខែ)', callback_data: `approve:${userId}:${paymentId}` },
          { text: '❌ Reject', callback_data: `reject:${userId}:${paymentId}` }
        ]
      ]
    };

    try {
      const sentMsg = await bot.sendPhoto(ADMIN_CHAT_ID, photo.file_id, {
        caption: adminCaption,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      });

      db.savePendingPayment({
        id: paymentId,
        userId: userId,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        username: user.username || null,
        photoFileId: photo.file_id,
        fileUniqueId: fileUniqueId,
        adminMessageId: sentMsg.message_id
      });
    } catch (err) {
      console.error('Error sending slip to admin:', err.message);
    }
  } else {
    console.warn('⚠️ Warning: ADMIN_CHAT_ID is not configured in .env! Cannot forward slip to Admin.');
  }
});

// -------------------------------------------------------------
// 5. Handle Admin Callback (Approve / Reject)
// -------------------------------------------------------------
bot.on('callback_query', async (query) => {
  const adminId = String(query.from.id);
  const data = query.data;

  // Security check: Only Admin can click
  if (ADMIN_CHAT_ID && adminId !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(query.id, { text: '⛔ អ្នកគ្មានសិទ្ធិអនុម័តទេ!', show_alert: true });
  }

  const [action, targetUserId, paymentId] = data.split(':');

  if (action === 'approve') {
    if (!VIP_CHANNEL_ID) {
      return bot.answerCallbackQuery(query.id, { text: '❌ Error: VIP_CHANNEL_ID មិនទាន់ដាក់ក្នុង .env ទេ!', show_alert: true });
    }

    try {
      // 0. Ensure user is unbanned if they were previously removed or expired
      try {
        await bot.unbanChatMember(VIP_CHANNEL_ID, targetUserId, { only_if_banned: true });
      } catch (e) {
        // Ignore if user was not banned
      }

      // 1. Create a SINGLE-USE invite link (member_limit: 1, expire in 48h if unused)
      const expireUnix = Math.floor(Date.now() / 1000) + (48 * 3600);
      let inviteLinkObj;
      try {
        inviteLinkObj = await bot.createChatInviteLink(VIP_CHANNEL_ID, {
          member_limit: 1,
          expire_date: expireUnix,
          name: `VIP-${targetUserId}`
        });
      } catch (err) {
        if (err.response?.body?.parameters?.migrate_to_chat_id) {
          VIP_CHANNEL_ID = String(err.response.body.parameters.migrate_to_chat_id);
          console.log(`[AUTO-MIGRATE] Upgraded to Supergroup ID: ${VIP_CHANNEL_ID}`);
          inviteLinkObj = await bot.createChatInviteLink(VIP_CHANNEL_ID, {
            member_limit: 1,
            expire_date: expireUnix,
            name: `VIP-${targetUserId}`
          });
        } else {
          throw err;
        }
      }

      // 2. Calculate Expiry Date (30 Days from now)
      const expiryDate = new Date(Date.now() + DURATION_DAYS * 24 * 60 * 60 * 1000);

      // 3. Save to Database
      db.saveUser({
        userId: targetUserId,
        joinedAt: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        status: 'active',
        inviteLink: inviteLinkObj.invite_link,
        reminderSent: false
      });

      db.updatePayment(paymentId, { status: 'approved' });

      // 4. Send the exclusive single-use link to user (Exact Match to 3SAJ VIP Format)
      const congratText = `🎉 <b>សូមស្វាគមន៍មកកាន់ ${escapeHTML(PLAN_NAME)}!</b>\n\n` +
        `🌟 <b>សូមអរគុណសម្រាប់ការជាវសមាជិក VIP របស់យើងខ្ញុំ</b>\n` +
        `⌛ <b>សុពលភាព: 1 ខែ</b> (ផុតកំណត់: ${formatDate(expiryDate)})\n` +
        `🔗 <b>Link ចូលក្រុម:</b>\n` +
        `${inviteLinkObj.invite_link}\n\n` +
        `⚠️ <b>ចំណាំ: Link នេះសម្រាប់ប្រើតែ 1 នាក់ប៉ុណ្ណោះ</b>\n` +
        `<b>ហើយនឹងផុតសុពលភាពភ្លាមៗពេលចុចចូលរួច!</b>`;

      await bot.sendMessage(targetUserId, congratText, { parse_mode: 'HTML' });

      // 5. Post Announcement in # General Topic (3SAJ VIP Style!)
      const paymentInfo = db.getPayment(paymentId);
      const memberName = paymentInfo?.name || 'សមាជិកថ្មី';
      const generalText = `🎉 <b>សូមស្វាគមន៍មកកាន់ ${escapeHTML(PLAN_NAME)}!</b>\n\n` +
        `👤 <b>សមាជិក:</b> ${escapeHTML(memberName)}\n` +
        `⌛ <b>រយៈពេលសមាជិក:</b> 1 ខែ\n` +
        `📅 <b>ផុតកំណត់នៅ:</b> ${formatDate(expiryDate)}\n\n` +
        `✨ <b>សូមរីករាយជាមួយការចែករំលែក និងអត្ថប្រយោជន៍ VIP!</b> ✨`;

      await postToGeneralTopic(VIP_CHANNEL_ID, generalText);

      // 6. Update Admin message
      await bot.editMessageCaption(
        `${query.message.caption}\n\n✅ <b>APPROVED ដោយ Admin</b>\n🔗 Link: ${inviteLinkObj.invite_link}\n📅 ផុតកំណត់: ${formatDate(expiryDate)}`,
        {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'HTML'
        }
      );

      bot.answerCallbackQuery(query.id, { text: '✅ បាន Approve និងផ្ញើ Link រួចរាល់!' });
    } catch (err) {
      console.error('Error creating invite link or sending to user:', err.message);
      bot.answerCallbackQuery(query.id, { text: `❌ Error: ${err.message}`, show_alert: true });
    }
  } else if (action === 'reject') {
    db.updatePayment(paymentId, { status: 'rejected' });

    // Inform user
    bot.sendMessage(
      targetUserId,
      `⚠️ <b>ការជូនដំណឹង៖</b>\n\nវិក្កយបត្ររបស់អ្នកមិនត្រូវបានអនុម័តទេ (អាចមកពីផ្ទេរមិនគ្រប់ ឬមិនឃើញទឹកប្រាក់ចូល)។\nសូមពិនិត្យឡើងវិញ ឬទាក់ទងមក Admin ដោយផ្ទាល់!`,
      { parse_mode: 'HTML' }
    );

    // Update Admin message
    bot.editMessageCaption(
      `${query.message.caption}\n\n❌ <b>REJECTED ដោយ Admin</b>`,
      {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML'
      }
    );

    bot.answerCallbackQuery(query.id, { text: '❌ បាន Reject សំណើនេះ' });
  }
});

// -------------------------------------------------------------
// 6. Scheduled Cron Job (Runs every hour to check expiry & auto-kick)
// -------------------------------------------------------------
cron.schedule('0 * * * *', async () => {
  console.log('⏰ Running VIP membership expiry check...');
  if (!VIP_CHANNEL_ID) return;

  const users = db.getAllUsers();
  const now = new Date();

  for (const user of users) {
    if (user.status !== 'active') continue;

    const expiry = new Date(user.expiryDate);

    // Case A: Expired -> AUTO KICK!
    if (now >= expiry) {
      console.log(`🚫 User ${user.userId} has expired. Kicking from VIP...`);
      try {
        await bot.banChatMember(VIP_CHANNEL_ID, user.userId);
        await bot.unbanChatMember(VIP_CHANNEL_ID, user.userId);

        db.saveUser({ userId: user.userId, status: 'expired' });

        // Inform User
        bot.sendMessage(
          user.userId,
          `⚠️ <b>VIP Membership របស់អ្នកបានផុតកំណត់ 30 ថ្ងៃហើយ!</b>\n\n` +
          `ដើម្បីបន្តទស្សនារឿងភាគថ្មីៗ សូមចុច /start ដើម្បីបង់ប្រាក់បន្តកញ្ចប់ VIP ថ្មី។ សូមអរគុណ!`,
          { parse_mode: 'HTML' }
        );

        // Notify Admin
        if (ADMIN_CHAT_ID) {
          bot.sendMessage(
            ADMIN_CHAT_ID,
            `ℹ️ <b>Auto-Kick:</b> User ID <code>${user.userId}</code> (${escapeHTML(user.name || '')}) បានផុតកំណត់ 30 ថ្ងៃ ហើយ Bot បាន kick ចេញពី VIP Group រួចរាល់។`,
            { parse_mode: 'HTML' }
          );
        }
      } catch (err) {
        console.error(`Failed to kick user ${user.userId}:`, err.message);
      }
    }
    // Case B: Reminder (Within 2 days of expiry)
    else {
      const hoursLeft = (expiry - now) / (1000 * 60 * 60);
      if (hoursLeft <= 48 && !user.reminderSent) {
        console.log(`📩 Sending 48h reminder to User ${user.userId}...`);
        try {
          await bot.sendMessage(
            user.userId,
            `⏰ <b>ជម្រាបសួរ ${escapeHTML(user.name || '')}!</b>\n\n` +
            `កញ្ចប់ VIP របស់អ្នកនឹងផុតកំណត់នៅថ្ងៃ <b>${formatDate(expiry)}</b> (សល់ ២ ថ្ងៃទៀត)។\n\n` +
            `ដើម្បីកុំឱ្យដាច់ការទស្សនា សូមចុច /start ដើម្បីបង់ប្រាក់បន្តកញ្ចប់ជាមុន!`,
            { parse_mode: 'HTML' }
          );
          db.saveUser({ userId: user.userId, reminderSent: true });
        } catch (err) {
          console.error(`Failed to send reminder to user ${user.userId}:`, err.message);
        }
      }
    }
  }
});

// -------------------------------------------------------------
// 7. /stats command (Admin Only)
// -------------------------------------------------------------
bot.onText(/\/stats/, (msg) => {
  const userId = String(msg.from.id);
  if (ADMIN_CHAT_ID && userId !== ADMIN_CHAT_ID) return;

  const users = db.getAllUsers();
  const active = users.filter(u => u.status === 'active' && new Date(u.expiryDate) > new Date()).length;
  const expired = users.filter(u => u.status === 'expired' || new Date(u.expiryDate) <= new Date()).length;

  bot.sendMessage(
    msg.chat.id,
    `📊 <b>ស្ថិតិ VIP Membership:</b>\n\n` +
    `- សមាជិកសកម្ម (Active): <b>${active} នាក់</b>\n` +
    `- ផុតកំណត់ (Expired): <b>${expired} នាក់</b>\n` +
    `- សរុបទាំងអស់: <b>${users.length} នាក់</b>`,
    { parse_mode: 'HTML' }
  );
});

// -------------------------------------------------------------
// 8. /invite or /link command (Admin Only - Manual Invite Link Generator)
// -------------------------------------------------------------
bot.onText(/\/(invite|link)/i, async (msg) => {
  const userId = String(msg.from.id);
  if (ADMIN_CHAT_ID && userId !== ADMIN_CHAT_ID) return;

  try {
    const expireUnix = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 days
    const linkObj = await bot.createChatInviteLink(VIP_CHANNEL_ID, {
      member_limit: 1,
      expire_date: expireUnix,
      name: `Admin-Gen-${Date.now()}`
    });

    await bot.sendMessage(
      msg.chat.id,
      `🔗 <b>Link ចូលក្រុម VIP (បង្កើតដោយ Dragon Town VIP Access):</b>\n\n` +
      `${linkObj.invite_link}\n\n` +
      `⚠️ <b>ចំណាំ:</b> Link នេះប្រើបានតែ 1 នាក់ប៉ុណ្ណោះ និងមានសុពលភាព 7 ថ្ងៃ។ ពេលផ្ញើទៅនរណាម្នាក់ Telegram នឹងបង្ហាញថា:\n` +
      `<i>«Dragon Town VIP Access invites you to join this group on Telegram.»</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('Error generating invite link:', err.message);
    bot.sendMessage(msg.chat.id, `❌ បរាជ័យក្នុងការបង្កើត Link: ${err.message}`);
  }
});

console.log('✅ Bot is initialized and listening for messages!');
