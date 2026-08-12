const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
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

// 📦 Recharge Packages
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
let primaryCustomerBotUsername = 'JPWREACHSERVICESBOT';

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
    .then(async () => {
        debugLog('Database', '🟢 MongoDB Connected Successfully!');
        try {
            await mongoose.connection.collection('users').dropIndexes().catch(() => {});
        } catch(e) {}
        initAllBots();
        startOrderCleanupTimer();
    })
    .catch(err => debugLog('Database', '❌ DB Error:', err.message));

const userSchema = new mongoose.Schema({
    telegramChatId: { type: String, required: true, unique: true },
    name: { type: String, default: 'Engineer' },
    reaches: { type: Number, default: 0 },
    jpwCoins: { type: Number, default: 0 },
    activePackage: { type: String, default: 'No active package' },
    lastBonusTime: { type: Date, default: null },
    referredBy: { type: String, default: null },
    hasRecharged100: { type: Boolean, default: false },
    referralRewarded: { type: Boolean, default: false },
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

// 📌 SR (JPW Reached Services) Schema
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

let serverPublicUrl = '';

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

// 🔔 Regular Order Notification to Admin Bot
async function notifyAdminAndUser(order, user, messageText) {
    try {
        let adminKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Accept", callback_data: `accept_${order._id}` },
                        { text: "❌ Reject", callback_data: `reject_${order._id}` }
                    ],
                    [
                        { text: "⏳ In Progress", callback_data: `inprogress_${order._id}` },
                        { text: "🎉 Complete", callback_data: `complete_${order._id}` }
                    ],
                    [
                        { text: "💬 Reply", callback_data: `reply_${order._id}` },
                        { text: "🚫 Cancel & Refund", callback_data: `cancel_${order._id}` }
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

// 🔔 SR Order Notification to Admin Bot
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
                        ],
                        [
                            { text: "⏳ In Progress", callback_data: `srinprog_${srOrder._id}` },
                            { text: "🎉 Complete", callback_data: `srcomp_${srOrder._id}` }
                        ],
                        [
                            { text: "💬 Reply", callback_data: `srreply_${srOrder._id}` }
                        ]
                    ]
                }
            };
            await tempBot.sendMessage(ADMIN_CHAT_ID, `📌 **New SR Order Received**\n\n👤 Customer Name: ${srOrder.customerName}\n📞 Mobile: \`${srOrder.mobileNumber}\`\n☎️ Landline: \`${srOrder.landlineNumber}\`\n💬 Engineer Chat ID: \`${srOrder.telegramChatId}\``, { parse_mode: 'Markdown', ...keyboard });
        }
    } catch(e) {}
}

