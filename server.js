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

const TARGET_THIRD_PARTY_BOT = process.env.TARGET_BOT_USERNAME || '@JPWREACHEDBOT';

let userbotClient = null;
const activeCheckIntervals = {};

// 🔑 Cashfree Production Credentials
const CASHFREE_CLIENT_ID = '132151420cc80e33a29ab5a896e4151231';
const CASHFREE_CLIENT_SECRET = 'cfsk_ma_prod_07c2ec902f0ab79b31d72c924423b03a_edc81cf8';

// 🤖 Customer Bot Tokens (Retail)
const CUSTOMER_BOT_TOKENS = [
    '8874503246:AAEmdPcVJMQ3q6pmINsP_Tcwium3ANV4T6I',
    '8972064227:AAG3LadKR0mLXJgU3xL6BwMy7TxjYz8N3Rw'
];

// 🤖 Reseller Bot Token
const RESELLER_BOT_TOKEN = '8437403049:AAGpJJ4dZZ5it5duK-hcvJE5Xu8rxu8J2XY';

// 👑 Admin Bot Token
const ADMIN_BOT_TOKEN = '8736759061:AAGaSKOCQ9gUylCsqdAufHenEPeDQhQtSDU';

const RECHARGE_PACKAGES = [
    { amount: 13, coins: 1 },
    { amount: 60, coins: 5 },
    { amount: 115, coins: 10 },
    { amount: 210, coins: 20 },
    { amount: 400, coins: 40 }
];

let otpStorage = {};
let resellerOrderSessions = {}; 

function isServiceOpen() {
    const now = new Date();
    const istHours = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();
    return istHours >= 7 && istHours < 22;
}

function sanitizeCustomerMessage(rawText) {
    if (!rawText) return '';
    const getCurrentTime = () => {
        return new Date().toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
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
                    !lower.includes('wallet balance:') &&
                    !lower.includes('work order:') &&
                    !lower.includes('remaining') &&
                    !lower.includes('plan');
        })
        .join('\n');

    sanitized = sanitized.replace(/\d{1,2}:\d{2}\s?(am|pm|AM|PM)/gi, getCurrentTime());
    sanitized = sanitized.replace(/(completed in \d+s|\d+\s*min[s]? ago|\d+\s*minute[s]? ago)/gi, `Completed just now (${getCurrentTime()})`);

    return sanitized.replace(/\n{3,}/g, '\n\n').trim();
}

function startAutoRecheck(orderId, targetId, targetPass) {
    if (activeCheckIntervals[orderId]) return;
    let attempts = 0;
    const maxAttempts = 6;
    const lockedTargetId = String(targetId).trim();
    const lockedTargetPass = String(targetPass).trim();

    activeCheckIntervals[orderId] = setInterval(async () => {
        attempts++;
        try {
            const currentOrder = await OrderModel.findById(orderId);
            if (!currentOrder || ['Completed', 'Rejected', 'Cancelled & Refunded'].includes(currentOrder.status)) {
                stopAutoRecheck(orderId);
                return;
            }
            await forwardOrderToTargetBot(lockedTargetId, lockedTargetPass);
        } catch (e) {}
    }, 2 * 60 * 1000);
}

function stopAutoRecheck(orderId) {
    if (activeCheckIntervals[orderId]) {
        clearInterval(activeCheckIntervals[orderId]);
        delete activeCheckIntervals[orderId];
    }
}

