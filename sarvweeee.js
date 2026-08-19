const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const { debugLog, getRecentLogs } = require('./utils/logger');
const adsModule = require('./adsModule');

process.on('uncaughtException', (err) => {
    debugLog('CrashGuard', 'Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
    debugLog('CrashGuard', 'Unhandled Rejection:', reason);
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const MONGO_URI = 'mongodb+srv://sibadityapal47_db_user:G95Dds7IGyBQNmGh@cluster0.yjvazin.mongodb.net/jpw_bot?retryWrites=true&w=majority';
const ADMIN_SECRET_PASS = 'jpwadmin123';
const ADMIN_CHAT_ID = '7659178694';

// 🔑 Telegram Userbot MTProto Credentials
const TELEGRAM_API_ID = 38455899;
const TELEGRAM_API_HASH = '8ac60b108999ecd996b12a6f6d1e66b1';
const TELEGRAM_SESSION_STRING = '1BQANOTEuMTA4LjU2LjEzMgG7wbV1tN8uiJlNmwa0DakcabyRVzTLERHbQnMpd9Pf+r/OxQ10aXpYCUmuq5mDn+hOqqbEpQyPBZuMo8U7gvAcRL5fcdPLOFJE069pmIwPho8ldbaDlC/m0VtDVui1jGVtVTV/w2zQmbfIXiw6lnZHQu3q5tqWCSg+ue18BMl1wjDlqE14ZNrczrVMP7ddUWIo5x1CskvLuLV5dF096xEvWc64ieYkL2+tVwigrXR9DIOfC1brU5D1l1GaQPdTH+96ck/3tmViEwo8NRD71lS6FFTptlcVBUVtaQczLoFGc+GbJflwM+MrLExju/coYPLeV0vxJi9eTZjA17IaGIxCgA==';

// 👇 Jis Bot ko ID/Pass bhejte hain uska username dalein
const TARGET_THIRD_PARTY_BOT = process.env.TARGET_BOT_USERNAME || '@JPWREACHEDBOT';

let userbotClient = null;
const activeCheckIntervals = {};

// 🔑 Cashfree Production Credentials
const CASHFREE_CLIENT_ID = '132151420cc80e33a29ab5a896e4151231';
const CASHFREE_CLIENT_SECRET = 'cfsk_ma_prod_07c2ec902f0ab79b31d72c924423b03a_edc81cf8';

// 🤖 Customer Bot Tokens
const CUSTOMER_BOT_TOKENS = [
    '8874503246:AAEmdPcVJMQ3q6pmINsP_Tcwium3ANV4T6I',
    '8972064227:AAG3LadKR0mLXJgU3xL6BwMy7TxjYz8N3Rw'
];

// 👑 Admin Bot Token
const ADMIN_BOT_TOKEN = '8736759061:AAGaSKOCQ9gUylCsqdAufHenEPeDQhQtSDU';

// 📦 Recharge Packages (Dynamic Handler)
const RECHARGE_PACKAGES = [
    { amount: 13, coins: 1 },
    { amount: 60, coins: 5 },
    { amount: 115, coins: 10 },
    { amount: 210, coins: 20 },
    { amount: 400, coins: 40 }
];

let otpStorage = {};
let adminPendingReply = {};
let adminPendingSrReply = {};
let adminPendingBroadcast = false;
let adminPendingEditSearch = false;
let adminPendingCustomerDetails = false;
let primaryCustomerBotUsername = 'JPWREACHSERVICESBOT';
let serverPublicUrl = 'https://cashtree.space';

// 🕒 Working Hours Checker (Updated: 7:00 AM - 10:00 PM IST)
function isServiceOpen() {
    const now = new Date();
    const istHours = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();
    return istHours >= 7 && istHours < 22;
}

// 🛡️ Intelligent Message Sanitizer (Filters Sensitive Data & Updates to Live Time)
function sanitizeCustomerMessage(rawText) {
    if (!rawText) return '';
    const getCurrentTime = () => {
        return new Date().toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    };

    let sanitized = rawText
        .split('\n')
        .filter(line => {
            const lower = line.toLowerCase();
            return !lower.includes('remaining reaches') &&
                    !lower.includes('plan:') &&
                    !lower.includes('valid till') &&
                    !lower.includes('subscription') &&
                    !lower.includes('use money on next reach') &&
                    !lower.includes('wallet balance:');
        })
        .join('\n');

    sanitized = sanitized.replace(/\d{1,2}:\d{2}\s?(am|pm|AM|PM)/gi, getCurrentTime());
    return sanitized.replace(/\n{3,}/g, '\n\n').trim();
}

// ⏱️ Auto-Polling Manager (2 Mins Interval, Max 10 Mins)
function startAutoRecheck(orderId, targetId, targetPass) {
    if (activeCheckIntervals[orderId]) return;
    let attempts = 0;
    const maxAttempts = 5;

    debugLog('Userbot', `⏳ Auto-polling started for ${targetId} (every 2 mins)`);

    activeCheckIntervals[orderId] = setInterval(async () => {
        attempts++;
        try {
            const currentOrder = await OrderModel.findById(orderId);
            if (!currentOrder || ['Completed', 'Rejected', 'Cancelled & Refunded'].includes(currentOrder.status)) {
                stopAutoRecheck(orderId);
                return;
            }

            if (attempts >= maxAttempts) {
                debugLog('Userbot', `⏹️ Max 10 mins reached for ${targetId}. Stopping auto-polling.`);
                stopAutoRecheck(orderId);
                return;
            }

            await forwardOrderToTargetBot(targetId, targetPass);
            debugLog('Userbot', `🔄 Auto-recheck sent (${attempts}/${maxAttempts}) for ${targetId}`);
        } catch (e) {
            debugLog('Userbot', `❌ Auto-recheck error: ${e.message}`);
        }
    }, 2 * 60 * 1000);
}

function stopAutoRecheck(orderId) {
    if (activeCheckIntervals[orderId]) {
        clearInterval(activeCheckIntervals[orderId]);
        delete activeCheckIntervals[orderId];
        debugLog('Userbot', `⏹️ Auto-polling stopped for Order ID: ${orderId}`);
    }
}

// --- USERBOT BRIDGE ---
async function initUserbotBridge() {
    if (!TELEGRAM_SESSION_STRING) return;
    try {
        const session = new StringSession(TELEGRAM_SESSION_STRING);
        userbotClient = new TelegramClient(session, TELEGRAM_API_ID, TELEGRAM_API_HASH, { connectionRetries: 5 });
        await userbotClient.connect();
        debugLog('Userbot', '🟢 Personal Telegram Account Connected Successfully!');

        userbotClient.addEventHandler(async (event) => {
            const message = event.message;
            if (!message || message.out) return;

            const text = (message.message || '').toLowerCase();
            const rawText = message.message || '';
            const pendingOrders = await OrderModel.find({ status: { $in: ['Pending', 'Accepted', 'In Progress'] } });

            for (let order of pendingOrders) {
                if (rawText.includes(order.targetId) || pendingOrders.length === 1) {
                    let customerBot = CUSTOMER_BOT_TOKENS[0] ? new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false }) : null;
                    let adminBot = ADMIN_BOT_TOKEN ? new TelegramBot(ADMIN_BOT_TOKEN, { polling: false }) : null;
                    const cleanedText = sanitizeCustomerMessage(rawText);

                    // 1. COMPLETE / SUCCESS
                    if (text.includes('reached successfully') || text.includes('reach successful') || text.includes('status: success') || text.includes('completed in')) {
                        stopAutoRecheck(order._id);
                        order.status = 'Completed';
                        order.adminReply = cleanedText;
                        await order.save();

                        if (customerBot) {
                            await customerBot.sendMessage(order.telegramChatId, `${cleanedText}`, { parse_mode: 'Markdown' }).catch(async () => {
                                await customerBot.sendMessage(order.telegramChatId, `${cleanedText}`).catch(()=>{});
                            });
                        }
                        if (adminBot) {
                            await adminBot.sendMessage(ADMIN_CHAT_ID, `🎉 **Order Complete:** \`${order.targetId}\`\n\n${rawText}`, { parse_mode: 'Markdown' }).catch(()=>{});
                        }
                    }
                    // 2. REJECT / FAILED / INVALID / LOCKED (Auto-Refund 1 Coin)
                    else if (text.includes('login failed') || text.includes('invalid credentials') || text.includes('locked') || text.includes('reject') || text.includes('fail') || text.includes('error')) {
                        stopAutoRecheck(order._id);
                        order.status = 'Rejected';
                        order.adminReply = cleanedText;
                        await order.save();

                        await UserModel.findOneAndUpdate({ telegramChatId: order.telegramChatId }, { $inc: { jpwCoins: 1 } });

                        if (customerBot) {
                            await customerBot.sendMessage(order.telegramChatId, `${cleanedText}\n\n🪙 *1 JPW Coin has been refunded to your wallet!*`, { parse_mode: 'Markdown' }).catch(async () => {
                                await customerBot.sendMessage(order.telegramChatId, `${cleanedText}\n\n🪙 1 JPW Coin has been refunded to your wallet!`).catch(()=>{});
                            });
                        }
                        if (adminBot) {
                            await adminBot.sendMessage(ADMIN_CHAT_ID, `❌ **Order Rejected & Coin Refunded:** \`${order.targetId}\`\n\n${rawText}`, { parse_mode: 'Markdown' }).catch(()=>{});
                        }
                    }
                    // 3. QUEUED (Start 2-min Auto Recheck)
                    else if (text.includes('queued') || text.includes('queue:')) {
                        order.status = 'In Progress';
                        order.adminReply = cleanedText;
                        await order.save();

                        startAutoRecheck(order._id, order.targetId, order.targetPass);

                        if (customerBot) {
                            await customerBot.sendMessage(order.telegramChatId, `${cleanedText}`, { parse_mode: 'Markdown' }).catch(()=>{});
                        }
                    }
                    // 4. PROCESSING / STARTING (Stop 2-min Auto Recheck)
                    else if (text.includes('processing') || text.includes('starting reach') || text.includes('still reaching')) {
                        stopAutoRecheck(order._id);
                        order.status = 'In Progress';
                        order.adminReply = cleanedText;
                        await order.save();

                        if (customerBot) {
                            await customerBot.sendMessage(order.telegramChatId, `${cleanedText}`, { parse_mode: 'Markdown' }).catch(()=>{});
                        }
                    }
                    // 5. Default Update
                    else {
                        order.adminReply = cleanedText;
                        await order.save();
                        if (customerBot) {
                            await customerBot.sendMessage(order.telegramChatId, `💬 **Order Update:**\n\n${cleanedText}`, { parse_mode: 'Markdown' }).catch(()=>{});
                        }
                    }
                    break;
                }
            }
        }, new NewMessage({ incoming: true }));
    } catch(err) {
        debugLog('Userbot', '❌ Userbot Connection Error:', err.message);
    }
}

// Forward to Target Bot with Error Catch & Refund
async function forwardOrderToTargetBot(targetId, targetPass) {
    if (!userbotClient) {
        debugLog('Userbot', 'Userbot not ready');
        return false;
    }
    try {
        const payload = `${targetId} ${targetPass}`;
        await userbotClient.sendMessage(TARGET_THIRD_PARTY_BOT, { message: payload });
        debugLog('Userbot', `Sent to ${TARGET_THIRD_PARTY_BOT}: ${payload}`);
        return true;
    } catch(e) {
        debugLog('Userbot', 'Failed to send to target bot:', e.message);
        return false;
    }
}

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
    .then(async () => {
        debugLog('Database', '🟢 MongoDB Connected Successfully!');
        try {
            await mongoose.connection.collection('users').dropIndexes().catch(() => {});
        } catch(e) {}
        initAllBots();
        initUserbotBridge();
        startOrderCleanupTimer();
    })
    .catch(err => debugLog('Database', '❌ DB Error:', err.message));

// --- SCHEMAS ---
const userSchema = new mongoose.Schema({
    telegramChatId: { type: String, required: true, unique: true },
    customId: { type: String, unique: true, sparse: true },
    password: { type: String, default: null },
    name: { type: String, default: 'Engineer' },
    jpwCoins: { type: Number, default: 0 },
    activePackage: { type: String, default: 'No active package' },
    lastBonusTime: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

const orderSchema = new mongoose.Schema({
    telegramChatId: String,
    targetId: String,
    targetPass: String,
    status: { type: String, default: 'Pending' },
    adminReply: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const srSchema = new mongoose.Schema({
    telegramChatId: String,
    customerName: String,
    mobileNumber: String,
    landlineNumber: String,
    status: { type: String, default: 'Pending' },
    adminReplies: [String],
    createdAt: { type: Date, default: Date.now }
});

const usedUtrSchema = new mongoose.Schema({
    utrId: { type: String, required: true, unique: true }
});

const UserModel = mongoose.model('User', userSchema);
const OrderModel = mongoose.model('Order', orderSchema);
const SrModel = mongoose.model('SrService', srSchema);
const UsedUtrModel = mongoose.model('UsedUtr', usedUtrSchema);

function initAllBots() {
    CUSTOMER_BOT_TOKENS.forEach((token, idx) => {
        if (token) startCustomerBot(token, idx === 0);
    });
    if (ADMIN_BOT_TOKEN) {
        startAdminBot(ADMIN_BOT_TOKEN);
    }
}

function startOrderCleanupTimer() {
    setInterval(async () => {
        try {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            await OrderModel.deleteMany({ createdAt: { $lt: twoHoursAgo }, status: { $in: ['Completed', 'Rejected', 'Cancelled & Refunded'] } });
            await SrModel.deleteMany({ createdAt: { $lt: twoHoursAgo }, status: { $in: ['Completed', 'Rejected'] } });
        } catch (err) {}
    }, 60 * 60 * 1000);
}

// 🔔 Notification Handlers
async function notifyAdminAndUser(order, user, messageText) {
    try {
        let adminKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Accept", callback_data: `accept_${order._id}` },
                        { text: "❌ Reject", callback_data: `reject_${order._id}` }
                    ]
                ]
            }
        };

        if (ADMIN_BOT_TOKEN) {
            const tempBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: false });
            await tempBot.sendMessage(ADMIN_CHAT_ID, messageText, { parse_mode: 'Markdown', ...adminKeyboard });
        }
    } catch (e) {}
}