function startAdminBot(token) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});

        bot.on('message', async (msg) => {
            if (!msg || !msg.chat || !msg.text) return;
            const chatId = String(msg.chat.id);
            if (chatId !== ADMIN_CHAT_ID) return;

            const text = msg.text.trim();
            if (text.startsWith('/start')) {
                bot.sendMessage(chatId, `👑 **Admin Panel Active**`, { parse_mode: 'Markdown' });
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
                        await tempCustBot.sendMessage(order.telegramChatId, `💬 **Admin Reply regarding your Order**\n🎯 Target ID: \`${order.targetId}\`\n\n📢 *${text}*`, { parse_mode: 'Markdown' }).catch(()=>{});
                    }
                    bot.sendMessage(chatId, `✅ Reply sent successfully!`);
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
                        await tempCustBot.sendMessage(srOrder.telegramChatId, `💬 **Admin Update for SR (${srOrder.customerName}):**\n\n📢 *${text}*`, { parse_mode: 'Markdown' }).catch(()=>{});
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
            if (data.startsWith('sr')) {
                const [action, srId] = data.split('_');
                let srOrder = await SrModel.findById(srId);
                if (!srOrder) { bot.answerCallbackQuery(query.id, { text: 'Order not found!' }); return; }

                let user = await UserModel.findOne({ telegramChatId: srOrder.telegramChatId });
                let statusMsg = '';

                if (action === 'srreply') {
                    adminPendingSrReply[chatId] = srId;
                    bot.answerCallbackQuery(query.id, { text: 'Send reply...' });
                    bot.sendMessage(chatId, `✍️ Send reply message for SR Order (Customer: ${srOrder.customerName}):`, { parse_mode: 'Markdown' });
                    return;
                } else if (action === 'sraccept') {
                    srOrder.status = 'Accepted';
                    statusMsg = 'Accepted ✅';
                } else if (action === 'srreject') {
                    srOrder.status = 'Rejected';
                    statusMsg = 'Rejected ❌ (1 Coin Refunded)';
                    if (user) { user.jpwCoins += 1; await user.save(); }
                } else if (action === 'srinprog') {
                    srOrder.status = 'In Progress';
                    statusMsg = 'In Progress ⏳';
                } else if (action === 'srcomp') {
                    srOrder.status = 'Completed';
                    statusMsg = 'Completed 🎉';
                }

                await srOrder.save();
                bot.answerCallbackQuery(query.id, { text: 'Status updated!' });

                let hideKeyboard = (srOrder.status === 'Completed' || srOrder.status === 'Rejected');
                try {
                    await bot.editMessageText(`📌 **SR Order Status: ${statusMsg}**\n👤 Customer: ${srOrder.customerName}\n📞 Mobile: \`${srOrder.mobileNumber}\``, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: hideKeyboard ? { inline_keyboard: [] } : query.message.reply_markup
                    });
                } catch(e) {}

                if (CUSTOMER_BOT_TOKENS[0]) {
                    const tempCustBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
                    await tempCustBot.sendMessage(srOrder.telegramChatId, `📌 **SR Order Status Update**\n\n👤 Customer: ${srOrder.customerName}\n📌 Status: *${statusMsg}*`, { parse_mode: 'Markdown' }).catch(()=>{});
                }
            } else {
                // Regular Order Actions
                const [action, orderId] = data.split('_');
                let order = await OrderModel.findById(orderId);
                if (!order) { bot.answerCallbackQuery(query.id, { text: 'Order not found!' }); return; }

                let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });
                let statusMsg = '';

                if (action === 'reply') {
                    adminPendingReply[chatId] = orderId;
                    bot.answerCallbackQuery(query.id, { text: 'Send reply...' });
                    bot.sendMessage(chatId, `✍️ Send reply for Regular Order ID: \`${order.targetId}\``, { parse_mode: 'Markdown' });
                    return;
                } else if (action === 'accept') { order.status = 'Accepted'; statusMsg = 'Accepted ✅'; }
                else if (action === 'reject') { order.status = 'Rejected'; statusMsg = 'Rejected ❌ (1 Coin Refunded)'; if(user){user.jpwCoins+=1;await user.save();} }
                else if (action === 'inprogress') { order.status = 'In Progress'; statusMsg = 'In Progress ⏳'; }
                else if (action === 'complete') { order.status = 'Completed'; statusMsg = 'Completed 🎉'; }
                else if (action === 'cancel' && !order.status.includes('Refunded')) { order.status = 'Cancelled & Refunded'; statusMsg = 'Cancelled ❌ (1 Coin Refunded)'; if(user){user.jpwCoins+=1;await user.save();} }

                await order.save();
                bot.answerCallbackQuery(query.id, { text: 'Status updated!' });

                let hideKeyboard = (order.status === 'Completed' || order.status === 'Rejected' || order.status.includes('Cancelled'));
                try {
                    await bot.editMessageText(`📢 **Order Status: ${statusMsg}**\n🎯 Target ID: \`${order.targetId}\``, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: hideKeyboard ? { inline_keyboard: [] } : query.message.reply_markup
                    });
                } catch(e) {}

                if (CUSTOMER_BOT_TOKENS[0]) {
                    const tempCustBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
                    await tempCustBot.sendMessage(order.telegramChatId, `📢 **Regular Order Update**\n🎯 ID: \`${order.targetId}\`\n📌 Status: *${statusMsg}*`, { parse_mode: 'Markdown' }).catch(()=>{});
                }
            }
        });
    } catch (e) {}
}

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
            if (text.startsWith('/start')) {
                let user = await UserModel.findOne({ telegramChatId: chatId });
                if (!user) {
                    user = await UserModel.create({ telegramChatId: chatId, name: msg.from.first_name || 'Engineer', jpwCoins: 0 });
                }
                const portalUrl = serverPublicUrl || "https://cashtree.space";
                bot.sendMessage(chatId, `✨ **Welcome to JPW Engineer Portal Bot!** 🚀\n\n🆔 Chat ID: \`${chatId}\`\n🪙 Coins Balance: *${user.jpwCoins.toFixed(2)} Coins*\n\n[🚀 Open Mini App Portal](${portalUrl})`, { parse_mode: 'Markdown' });
                return;
            }
        });
    } catch(e) {}
}

// --- API ENDPOINTS ---
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

app.post('/api/order', async (req, res) => {
    try {
        const { telegramChatId, targetId, targetPass } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });

        if (!user || user.jpwCoins < 1) {
            return res.json({ success: false, message: 'Insufficient JPW Coins! 1 Coin required.' });
        }

        user.jpwCoins -= 1;
        await user.save();

        const newOrder = await OrderModel.create({ telegramChatId: String(telegramChatId), targetId, targetPass });
        await notifyAdminAndUser(newOrder, user, `🌐 **New Reach Order (Pending)**\n💬 Chat ID: \`${telegramChatId}\`\n🎯 ID: \`${targetId}\`\n🔑 Pass: \`${targetPass}\``);

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
        const serverUrl = "https://cashtree.space";
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
            order_meta: { return_url: `${serverUrl}/?payment=success&telegramChatId=${telegramChatId}&coins=${coins}&order_id=${orderId}` }
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

const SELF_URL = process.env.RENDER_EXTERNAL_URL || `https://cashtree.space`;
setInterval(() => { https.get(SELF_URL, (res) => {}).on('error', (err) => {}); }, 10 * 60 * 1000);

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, '0.0.0.0', () => {
    serverPublicUrl = process.env.RENDER_EXTERNAL_URL || `https://cashtree.space`;
    debugLog('Server', `🚀 Engineer Portal live on port ${PORT}`);
});