// --- SMART TIMED GREETINGS SYSTEM ---
function startSmartGreetingsTimer() {
    setInterval(async () => {
        try {
            const users = await UserModel.find({ telegramChatId: { $not: /^WEB_/ } });
            if (users.length === 0 || !CUSTOMER_BOT_TOKENS[0]) return;

            const tempBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
            const istHour = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();

            let greetingOptions = [];
            if (istHour >= 6 && istHour < 11) {
                greetingOptions = [
                    "🌅 **Good Morning, Engineer!**\n\nHope you had a great sleep. Don't forget to grab your breakfast and coffee before starting today's tech tasks! Have a productive day ahead. ☕🚀",
                    "☀️ **Good Morning!**\n\nSubah ka waqt fresh energy ka hota hai. Naashta (Breakfast) kar lijiye aur taiyar ho jaiye aaj ke naye orders ke liye. Have a wonderful day! 🥐"
                ];
            } else if (istHour >= 11 && istHour < 16) {
                greetingOptions = [
                    "☀️ **Good Afternoon, Engineer!**\n\nDoophoor ka waqt ho gaya hai. Thoda break lijiye, lunch kar lijiye, aur hydrate rahiye! 🥗🍽️",
                    "🍽️ **Lunch Time Reminder!**\n\nKaam ke beech mein lunch karna mat bhooliyega. Pet pooja zaroori hai! Bon appétit! 🍛"
                ];
            } else if (istHour >= 16 && istHour < 20) {
                greetingOptions = [
                    "🌆 **Good Evening, Engineer!**\n\nShaam ki chai ka waqt ho chuka hai. Ek cup chai pijiye aur relax hokar baaki ke tasks pure kijiye! ☕",
                    "🌇 **Evening Vibes!**\n\nDin ka kafi kaam ho chuka hai. Thoda break lijiye aur sham के orders ko smoothly complete karein. 🍪"
                ];
            } else {
                greetingOptions = [
                    "🌙 **Good Night, Engineer!**\n\nRaat ho chuki hai, kafi mehnat kar li aapne aaj. Din bhar ke kaam के baad ab aaram kijiye! 🌌",
                    "🌙 **Late Night Check!**\n\nService hours close hone wale hain. Apni health ka dhyan rakhein aur achhi neend lein. Good night! 😴"
                ];
            }

            const randomMsg = greetingOptions[Math.floor(Math.random() * greetingOptions.length)];
            for (let u of users) {
                try { await tempBot.sendMessage(u.telegramChatId, randomMsg, { parse_mode: 'Markdown' }); } catch (err) {}
            }
        } catch (e) {}
    }, 40 * 60 * 1000);
}

// --- USERBOT BRIDGE ---
async function initUserbotBridge() {
    if (!TELEGRAM_SESSION_STRING) return;
    try {
        const session = new StringSession(TELEGRAM_SESSION_STRING);
        userbotClient = new TelegramClient(session, TELEGRAM_API_ID, TELEGRAM_API_HASH, { connectionRetries: 5 });
        await userbotClient.connect();

        const handleBotMessage = async (message) => {
            if (!message || message.out) return;
            const rawText = message.message || '';
            const text = rawText.toLowerCase();
            const pendingOrders = await OrderModel.find({ status: { $in: ['Pending', 'Accepted', 'In Progress'] } });

            for (let order of pendingOrders) {
                if (rawText.includes(order.targetPass) || rawText.includes("New Reach Order")) break;

                if (rawText.includes(order.targetId) || pendingOrders.length === 1) {
                    const cleanedText = sanitizeCustomerMessage(rawText);
                    order.adminReply = cleanedText;
                    let customerBot = CUSTOMER_BOT_TOKENS[0] ? new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false }) : null;
                    let adminBot = ADMIN_BOT_TOKEN ? new TelegramBot(ADMIN_BOT_TOKEN, { polling: false }) : null;
                    let resellerBot = RESELLER_BOT_TOKEN ? new TelegramBot(RESELLER_BOT_TOKEN, { polling: false }) : null;

                    if (text.includes('processing reach') || text.includes('working on reach') || text.includes('status: success') || (text.includes('reached successfully') && !text.includes('completed in'))) {
                        stopAutoRecheck(order._id);
                        order.status = 'Completed';
                        await order.save();
                        const successReplyFormat = `✅ REACHED SUCCESSFULLY\n\n👤 Tech ID: ${order.targetId}\n📊 Status: SUCCESS`;
                        if (customerBot) await customerBot.sendMessage(order.telegramChatId, successReplyFormat, { parse_mode: 'Markdown' }).catch(()=>{});
                        if (resellerBot) await resellerBot.sendMessage(order.telegramChatId, successReplyFormat, { parse_mode: 'Markdown' }).catch(()=>{});
                        if (adminBot) await adminBot.sendMessage(ADMIN_CHAT_ID, `🎉 **Order Complete:** \`${order.targetId}\`\n\n${rawText}`, { parse_mode: 'Markdown' }).catch(()=>{});
                    }
                    else if (text.includes('security check') || text.includes('locked') || text.includes('alert ls') || text.includes('account is locked') || text.includes('login failed') || text.includes('invalid credentials') || text.includes('reject') || text.includes('fail') || text.includes('error') || text.includes('status: fail')) {
                        stopAutoRecheck(order._id);
                        order.status = 'Rejected';
                        await order.save();
                        await UserModel.findOneAndUpdate({ telegramChatId: order.telegramChatId }, { $inc: { jpwCoins: 1 } });
                        if (customerBot) await customerBot.sendMessage(order.telegramChatId, `❌ **Order Cancelled / Security Check Failed / Account Locked!**\n\n${cleanedText}\n\n🪙 *1 JPW Coin has been refunded to your wallet!*`, { parse_mode: 'Markdown' }).catch(()=>{});
                        if (resellerBot) await resellerBot.sendMessage(order.telegramChatId, `❌ **Order Cancelled / Security Check Failed / Account Locked!**\n\n${cleanedText}\n\n🪙 *1 JPW Coin has been refunded to your wallet!*`, { parse_mode: 'Markdown' }).catch(()=>{});
                        if (adminBot) await adminBot.sendMessage(ADMIN_CHAT_ID, `❌ **Order Cancelled/Locked & Coin Refunded:** \`${order.targetId}\`\n\n${rawText}`, { parse_mode: 'Markdown' }).catch(()=>{});
                    }
                    else if (text.includes('completed in') || text.includes('queued') || text.includes('queue:') || text.includes('starting reach') || text.includes('still reaching')) {
                        order.status = 'In Progress';
                        await order.save();
                        if (text.includes('completed in')) startAutoRecheck(order._id, order.targetId, order.targetPass);
                        if (customerBot) await customerBot.sendMessage(order.telegramChatId, `⏳ **Order Progress:**\n\n${cleanedText}`, { parse_mode: 'Markdown' }).catch(()=>{});
                        if (resellerBot) await resellerBot.sendMessage(order.telegramChatId, `⏳ **Order Progress:**\n\n${cleanedText}`, { parse_mode: 'Markdown' }).catch(()=>{});
                    }
                    break;
                }
            }
        };

        userbotClient.addEventHandler(async (event) => { await handleBotMessage(event.message); }, new NewMessage({ incoming: true }));
        userbotClient.addEventHandler(async (event) => { await handleBotMessage(event.message); }, new (require("telegram/events").EditedMessage)({ incoming: true }));
    } catch(err) {}
}