async function notifyAdminSrBot(srOrder) {
    try {
        if (ADMIN_BOT_TOKEN) {
            const tempBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: false });
            let keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ Accept", callback_data: `sraccept_${srOrder._id}` },
                            { text: "❌ Reject", callback_data: `srreject_${srOrder._id}` }
                        ]
                    ]
                }
            };
            await tempBot.sendMessage(ADMIN_CHAT_ID, `📌 **New SR Order Received**\n\n👤 Customer Name: ${srOrder.customerName}\n📞 Mobile: \`${srOrder.mobileNumber}\`\n☎️ Landline: \`${srOrder.landlineNumber || 'N/A'}\`\n💬 Engineer Chat ID: \`${srOrder.telegramChatId}\``, { parse_mode: 'Markdown', ...keyboard });
        }
    } catch(e) {}
}

// 👑 Admin Bot Management
function startAdminBot(token) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});

        bot.on('message', async (msg) => {
            if (!msg || !msg.chat || !msg.text) return;
            const chatId = String(msg.chat.id);
            if (chatId !== ADMIN_CHAT_ID) return;

            const text = msg.text.trim();

            if (text.startsWith('/start') || text.toLowerCase() === 'admin' || text.toLowerCase() === 'menu') {
                adminPendingBroadcast = false;
                adminPendingEditSearch = false;
                adminPendingCustomerDetails = false;
                const adminKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "📊 View All Stats", callback_data: "admin_stats" },
                                { text: "⚡ Pending Reach Orders", callback_data: "admin_reach_orders" }
                            ],
                            [
                                { text: "📌 Pending SR Orders", callback_data: "admin_sr_orders" },
                                { text: "📢 Send Announcement", callback_data: "admin_broadcast" }
                            ],
                            [
                                { text: "✏️ Edit Order", callback_data: "admin_edit_order" },
                                { text: "👤 Customer Details / Logs", callback_data: "admin_customer_details" }
                            ],
                            [
                                { text: "🌐 Open Admin Web Panel", url: "https://cashtree.space/admin" }
                            ]
                        ]
                    }
                };
                await bot.sendMessage(chatId, `👑 **JPW Super Admin Control Panel** 🚀\n\nWelcome Boss! Choose an option below:`, { parse_mode: 'Markdown', ...adminKeyboard });
                return;
            }

            if (adminPendingBroadcast) {
                adminPendingBroadcast = false;
                const users = await UserModel.find({ telegramChatId: { $not: /^WEB_/ } });
                let sentCount = 0;

                if (CUSTOMER_BOT_TOKENS[0]) {
                    const tempCustBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
                    for (let u of users) {
                        try {
                            await tempCustBot.sendMessage(u.telegramChatId, `📢 **Important Announcement from Admin:**\n\n${text}`, { parse_mode: 'Markdown' });
                            sentCount++;
                        } catch(err) {}
                    }
                }
                bot.sendMessage(chatId, `✅ Announcement successfully sent to *${sentCount}* active engineers!`, { parse_mode: 'Markdown' });
                return;
            }

            if (adminPendingCustomerDetails) {
                adminPendingCustomerDetails = false;
                const searchKey = text;

                let user = await UserModel.findOne({
                    $or: [{ telegramChatId: searchKey }, { customId: searchKey }, { name: new RegExp(searchKey, 'i') }]
                });

                let reachOrders = await OrderModel.find({
                    $or: [{ targetId: searchKey }, { telegramChatId: user ? user.telegramChatId : searchKey }]
                }).sort({ createdAt: -1 }).limit(5);

                let srOrders = await SrModel.find({
                    $or: [{ mobileNumber: searchKey }, { customerName: new RegExp(searchKey, 'i') }, { telegramChatId: user ? user.telegramChatId : searchKey }]
                }).sort({ createdAt: -1 }).limit(5);

                if (!user && reachOrders.length === 0 && srOrders.length === 0) {
                    bot.sendMessage(chatId, `❌ Koi details nahi mili for: \`${searchKey}\``, { parse_mode: 'Markdown' });
                    return;
                }

                let responseMsg = `👤 **Customer & Order Summary** 📋\n\n`;
                if (user) {
                    responseMsg += `👤 Name: *${user.name}*\n💬 Chat ID: \`${user.telegramChatId}\`\n🪙 Coins: *${user.jpwCoins.toFixed(2)}*\n📦 Package: *${user.activePackage}*\n\n`;
                }

                if (reachOrders.length > 0) {
                    responseMsg += `⚡ **Recent Reach Orders:**\n`;
                    reachOrders.forEach(ro => {
                        responseMsg += `• ID: \`${ro.targetId}\` | Pass: \`${ro.targetPass}\`\n  Status: *${ro.status}*\n  Admin Reply: _${ro.adminReply || 'No reply'}_\n  Date: ${new Date(ro.createdAt).toLocaleDateString()}\n\n`;
                    });
                }

                if (srOrders.length > 0) {
                    responseMsg += `📌 **Recent SR Orders:**\n`;
                    srOrders.forEach(so => {
                        responseMsg += `• Name: *${so.customerName}* | Mobile: \`${so.mobileNumber}\`\n  Status: *${so.status}*\n  Replies: _${so.adminReplies.length ? so.adminReplies.join(', ') : 'No reply'}_\n  Date: ${new Date(so.createdAt).toLocaleDateString()}\n\n`;
                    });
                }

                bot.sendMessage(chatId, responseMsg, { parse_mode: 'Markdown' });
                return;
            }

            if (adminPendingEditSearch) {
                adminPendingEditSearch = false;
                const searchId = text;

                let order = await OrderModel.findOne({ targetId: searchId }).sort({ createdAt: -1 });
                if (order) {
                    const orderKeyboard = {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "🔄 Change Status", callback_data: `editstatus_reach_${order._id}` },
                                    { text: "💬 Send Reply", callback_data: `editreply_reach_${order._id}` }
                                ],
                                [
                                    { text: "📋 View Full History", callback_data: `history_reach_${order._id}` }
                                ]
                            ]
                        }
                    };
                    bot.sendMessage(chatId, `⚡ **Reach Order Found:**\n\n🎯 Target ID: \`${order.targetId}\`\n🔑 Password: \`${order.targetPass}\`\n📌 Current Status: *${order.status}*\n💬 Chat ID: \`${order.telegramChatId}\`\n📢 Latest Reply: _${order.adminReply || 'None'}_\n\n👇 **Kya karna chahte hain?**`, { parse_mode: 'Markdown', ...orderKeyboard });
                    return;
                }

                let srOrder = await SrModel.findOne({
                    $or: [{ mobileNumber: searchId }, { customerName: new RegExp(searchId, 'i') }]
                }).sort({ createdAt: -1 });

                if (srOrder) {
                    const srKeyboard = {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "🔄 Change Status", callback_data: `editstatus_sr_${srOrder._id}` },
                                    { text: "💬 Send Reply", callback_data: `editreply_sr_${srOrder._id}` }
                                ],
                                [
                                    { text: "📋 View Full History", callback_data: `history_sr_${srOrder._id}` }
                                ]
                            ]
                        }
                    };
                    bot.sendMessage(chatId, `📌 **SR Order Found:**\n\n👤 Customer: *${srOrder.customerName}*\n📞 Mobile: \`${srOrder.mobileNumber}\`\n☎️ Landline: \`${srOrder.landlineNumber || 'N/A'}\`\n📌 Current Status: *${srOrder.status}*\n💬 Chat ID: \`${srOrder.telegramChatId}\`\n📢 Replies: _${srOrder.adminReplies.length ? srOrder.adminReplies.join(' | ') : 'None'}_\n\n👇 **Kya karna chahte hain?**`, { parse_mode: 'Markdown', ...srKeyboard });
                    return;
                }

                bot.sendMessage(chatId, `❌ Koi bhi order nahi mila Target ID / Mobile: \`${searchId}\``, { parse_mode: 'Markdown' });
                return;
            }

            if (adminPendingReply[chatId]) {
                const orderId = adminPendingReply[chatId];
                delete adminPendingReply[chatId];
                let order = await OrderModel.findById(orderId);
                if (order) {
                    order.adminReply = text;
                    await order.save();
                    if (CUSTOMER_BOT_TOKENS[0]) {
                        const tempCustBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
                        await tempCustBot.sendMessage(order.telegramChatId, `💬 **Admin Update:**\n🎯 Target ID: \`${order.targetId}\`\n\n📢 *${text}*`, { parse_mode: 'Markdown' }).catch(()=>{});
                    }
                    bot.sendMessage(chatId, `✅ Reply sent successfully to customer!`);
                }
                return;
            }

            if (adminPendingSrReply[chatId]) {
                const srId = adminPendingSrReply[chatId];
                delete adminPendingSrReply[chatId];
                let srOrder = await SrModel.findById(srId);
                if (srOrder) {
                    srOrder.adminReplies.push(text);
                    await srOrder.save();
                    if (CUSTOMER_BOT_TOKENS[0]) {
                        const tempCustBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
                        await tempCustBot.sendMessage(srOrder.telegramChatId, `💬 **Admin SR Update (${srOrder.customerName}):**\n\n📢 *${text}*`, { parse_mode: 'Markdown' }).catch(()=>{});
                    }
                    bot.sendMessage(chatId, `✅ SR Reply sent successfully to Engineer!`);
                }
                return;
            }
        });

        bot.on('callback_query', async (query) => {
            const chatId = String(query.message.chat.id);
            if (chatId !== ADMIN_CHAT_ID) return;
            const data = query.data;
            const messageId = query.message.message_id;

            if (data === 'admin_customer_details') {
                adminPendingCustomerDetails = true;
                bot.answerCallbackQuery(query.id);
                bot.sendMessage(chatId, `🔍 **Customer / Order Details Finder**\n\nKripya **Telegram Chat ID**, **Target ID**, **Customer Mobile** ya **Customer Name** type karke bhejein:`);
                return;
            }

            if (data.startsWith('history_')) {
                bot.answerCallbackQuery(query.id);
                const [, type, id] = data.split('_');
                if (type === 'reach') {
                    let order = await OrderModel.findById(id);
                    if (order) {
                        let u = await UserModel.findOne({ telegramChatId: order.telegramChatId });
                        bot.sendMessage(chatId, `📋 **Reach Order History**\n\n👤 Engineer: *${u ? u.name : 'Unknown'}*\n💬 Chat ID: \`${order.telegramChatId}\`\n🎯 Target ID: \`${order.targetId}\`\n🔑 Password: \`${order.targetPass}\`\n📌 Status: *${order.status}*\n📢 Admin Reply: _${order.adminReply || 'None'}_\n🕒 Created: ${new Date(order.createdAt).toLocaleString()}`, { parse_mode: 'Markdown' });
                    }
                } else {
                    let srOrder = await SrModel.findById(id);
                    if (srOrder) {
                        let u = await UserModel.findOne({ telegramChatId: srOrder.telegramChatId });
                        bot.sendMessage(chatId, `📋 **SR Order History**\n\n👤 Engineer: *${u ? u.name : 'Unknown'}*\n💬 Chat ID: \`${srOrder.telegramChatId}\`\n👤 Customer: *${srOrder.customerName}*\n📞 Mobile: \`${srOrder.mobileNumber}\`\n☎️ Landline: \`${srOrder.landlineNumber || 'N/A'}\`\n📌 Status: *${srOrder.status}*\n📢 Admin Replies:\n${srOrder.adminReplies.length ? srOrder.adminReplies.map((r, i) => `${i+1}. ${r}`).join('\n') : 'None'}\n🕒 Created: ${new Date(srOrder.createdAt).toLocaleString()}`, { parse_mode: 'Markdown' });
                    }
                }
                return;
            }

            if (data === 'admin_edit_order') {
                adminPendingEditSearch = true;
                bot.answerCallbackQuery(query.id);
                bot.sendMessage(chatId, `🔍 **Order Edit Mode**\n\nKripya **Target ID** (Reach ke liye) ya **Mobile Number** (SR ke liye) type karke bhejein:`);
                return;
            }

            if (data.startsWith('editstatus_')) {
                bot.answerCallbackQuery(query.id);
                const [, type, id] = data.split('_');
                const statusKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "✅ Accepted", callback_data: `setst_${type}_${id}_Accepted` },
                                { text: "⏳ In Progress", callback_data: `setst_${type}_${id}_In Progress` }
                            ],
                            [
                                { text: "🎉 Completed", callback_data: `setst_${type}_${id}_Completed` },
                                { text: "❌ Rejected", callback_data: `setst_${type}_${id}_Rejected` }
                            ],
                            [
                                { text: "🚫 Cancel & Refund", callback_data: `setst_${type}_${id}_Cancelled & Refunded` }
                            ]
                        ]
                    }
                };
                bot.sendMessage(chatId, `🎯 **Naya status select karein:**`, statusKeyboard);
                return;
            }

            if (data.startsWith('editreply_')) {
                bot.answerCallbackQuery(query.id);
                const [, type, id] = data.split('_');
                if (type === 'reach') {
                    adminPendingReply[chatId] = id;
                    bot.sendMessage(chatId, `✍️ Send reply text for Reach Order:`);
                } else {
                    adminPendingSrReply[chatId] = id;
                    bot.sendMessage(chatId, `✍️ Send reply text for SR Order:`);
                }
                return;
            }

            if (data.startsWith('setst_')) {
                const [, type, id, status] = data.split('_');
                bot.answerCallbackQuery(query.id, { text: `Status updated to ${status}` });

                if (type === 'reach') {
                    let order = await OrderModel.findById(id);
                    if (order) {
                        order.status = status;
                        let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });
                        if ((status === 'Rejected' || status === 'Cancelled & Refunded') && user) {
                            user.jpwCoins += 1;
                            await user.save();
                        }
                        await order.save();
                        bot.sendMessage(chatId, `✅ **Reach Order Updated!**\n🎯 Target ID: \`${order.targetId}\`\n🔑 Password: \`${order.targetPass}\`\n📌 Status: *${order.status}*`, { parse_mode: 'Markdown' });
                    }
                } else {
                    let srOrder = await SrModel.findById(id);
                    if (srOrder) {
                        srOrder.status = status;
                        let user = await UserModel.findOne({ telegramChatId: srOrder.telegramChatId });
                        if ((status === 'Rejected' || status === 'Cancelled & Refunded') && user) {
                            user.jpwCoins += 1;
                            await user.save();
                        }
                        await srOrder.save();
                        bot.sendMessage(chatId, `✅ **SR Order Updated!**\n👤 Customer: *${srOrder.customerName}*\n📌 Status: *${srOrder.status}*`, { parse_mode: 'Markdown' });
                    }
                }
                return;
            }

            if (data === 'admin_broadcast') {
                adminPendingBroadcast = true;
                bot.answerCallbackQuery(query.id);
                bot.sendMessage(chatId, `✍️ **Type and send your announcement message:**\n(Whatever you send now will be delivered to all engineers instantly)`);
                return;
            } else if (data === 'admin_stats') {
                bot.answerCallbackQuery(query.id);
                let userCount = await UserModel.countDocuments();
                let reachCount = await OrderModel.countDocuments();
                let srCount = await SrModel.countDocuments();
                bot.sendMessage(chatId, `📊 **System Statistics:**\n\n👤 Total Engineers: *${userCount}*\n⚡ Reach Orders: *${reachCount}*\n📌 SR Orders: *${srCount}*`, { parse_mode: 'Markdown' });
            } else if (data === 'admin_reach_orders') {
                bot.answerCallbackQuery(query.id);
                let pending = await OrderModel.find({ status: 'Pending' }).limit(5);
                if(pending.length === 0) { bot.sendMessage(chatId, "✅ No pending Reach orders!"); return; }
                pending.forEach(o => {
                    bot.sendMessage(chatId, `⚡ **Reach Order**\n🎯 Target ID: \`${o.targetId}\`\n🔑 Password: \`${o.targetPass}\`\n💬 Chat ID: \`${o.telegramChatId}\``, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "✅ Accept", callback_data: `accept_${o._id}` }, { text: "❌ Reject", callback_data: `reject_${o._id}` }]
                            ]
                        }
                    });
                });
            } else if (data === 'admin_sr_orders') {
                bot.answerCallbackQuery(query.id);
                let pendingSr = await SrModel.find({ status: 'Pending' }).limit(5);
                if(pendingSr.length === 0) { bot.sendMessage(chatId, "✅ No pending SR orders!"); return; }
                pendingSr.forEach(s => {
                    bot.sendMessage(chatId, `📌 **SR Order**\n👤 Customer: ${s.customerName}\n📞 Mobile: \`${s.mobileNumber}\`\n☎️ Landline: \`${s.landlineNumber || 'N/A'}\`\n💬 Chat ID: \`${s.telegramChatId}\``, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "✅ Accept", callback_data: `sraccept_${s._id}` }, { text: "❌ Reject", callback_data: `srreject_${s._id}` }]
                            ]
                        }
                    });
                });
            } else if (data.startsWith('sr')) {
                const [action, srId] = data.split('_');
                let srOrder = await SrModel.findById(srId);
                if (!srOrder) { bot.answerCallbackQuery(query.id, { text: 'Not found!' }); return; }
                let user = await UserModel.findOne({ telegramChatId: srOrder.telegramChatId });

                if (action === 'srreply') {
                    adminPendingSrReply[chatId] = srId;
                    bot.answerCallbackQuery(query.id);
                    bot.sendMessage(chatId, `✍️ Send reply text for SR (${srOrder.customerName}):`);
                    return;
                } else if (action === 'sraccept') {
                    srOrder.status = 'Accepted';
                    await srOrder.save();
                    bot.answerCallbackQuery(query.id, { text: 'Accepted!' });
                    let inProgressKeyboard = {
                        inline_keyboard: [
                            [{ text: "⏳ In Progress", callback_data: `srinprog_${srOrder._id}` }, { text: "🎉 Complete", callback_data: `srcomp_${srOrder._id}` }],
                            [{ text: "💬 Reply", callback_data: `srreply_${srOrder._id}` }, { text: "❌ Reject & Refund", callback_data: `srreject_${srOrder._id}` }]
                        ]
                    };
                    bot.editMessageReplyMarkup(inProgressKeyboard, { chat_id: chatId, message_id: messageId }).catch(()=>{});
                    return;
                } else if (action === 'srreject') {
                    srOrder.status = 'Rejected';
                    if(user){ user.jpwCoins += 1; await user.save(); }
                    await srOrder.save();
                    bot.answerCallbackQuery(query.id, { text: 'Rejected & Refunded!' });
                    bot.editMessageText(`📌 **SR Order (Rejected & Refunded)**\n👤 Customer: *${srOrder.customerName}*\n📞 Mobile: \`${srOrder.mobileNumber}\`\n💬 Chat ID: \`${srOrder.telegramChatId}\`\n❌ Status: *Rejected*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }).catch(()=>{});
                    return;
                } else if (action === 'srinprog') {
                    srOrder.status = 'In Progress';
                    await srOrder.save();
                    bot.answerCallbackQuery(query.id, { text: 'Marked In Progress!' });
                    bot.sendMessage(chatId, `⏳ SR Status: *In Progress*`, { parse_mode: 'Markdown' });
                    return;
                } else if (action === 'srcomp') {
                    srOrder.status = 'Completed';
                    await srOrder.save();
                    bot.answerCallbackQuery(query.id, { text: 'Completed!' });
                    bot.editMessageText(`📌 **SR Order (Completed)**\n👤 Customer: *${srOrder.customerName}*\n📞 Mobile: \`${srOrder.mobileNumber}\`\n💬 Chat ID: \`${srOrder.telegramChatId}\`\n🎉 Status: *Completed*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }).catch(()=>{});
                    return;
                }
            } else if (data.includes('_') && !data.startsWith('admin') && !data.startsWith('edit') && !data.startsWith('setst') && !data.startsWith('history')) {
                const [action, orderId] = data.split('_');
                let order = await OrderModel.findById(orderId);
                if (!order) { bot.answerCallbackQuery(query.id, { text: 'Not found!' }); return; }
                let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });

                if (action === 'reply') {
                    adminPendingReply[chatId] = orderId;
                    bot.answerCallbackQuery(query.id);
                    bot.sendMessage(chatId, `✍️ Send reply text for Reach Order ID: \`${order.targetId}\``);
                    return;
                } else if (action === 'accept') {
                    order.status = 'Accepted';
                    await order.save();
                    bot.answerCallbackQuery(query.id, { text: 'Accepted!' });
                    let activeActionsKeyboard = {
                        inline_keyboard: [
                            [{ text: "⏳ In Progress", callback_data: `inprogress_${order._id}` }, { text: "🎉 Complete", callback_data: `complete_${order._id}` }],
                            [{ text: "💬 Reply", callback_data: `reply_${order._id}` }, { text: "🚫 Cancel & Refund", callback_data: `cancel_${order._id}` }]
                        ]
                    };
                    bot.editMessageReplyMarkup(activeActionsKeyboard, { chat_id: chatId, message_id: messageId }).catch(()=>{});
                    return;
                } else if (action === 'reject') {
                    order.status = 'Rejected';
                    if(user){ user.jpwCoins += 1; await user.save(); }
                    await order.save();
                    bot.answerCallbackQuery(query.id, { text: 'Rejected!' });
                    bot.editMessageText(`⚡ **Reach Order (Rejected & Refunded)**\n🎯 ID: \`${order.targetId}\`\n🔑 Pass: \`${order.targetPass}\`\n💬 Chat ID: \`${order.telegramChatId}\`\n❌ Status: *Rejected*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }).catch(()=>{});
                    return;
                } else if (action === 'inprogress') {
                    order.status = 'In Progress';
                    await order.save();
                    bot.answerCallbackQuery(query.id, { text: 'Marked In Progress!' });
                    bot.sendMessage(chatId, `⏳ Reach Order Status: *In Progress*`, { parse_mode: 'Markdown' });
                    return;
                } else if (action === 'complete') {
                    order.status = 'Completed';
                    await order.save();
                    bot.answerCallbackQuery(query.id, { text: 'Completed!' });
                    bot.editMessageText(`⚡ **Reach Order (Completed)**\n🎯 ID: \`${order.targetId}\`\n🔑 Pass: \`${order.targetPass}\`\n💬 Chat ID: \`${order.telegramChatId}\`\n🎉 Status: *Completed*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }).catch(()=>{});
                    return;
                } else if (action === 'cancel') {
                    order.status = 'Cancelled & Refunded';
                    if(user){ user.jpwCoins += 1; await user.save(); }
                    await order.save();
                    bot.answerCallbackQuery(query.id, { text: 'Cancelled & Refunded!' });
                    bot.editMessageText(`⚡ **Reach Order (Cancelled & Refunded)**\n🎯 ID: \`${order.targetId}\`\n🔑 Pass: \`${order.targetPass}\`\n💬 Chat ID: \`${order.telegramChatId}\`\n🚫 Status: *Cancelled & Refunded*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }).catch(()=>{});
                    return;
                }
            }
        });
    } catch(e) {}
}

// 🤖 Customer Bot Management
function startCustomerBot(token, isPrimary) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});

        let currentBotUsername = '';
        bot.getMe().then(info => {
            currentBotUsername = info.username;
            if (isPrimary) primaryCustomerBotUsername = currentBotUsername;
        }).catch(() => {});

        bot.on('message', async (msg) => {
            if (!msg || !msg.chat || !msg.text) return;
            const chatId = String(msg.chat.id);
            if (chatId === ADMIN_CHAT_ID) return;

            const text = msg.text.trim();
            const portalUrl = "https://cashtree.space";

            if (text.startsWith('/start') || text.toLowerCase() === 'menu') {
                let user = await UserModel.findOne({ telegramChatId: chatId });
                if (!user) {
                    user = await UserModel.create({ telegramChatId: chatId, name: msg.from.first_name || 'Engineer', jpwCoins: 0 });
                }

                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🚀 Open Mini App Portal", web_app: { url: portalUrl } }],
                            [{ text: "⚡ Regular Reach Service", callback_data: "bot_menu_reach" }, { text: "📌 SR Service", callback_data: "bot_menu_sr" }],
                            [{ text: "🪙 Check Balance", callback_data: "bot_menu_balance" }, { text: "🎁 Daily Bonus", callback_data: "bot_menu_bonus" }],
                            [{ text: "📦 Buy Coins Packages", callback_data: "bot_menu_packages" }, { text: "🤝 Share Coins", callback_data: "bot_menu_transfer" }],
                            [{ text: "🔥 Refer & Earn", callback_data: "bot_menu_referral" }, { text: "📜 Terms & Policies", callback_data: "bot_menu_terms" }],
                            [{ text: "📞 Support / Contact", callback_data: "bot_menu_contact" }]
                        ]
                    }
                };

                await bot.sendMessage(chatId, `✨ **Welcome to JPW Engineer Portal Bot!** 🚀\n\n👤 Engineer: *${user.name}*\n🆔 Chat ID: \`${chatId}\`\n🪙 Coins Balance: *${user.jpwCoins.toFixed(2)} Coins*\n\n👇 *Choose an option:*`, { parse_mode: 'Markdown', ...keyboard });
                return;
            }
        });

        bot.on('callback_query', async (query) => {
            const chatId = String(query.message.chat.id);
            if (chatId === ADMIN_CHAT_ID) return;
            const data = query.data;
            const portalUrl = "https://cashtree.space";
            let user = await UserModel.findOne({ telegramChatId: chatId });

            if (data === 'bot_menu_reach' || data === 'bot_menu_sr' || data === 'bot_menu_packages') {
                bot.answerCallbackQuery(query.id);
                bot.sendMessage(chatId, `🚀 Open our Mini App Portal to proceed:\n\n[Open Portal](${portalUrl})`, { parse_mode: 'Markdown' });
            } else if (data === 'bot_menu_balance') {
                bot.answerCallbackQuery(query.id);
                bot.sendMessage(chatId, `🪙 Your current balance: *${user ? user.jpwCoins.toFixed(2) : 0} Coins*`, { parse_mode: 'Markdown' });
            } else if (data === 'bot_menu_bonus') {
                bot.answerCallbackQuery(query.id);
                bot.sendMessage(chatId, `🎁 Open the Mini App dashboard and click the **Daily Bonus** button to claim!`, { parse_mode: 'Markdown' });
            } else if (data === 'bot_menu_transfer') {
                bot.answerCallbackQuery(query.id);
                bot.sendMessage(chatId, `🤝 Use the **Share Coins** feature inside the Mini App dashboard.`, { parse_mode: 'Markdown' });
            } else if (data === 'bot_menu_referral') {
                bot.answerCallbackQuery(query.id);
                const refLink = `https://t.me/${currentBotUsername || 'JPWREACHSERVICESBOT'}?start=ref_${chatId}`;
                bot.sendMessage(chatId, `🔥 **Your Refer & Earn Link:**\n\`${refLink}\``, { parse_mode: 'Markdown' });
            } else if (data === 'bot_menu_terms') {
                bot.answerCallbackQuery(query.id);
                bot.sendMessage(chatId, `📜 Visit [cashtree.space](https://cashtree.space) for all terms and policies.`, { parse_mode: 'Markdown' });
            } else if (data === 'bot_menu_contact') {
                bot.answerCallbackQuery(query.id);
                bot.sendMessage(chatId, `📞 Contact admin directly via portal or support group.`, { parse_mode: 'Markdown' });
            }
        });
    } catch(e) {}
}