async function forwardOrderToTargetBot(targetId, targetPass) {
    if (!userbotClient) return false;
    try {
        const payload = `${targetId} ${targetPass}`;
        await userbotClient.sendMessage(TARGET_THIRD_PARTY_BOT, { message: payload });
        return true;
    } catch(e) { return false; }
}

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
    .then(async () => {
        initAllBots();
        initUserbotBridge();
        startOrderCleanupTimer();
        startSmartGreetingsTimer();
    })
    .catch(err => {});

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
    isPriority: { type: Boolean, default: false },
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
    CUSTOMER_BOT_TOKENS.forEach((token, idx) => { if (token) startCustomerBot(token, idx === 0); });
    if (RESELLER_BOT_TOKEN) startResellerBot(RESELLER_BOT_TOKEN);
    if (ADMIN_BOT_TOKEN) startAdminBot(ADMIN_BOT_TOKEN);
}

// 🤖 Full Feature Reseller Bot with Custom Name Welcome & Dynamic Buttons
function startResellerBot(token) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});

        bot.on('message', async (msg) => {
            if (!msg || !msg.chat || !msg.text) return;
            const chatId = String(msg.chat.id);
            const text = msg.text.trim();
            const resellerName = msg.from.first_name || 'Reseller Partner';

            let user = await UserModel.findOne({ telegramChatId: chatId });
            if (!user) {
                user = await UserModel.create({ telegramChatId: chatId, name: resellerName, jpwCoins: 0 });
            }

            if (resellerOrderSessions[chatId] && resellerOrderSessions[chatId].step === 'waiting_target_pass') {
                const targetPass = text;
                const targetId = resellerOrderSessions[chatId].targetId;
                delete resellerOrderSessions[chatId];

                if (!isServiceOpen()) {
                    await bot.sendMessage(chatId, '⛔ हमारी सेवा का समय सुबह 7:00 AM से रात 10:00 PM तक है।');
                    return;
                }

                if (user.jpwCoins < 1) {
                    await bot.sendMessage(chatId, '❌ Insufficient JPW Coins! Balance is low.');
                    return;
                }

                user.jpwCoins -= 1;
                await user.save();

                const newOrder = await OrderModel.create({ telegramChatId: chatId, targetId, targetPass, isPriority: true });
                const sent = await forwardOrderToTargetBot(targetId, targetPass);

                if (!sent) {
                    user.jpwCoins += 1;
                    await user.save();
                    newOrder.status = 'Rejected';
                    await newOrder.save();
                    await bot.sendMessage(chatId, '⚠️ Bot unreachable. Coin refunded.');
                    return;
                }

                await bot.sendMessage(chatId, `✅ **Priority Reach Order Executed Successfully!**\n🎯 Target ID: \`${targetId}\`\n🪙 Remaining Coins: *${user.jpwCoins.toFixed(2)}*`, { parse_mode: 'Markdown' });
                return;
            }

            if (text.startsWith('/start') || text.toLowerCase() === 'menu') {
                const welcomeMsg = `✨ **Welcome back, ${resellerName}!** 🚀\n\n🆔 Chat ID: \`${chatId}\`\n🪙 Coins Balance: *${user.jpwCoins.toFixed(2)} Coins*\n\n👇 *Select an option below:*`;
                
                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "⚡ Submit Reach Order", callback_data: "bot_reseller_reach" }],
                            [{ text: "🪙 Check Balance", callback_data: "bot_reseller_balance" }, { text: "📦 Buy Packages", callback_data: "bot_reseller_packages" }],
                            [{ text: "📊 Live Order Tracker", callback_data: "bot_reseller_status" }],
                            [{ text: "🚀 Open Web Hub Portal", web_app: { url: "https://cashtree.space/reseller" } }],
                            [{ text: "💬 WhatsApp Support", url: "https://wa.me/919382856020" }]
                        ]
                    }
                };

                await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown', ...keyboard });
                return;
            }

            const parts = text.split(/\s+/);
            if (parts.length === 2 && !text.startsWith('/')) {
                const targetId = parts[0].trim();
                const targetPass = parts[1].trim();

                if (user.jpwCoins < 1) {
                    await bot.sendMessage(chatId, '❌ Insufficient JPW Coins!');
                    return;
                }

                user.jpwCoins -= 1;
                await user.save();

                const newOrder = await OrderModel.create({ telegramChatId: chatId, targetId, targetPass, isPriority: true });
                await forwardOrderToTargetBot(targetId, targetPass);
                await bot.sendMessage(chatId, `✅ Order submitted via Direct Chat!\n🎯 ID: \`${targetId}\`\n🪙 Coins left: *${user.jpwCoins.toFixed(2)}*`, { parse_mode: 'Markdown' });
            }
        });

        bot.on('callback_query', async (query) => {
            const chatId = String(query.message.chat.id);
            const data = query.data;
            let user = await UserModel.findOne({ telegramChatId: chatId });

            if (data === 'bot_reseller_reach') {
                bot.answerCallbackQuery(query.id);
                resellerOrderSessions[chatId] = { step: 'waiting_target_pass' };
                bot.sendMessage(chatId, `⚡ **Send Target ID & Password** in format: \`TargetID Password\` (e.g. \`12345678 mypass\`)`, { parse_mode: 'Markdown' });
            } else if (data === 'bot_reseller_balance') {
                bot.answerCallbackQuery(query.id);
                bot.sendMessage(chatId, `🪙 Your wholesale balance: *${user ? user.jpwCoins.toFixed(2) : 0} Coins*`, { parse_mode: 'Markdown' });
            } else if (data === 'bot_reseller_packages') {
                bot.answerCallbackQuery(query.id);
                bot.sendMessage(chatId, `📦 **Wholesale Packages:**\n\n• 10 Coins - ₹95\n• 50 Coins - ₹425\n• 150 Coins (VIP) - ₹1050\n\n👉 Pay via UPI: \`Paytm.s2ujlw0@pty\` and send screenshot to WhatsApp: https://wa.me/919382856020`, { parse_mode: 'Markdown' });
            } else if (data === 'bot_reseller_status') {
                bot.answerCallbackQuery(query.id);
                const orders = await OrderModel.find({ telegramChatId: chatId }).sort({ createdAt: -1 }).limit(5);
                let text = `📊 **Recent Orders Status:**\n\n`;
                if(orders.length === 0) text += `No orders found.`;
                orders.forEach(o => {
                    text += `• \`${o.targetId}\` ➔ *${o.status}*\n`;
                });
                bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            }
        });
    } catch(e) {}
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