// --- API ENDPOINTS ---

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mobile_app.html'));
});

app.post('/api/register', async (req, res) => {
    try {
        const { customId, password, name } = req.body;
        if (await UserModel.findOne({ customId })) {
            return res.json({ success: false, message: 'ID already exists!' });
        }
        const user = await UserModel.create({
            customId,
            password,
            name: name || 'Engineer',
            telegramChatId: `WEB_${customId}`,
            jpwCoins: 0
        });
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { customId, password } = req.body;
        const user = await UserModel.findOne({ customId, password });
        if (user) {
            res.json({ success: true, user });
        } else {
            res.json({ success: false, message: 'Invalid ID or Password' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/app/check-status', async (req, res) => {
    try {
        const { telegramChatId } = req.body;
        const regularOrders = await OrderModel.find({ telegramChatId }).sort({ createdAt: -1 });
        const srOrders = await SrModel.find({ telegramChatId }).sort({ createdAt: -1 });
        res.json({ success: true, regularOrders, srOrders });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_SECRET_PASS) {
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Incorrect password' });
    }
});

app.get('/api/admin/data', async (req, res) => {
    try {
        const orders = await OrderModel.find().sort({ createdAt: -1 });
        const srOrders = await SrModel.find().sort({ createdAt: -1 });
        const users = await UserModel.find();
        res.json({ success: true, orders, srOrders, users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/sr-action', async (req, res) => {
    try {
        const { srId, action, replyText } = req.body;
        let srOrder = await SrModel.findById(srId);
        if (!srOrder) return res.json({ success: false, message: 'Order not found' });

        let user = await UserModel.findOne({ telegramChatId: srOrder.telegramChatId });

        if (action === 'accept') { srOrder.status = 'Accepted'; }
        else if (action === 'reject') { srOrder.status = 'Rejected'; if(user){user.jpwCoins+=1;await user.save();} }
        else if (action === 'inprogress') { srOrder.status = 'In Progress'; }
        else if (action === 'complete') { srOrder.status = 'Completed'; }
        else if (action === 'reply' && replyText) {
            srOrder.adminReplies.push(replyText);
        }

        await srOrder.save();

        if (CUSTOMER_BOT_TOKENS[0]) {
            const tempCustBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
            await tempCustBot.sendMessage(srOrder.telegramChatId, `📌 **SR Order Update**\n👤 Customer: ${srOrder.customerName}\n📌 Status: *${srOrder.status}*${replyText ? `\n💬 Reply: ${replyText}` : ''}`, { parse_mode: 'Markdown' }).catch(()=>{});
        }

        res.json({ success: true, message: 'SR updated successfully' });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/update-reaches', async (req, res) => {
    try {
        const { userId, action, count } = req.body;
        let user = await UserModel.findById(userId);
        if (!user) return res.json({ success: false, message: 'User not found' });

        if (action === 'add') user.jpwCoins += parseFloat(count);
        else if (action === 'deduct') user.jpwCoins = Math.max(0, user.jpwCoins - parseFloat(count));

        await user.save();
        res.json({ success: true, user });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/clear-database', async (req, res) => {
    try {
        const { pin } = req.body;
        if (pin !== ADMIN_SECRET_PASS) return res.json({ success: false, message: 'Incorrect PIN!' });

        await OrderModel.deleteMany({});
        await SrModel.deleteMany({});
        await UsedUtrModel.deleteMany({});
        res.json({ success: true, message: 'Database cleared successfully!' });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/sr-submit', async (req, res) => {
    try {
        const { telegramChatId, customerName, mobileNumber, landlineNumber } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (!user || user.jpwCoins < 1) {
            return res.json({ success: false, message: 'Insufficient JPW Coins! 1 Coin required.' });
        }

        user.jpwCoins -= 1;
        await user.save();

        const newSr = await SrModel.create({ telegramChatId: String(telegramChatId), customerName, mobileNumber, landlineNumber });
        await notifyAdminSrBot(newSr);

        res.json({ success: true, message: 'SR order successfully submitted!', remainingCoins: user.jpwCoins });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// AUTO FORWARD TO TARGET BOT VIA USERBOT + AUTO-POLLING + TIME BOUND (7:00 AM - 10:00 PM)
app.post('/api/order', async (req, res) => {
    try {
        // 1. Working Hours Check (7:00 AM - 10:00 PM IST)
        if (!isServiceOpen()) {
            return res.json({
                success: false,
                message: '⛔ हमारी सेवा का समय सुबह 7:00 AM से रात 10:00 PM तक है। कृपया निर्धारित समय के भीतर प्रयास करें।'
            });
        }

        const { telegramChatId, targetId, targetPass } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });

        if (!user || user.jpwCoins < 1) {
            return res.json({ success: false, message: 'Insufficient JPW Coins! 1 Coin required.' });
        }

        user.jpwCoins -= 1;
        await user.save();

        const newOrder = await OrderModel.create({ telegramChatId: String(telegramChatId), targetId, targetPass });

        // Notify Admin
        await notifyAdminAndUser(newOrder, user, `🌐 **New Reach Order (Pending)**\n💬 Chat ID: \`${telegramChatId}\`\n🎯 ID: \`${targetId}\`\n🔑 Pass: \`${targetPass}\``);

        // Forward to Target Bot
        const sent = await forwardOrderToTargetBot(targetId, targetPass);

        if (!sent) {
            // If failed to send immediately, refund 1 coin safely
            user.jpwCoins += 1;
            await user.save();
            newOrder.status = 'Rejected';
            newOrder.adminReply = 'Target bot unreachable. Coin refunded.';
            await newOrder.save();
            return res.json({ success: false, message: '⚠️ बॉट से संपर्क नहीं हो सका। आपका 1 कॉइन वापस कर दिया गया है।' });
        }

        res.json({ success: true, message: 'Reach order successfully submitted!', remainingCoins: user.jpwCoins });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/send-otp', async (req, res) => {
    try {
        let { telegramChatId } = req.body;
        telegramChatId = String(telegramChatId).trim();
        let user = await UserModel.findOne({ telegramChatId });
        if (!user) return res.json({ success: false, message: 'User not registered!' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStorage[telegramChatId] = { otp, expires: Date.now() + 5 * 60 * 1000 };

        if (CUSTOMER_BOT_TOKENS[0]) {
            const tempBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
            await tempBot.sendMessage(telegramChatId, `🔐 **Portal Login OTP:** \`${otp}\``, { parse_mode: 'Markdown' });
        }
        res.json({ success: true, message: 'OTP sent!' });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/verify-otp', async (req, res) => {
    try {
        let { telegramChatId, otp } = req.body;
        telegramChatId = String(telegramChatId).trim();
        const record = otpStorage[telegramChatId];
        if (!record || record.expires < Date.now() || record.otp !== String(otp).trim()) {
            return res.json({ success: false, message: 'Invalid or expired OTP!' });
        }
        delete otpStorage[telegramChatId];
        let user = await UserModel.findOne({ telegramChatId });
        res.json({ success: true, user });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/mini-app/auth', async (req, res) => {
    try {
        let { telegramChatId, name } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (!user) {
            user = await UserModel.create({ telegramChatId: String(telegramChatId), name: name || 'Engineer', jpwCoins: 0 });
        }
        res.json({ success: true, user });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/packages', (req, res) => { res.json({ success: true, packages: RECHARGE_PACKAGES }); });

app.post('/api/pay', async (req, res) => {
    try {
        const { telegramChatId, amount, coins } = req.body;
        let orderId = `JPW_${Date.now()}_${telegramChatId}`;

        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (user) {
            user.activePackage = `₹${amount} (${coins} JPW Coins)`;
            await user.save();
        }

        const postData = JSON.stringify({
            order_id: orderId,
            order_amount: parseFloat(amount),
            order_currency: "INR",
            customer_details: { customer_id: String(telegramChatId), customer_phone: "9999999999", customer_email: "test@jpw.com" },
            order_meta: { return_url: `https://cashtree.space/?payment=success&telegramChatId=${telegramChatId}&coins=${coins}&order_id=${orderId}` }
        });

        const options = {
            hostname: 'api.cashfree.com',
            path: '/pg/orders',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-client-id': CASHFREE_CLIENT_ID,
                'x-client-secret': CASHFREE_CLIENT_SECRET,
                'x-api-version': '2022-09-01'
            }
        };

        const reqCashfree = https.request(options, (response) => {
            let body = '';
            response.on('data', chunk => body += chunk);
            response.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (response.statusCode === 200 && json.payment_session_id) {
                        res.json({ success: true, paymentSessionId: json.payment_session_id, orderId });
                    } else {
                        res.json({ success: false, message: json.message || 'Error' });
                    }
                } catch(e) { res.status(500).json({ success: false, message: 'JSON Error' }); }
            });
        });
        reqCashfree.on('error', (err) => { res.status(500).json({ success: false, message: err.message }); });
        reqCashfree.write(postData);
        reqCashfree.end();
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/verify-instant', async (req, res) => {
    try {
        const { telegramChatId, coins, order_id } = req.body;
        const transactionId = order_id || `INSTANT_${Date.now()}_${telegramChatId}`;
        const existingUtr = await UsedUtrModel.findOne({ utrId: transactionId });
        if (existingUtr) return res.json({ success: false, message: 'Already credited' });

        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (user) {
            await UsedUtrModel.create({ utrId: transactionId });
            user.jpwCoins += parseFloat(coins);
            await user.save();
            res.json({ success: true, user });
        } else { res.json({ success: false, message: 'User not found' }); }
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/claim-daily-bonus', async (req, res) => {
    try {
        const { telegramChatId } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (!user) return res.json({ success: false, message: 'User not found!' });

        const now = new Date();
        if (user.lastBonusTime) {
            const lastBonus = new Date(user.lastBonusTime);
            if (now.toDateString() === lastBonus.toDateString()) {
                return res.json({ success: false, message: 'You have already claimed your daily bonus today!' });
            }
        }

        const randomBonus = parseFloat((Math.random() * 0.5 + 0.1).toFixed(2));
        user.jpwCoins += randomBonus;
        user.lastBonusTime = now;
        await user.save();

        res.json({ success: true, randomBonus, user });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/transfer-coins', async (req, res) => {
    try {
        const { senderChatId, receiverChatId, amount } = req.body;
        const transferAmt = parseFloat(amount);
        if (isNaN(transferAmt) || transferAmt <= 0) return res.json({ success: false, message: 'Invalid amount!' });

        let sender = await UserModel.findOne({ telegramChatId: String(senderChatId) });
        let receiver = await UserModel.findOne({ telegramChatId: String(receiverChatId) });

        if (!sender || sender.jpwCoins < transferAmt) {
            return res.json({ success: false, message: 'Insufficient coins for transfer!' });
        }
        if (!receiver) {
            return res.json({ success: false, message: 'Receiver Chat ID not registered on portal!' });
        }
        if (senderChatId === receiverChatId) {
            return res.json({ success: false, message: 'Cannot transfer to yourself!' });
        }

        sender.jpwCoins -= transferAmt;
        receiver.jpwCoins += transferAmt;

        await sender.save();
        await receiver.save();

        res.json({ success: true, sender });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const SELF_URL = `https://cashtree.space`;
setInterval(() => { https.get(SELF_URL, (res) => {}).on('error', (err) => {}); }, 10 * 60 * 1000);

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, '0.0.0.0', () => {
    debugLog('Server', `🚀 Engineer Portal live on port ${PORT}`);
});