function startAdminBot(token) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});
    } catch(e) {}
}

function startCustomerBot(token, isPrimary) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});
    } catch(e) {}
}

// --- API ENDPOINTS ---
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.get('/app', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'mobile_app.html')); });
app.get('/reseller', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'reseller.html')); });

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_SECRET_PASS) res.json({ success: true });
    else res.json({ success: false, message: 'Incorrect password' });
});

app.get('/api/admin/data', async (req, res) => {
    try {
        const orders = await OrderModel.find().sort({ createdAt: -1 });
        const srOrders = await SrModel.find().sort({ createdAt: -1 });
        const users = await UserModel.find();
        res.json({ success: true, orders, srOrders, users });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
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
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/delete-user', async (req, res) => {
    try {
        const { userId } = req.body;
        await UserModel.findByIdAndDelete(userId);
        res.json({ success: true, message: 'User deleted successfully!' });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/broadcast', async (req, res) => {
    try {
        const { message } = req.body;
        const users = await UserModel.find();
        if (CUSTOMER_BOT_TOKENS[0]) {
            const tempBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
            for (let u of users) {
                try { await tempBot.sendMessage(u.telegramChatId, `📢 **Announcement:**\n\n${message}`, { parse_mode: 'Markdown' }); } catch(e) {}
            }
        }
        res.json({ success: true, message: 'Broadcast completed' });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/clear-database', async (req, res) => {
    try {
        const { pin } = req.body;
        if (pin !== ADMIN_SECRET_PASS) return res.json({ success: false, message: 'Incorrect PIN!' });
        await OrderModel.deleteMany({});
        await SrModel.deleteMany({});
        await UsedUtrModel.deleteMany({});
        res.json({ success: true, message: 'Database cleared successfully!' });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/auth/check-user-type', async (req, res) => {
    try {
        const { identifier } = req.body;
        const user = await UserModel.findOne({ $or: [{ customId: identifier }, { telegramChatId: identifier }] });
        if(user) res.json({ success: true, telegramChatId: user.telegramChatId });
        else res.json({ success: false, message: 'User not found!' });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/verify-otp', async (req, res) => {
    try {
        let { telegramChatId } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId).trim() });
        if (user) res.json({ success: true, user });
        else res.json({ success: false, message: 'User not found!' });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/mini-app/auth', async (req, res) => {
    try {
        let { telegramChatId, name } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (!user) user = await UserModel.create({ telegramChatId: String(telegramChatId), name: name || 'Reseller', jpwCoins: 0 });
        res.json({ success: true, user });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/reseller/orders-status', async (req, res) => {
    try {
        const { telegramChatId } = req.body;
        const orders = await OrderModel.find({ telegramChatId }).sort({ createdAt: -1 });
        const completed = orders.filter(o => o.status === 'Completed');
        const inProgress = orders.filter(o => ['Pending', 'Accepted', 'In Progress'].includes(o.status));
        const failed = orders.filter(o => ['Rejected', 'Cancelled & Refunded'].includes(o.status));
        res.json({ success: true, completed, inProgress, failed, all: orders });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/order', async (req, res) => {
    try {
        if (!isServiceOpen()) return res.json({ success: false, message: '⛔ हमारी सेवा का समय सुबह 7:00 AM से रात 10:00 PM तक है।' });
        const { telegramChatId, targetId, targetPass, isPriority } = req.body;
        if (!telegramChatId || !targetId || !targetPass) return res.json({ success: false, message: '⚠️ All fields required!' });

        const trimmedTargetId = String(targetId).trim();
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (!user || user.jpwCoins < 1) return res.json({ success: false, message: 'Insufficient JPW Coins!' });

        user.jpwCoins -= 1;
        await user.save();

        const newOrder = await OrderModel.create({ telegramChatId: String(telegramChatId), targetId: trimmedTargetId, targetPass: targetPass.trim(), isPriority: !!isPriority });
        const sent = await forwardOrderToTargetBot(trimmedTargetId, targetPass);
        if (!sent) {
            user.jpwCoins += 1;
            await user.save();
            newOrder.status = 'Rejected';
            await newOrder.save();
            return res.json({ success: false, message: '⚠️ Bot unreachable. Coin refunded.' });
        }
        res.json({ success: true, message: 'Order submitted successfully!', remainingCoins: user.jpwCoins });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

const SELF_URL = `https://cashtree.space`;
setInterval(() => { https.get(SELF_URL, (res) => {}).on('error', (err) => {}); }, 10 * 60 * 1000);

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, '0.0.0.0', () => {
    debugLog('Server', `🚀 Engineer Portal live on port ${PORT}`);
});
