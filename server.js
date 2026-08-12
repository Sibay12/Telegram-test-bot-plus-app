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

// 🤖 Your Customer Bot Tokens
const CUSTOMER_BOT_TOKENS = [
    '8874503246:AAEmdPcVJMQ3q6pmINsP_Tcwium3ANV4T6I',
    '8972064227:AAG3LadKR0mLXJgU3xL6BwMy7TxjYz8N3Rw'
];

// 👑 Your Dedicated Admin Bot Token
const ADMIN_BOT_TOKEN = '8736759061:AAGaSKOCQ9gUylCsqdAufHenEPeDQhQtSDU';

// 📦 Updated Recharge Packages (JPW Coins with Stepped Pricing for Bank Settlement Buffer)
const RECHARGE_PACKAGES = [
    { amount: 13, coins: 1 },
    { amount: 60, coins: 5 },
    { amount: 115, coins: 10 },
    { amount: 210, coins: 20 },
    { amount: 400, coins: 40 }
];

let otpStorage = {};
let adminPendingReply = {};
let adminPendingBroadcast = false;
let adminPendingGiveaway = false;
let transferSessions = {}; 

let botUsernamesMap = {}; 
let primaryCustomerBotUsername = 'JPWREACHSERVICESBOT';

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
    .then(async () => {
        debugLog('Database', '🟢 MongoDB Connected Successfully!');
        try {
            await mongoose.connection.collection('users').dropIndexes().catch(() => {});
        } catch(e) {}
        initAllBots();
        startBackgroundGreetingTimer();
        startOrderCleanupTimer();
    })
    .catch(err => debugLog('Database', '❌ DB Error:', err.message));

const userSchema = new mongoose.Schema({
    telegramChatId: { type: String, required: true, unique: true },
    name: { type: String, default: 'User' },
    phone: { type: String, default: '' },
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

const usedUtrSchema = new mongoose.Schema({
    utrId: { type: String, required: true, unique: true }
});

const UserModel = mongoose.model('User', userSchema);
const OrderModel = mongoose.model('Order', orderSchema);
const UsedUtrModel = mongoose.model('UsedUtr', usedUtrSchema);

let serverPublicUrl = '';

function initAllBots() {
    CUSTOMER_BOT_TOKENS.forEach((token, idx) => {
        if (token) startCustomerBot(token, idx === 0);
    });

    if (ADMIN_BOT_TOKEN) {
        startAdminBot(ADMIN_BOT_TOKEN);
    }
    debugLog('Bots', '🤖 All bots initialized successfully.');
}

function startOrderCleanupTimer() {
    setInterval(async () => {
        try {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            await OrderModel.deleteMany({
                createdAt: { $lt: twoHoursAgo },
                status: { $in: ['Completed', 'Rejected', 'Cancelled & Refunded'] }
            });
        } catch (err) {}
    }, 60 * 60 * 1000);
}

function startBackgroundGreetingTimer() {
    const INTERVAL_TIME = 20 * 60 * 1000;
    setInterval(async () => {
        try {
            const utcDate = new Date();
            const istTime = new Date(utcDate.getTime() + (330 * 60 * 1000));
            const hours = istTime.getUTCHours();
            const minutes = istTime.getUTCMinutes();
            const currentTimeInMinutes = hours * 60 + minutes;

            const startTime = 7 * 60 + 30; // 7:30 AM IST
            const endTime = 22 * 60;       // 10:00 PM IST

            if (currentTimeInMinutes < startTime || currentTimeInMinutes > endTime) {
                return;
            }

            const allUsers = await UserModel.find({});
            if (allUsers.length === 0) return;

            let timeGreeting = "Hello";
            if (hours >= 4 && hours < 12) timeGreeting = "Good Morning";
            else if (hours >= 12 && hours < 17) timeGreeting = "Good Afternoon";
            else if (hours >= 17 && hours < 21) timeGreeting = "Good Evening";

            for (let user of allUsers) {
                if (!user.telegramChatId) continue;
                const userName = user.name || 'Friend';
                const comfortMessage = `🌟 **${timeGreeting}, ${userName}!** 🌿\n\nEverything is running smoothly here. You don't need to worry about anything. Stay relaxed! 😌\n\nHave your meal peacefully, we are managing everything. Have a great time! ☕✨\n\n*(JPW REACHED SERVICES BOT)*`;

                if (CUSTOMER_BOT_TOKENS[0]) {
                    const tempBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
                    await tempBot.sendMessage(user.telegramChatId, comfortMessage, { parse_mode: 'Markdown' }).catch(() => {});
                }
            }
        } catch (err) {}
    }, INTERVAL_TIME);
}

async function notifyAdminDirect(messageText) {
    try {
        if (ADMIN_BOT_TOKEN) {
            const tempBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: false });
            await tempBot.sendMessage(ADMIN_CHAT_ID, messageText, { parse_mode: 'Markdown' });
        }
    } catch (e) {}
}

async function sendAdminDashboardMenu(bot, chatId) {
    const adminMenuKeyboard = {
        reply_markup: {
            keyboard: [
                [{ text: "📊 Total Users & Stats" }, { text: "👥 Check Referrals" }],
                [{ text: "🎁 Split Giveaway" }, { text: "📢 Send Announcement" }],
                [{ text: "🔄 Refresh Control" }]
            ],
            resize_keyboard: true,
            persistent: true
        }
    };
    await bot.sendMessage(chatId, `👑 **JPW REACHED SERVICES BOT - Admin Panel**\nDeveloped by tenaga technology`, { parse_mode: 'Markdown', ...adminMenuKeyboard });
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
                await sendAdminDashboardMenu(bot, chatId);
                return;
            }

            if (text === "🔄 Refresh Control") {
                await sendAdminDashboardMenu(bot, chatId);
                return;
            }

            if (text === "📊 Total Users & Stats") {
                const totalUsers = await UserModel.countDocuments();
                const totalOrders = await OrderModel.countDocuments();
                const pendingOrders = await OrderModel.countDocuments({ status: 'Pending' });
                bot.sendMessage(chatId, `📊 **System Statistics:**\n\n👥 Total Users: \`${totalUsers}\`\n📦 Total Orders: \`${totalOrders}\`\n⏳ Pending Orders: \`${pendingOrders}\`\n\n*JPW REACHED SERVICES BOT*\n*Developed by tenaga technology*`, { parse_mode: 'Markdown' });
                return;
            }

            if (text === "👥 Check Referrals") {
                const referredUsers = await UserModel.find({ referredBy: { $ne: null } }).sort({ createdAt: -1 }).limit(25);
                if (referredUsers.length === 0) {
                    bot.sendMessage(chatId, `ℹ️ No referral records found yet.`);
                    return;
                }

                let refText = `👥 **Recent Referral Activity (Last 25):**\n\n`;
                for (let u of referredUsers) {
                    let referrer = await UserModel.findOne({ telegramChatId: u.referredBy });
                    let refName = referrer ? referrer.name : u.referredBy;
                    refText += `👤 User: \`${u.name}\` (\`${u.telegramChatId}\`)\n   ↳ Referred By: \`${refName}\` (\`${u.referredBy}\`)\n   ↳ ₹100 Recharge Done: *${u.hasRecharged100 ? 'Yes ✅' : 'No ❌'}*\n\n`;
                }
                bot.sendMessage(chatId, refText, { parse_mode: 'Markdown' });
                return;
            }

            if (text === "🎁 Split Giveaway") {
                adminPendingGiveaway = true;
                adminPendingBroadcast = false;
                bot.sendMessage(chatId, `🎁 **Split Giveaway Mode Active!**\nSend the total coins to split equally among all users:`, { parse_mode: 'Markdown' });
                return;
            }

            if (text === "📢 Send Announcement") {
                adminPendingBroadcast = true;
                adminPendingGiveaway = false;
                bot.sendMessage(chatId, `📢 **Broadcast Mode Active!**\nSend the announcement message to broadcast:`, { parse_mode: 'Markdown' });
                return;
            }

            if (adminPendingGiveaway) {
                adminPendingGiveaway = false;
                const totalCoins = parseFloat(text);
                if (isNaN(totalCoins) || totalCoins <= 0) {
                    bot.sendMessage(chatId, `❌ Invalid amount! Please click the button again.`);
                    return;
                }

                const allUsers = await UserModel.find({});
                if (allUsers.length === 0) {
                    bot.sendMessage(chatId, `⚠️ No users found in database!`);
                    return;
                }

                const splitCoins = totalCoins / allUsers.length;
                let successCount = 0;
                for (let u of allUsers) {
                    u.jpwCoins += splitCoins;
                    await u.save();
                    successCount++;
                    try {
                        await bot.sendMessage(u.telegramChatId, `🎁 **Free Giveaway Split Alert!** 🎉\n\nAdmin has split a total of \`${totalCoins} JPW Coins\` among all users.\nYou received: \`+${splitCoins.toFixed(4)} JPW Coins\`! 🪙\n\n*(JPW REACHED SERVICES BOT)*`, { parse_mode: 'Markdown' });
                    } catch(e) {}
                }
                bot.sendMessage(chatId, `✅ Successfully split **${totalCoins} JPW Coins** among **${successCount} users**!`);
                return;
            }

            if (adminPendingBroadcast) {
                adminPendingBroadcast = false;
                const allUsers = await UserModel.find({});
                let count = 0;
                for (let u of allUsers) {
                    try {
                        await bot.sendMessage(u.telegramChatId, `📢 **Announcement:**\n\n${text}\n\n— *JPW REACHED SERVICES BOT*`, { parse_mode: 'Markdown' });
                        count++;
                    } catch(e) {}
                }
                bot.sendMessage(chatId, `✅ Broadcast successfully sent to ${count} users!`);
                return;
            }

            if (adminPendingReply[chatId]) {
                const orderId = adminPendingReply[chatId];
                delete adminPendingReply[chatId];

                let order = await OrderModel.findById(orderId);
                if (order) {
                    order.adminReply = text;
                    await order.save();
                    await notifyCustomerOnly(order, await UserModel.findOne({ telegramChatId: order.telegramChatId }), `💬 **Admin message regarding your order**\n🎯 Target ID: \`${order.targetId}\`\n\n📢 *${text}*`);
                    bot.sendMessage(chatId, `✅ Reply sent successfully!`);
                } else {
                    bot.sendMessage(chatId, `❌ Order not found!`);
                }
                return;
            }
        });

        bot.on('callback_query', async (query) => {
            const chatId = String(query.message.chat.id);
            if (chatId !== ADMIN_CHAT_ID) return;

            const data = query.data;
            const [action, orderId] = data.split('_');

            let order = await OrderModel.findById(orderId);
            if (!order) {
                bot.answerCallbackQuery(query.id, { text: 'Order not found!' });
                return;
            }

            let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });
            let statusMsg = '';
            let customerEmojiMsg = '';

            if (action === 'reply') {
                adminPendingReply[chatId] = orderId;
                bot.answerCallbackQuery(query.id, { text: 'Send your reply message...' });
                bot.sendMessage(chatId, `✍️ **Send reply for Order ID:** \`${order.targetId}\``, { parse_mode: 'Markdown' });
                return;
            } else if (action === 'accept') {
                order.status = 'Accepted';
                statusMsg = 'Accepted ✅';
                customerEmojiMsg = '🎉 **Great News! Your order has been ACCEPTED!** ✅';
            } else if (action === 'reject') {
                order.status = 'Rejected';
                statusMsg = 'Rejected ❌ (1 Coin Refunded)';
                if (user) { user.jpwCoins += 1; await user.save(); }
                customerEmojiMsg = '❌ **Order Rejected**\nYour JPW Coin has been refunded! 🔄🪙';
            } else if (action === 'inprogress') {
                order.status = 'In Progress';
                statusMsg = 'In Progress ⏳';
                customerEmojiMsg = '⏳ **Your order is In Progress!** 🔄';
            } else if (action === 'complete') {
                order.status = 'Completed';
                statusMsg = 'Completed 🎉';
                customerEmojiMsg = '🎉 **Congratulations! Your order has been successfully completed!** 🏆✨';
            } else if (action === 'cancel' && !order.status.includes('Refunded')) {
                order.status = 'Cancelled & Refunded';
                statusMsg = 'Cancelled ❌ (1 Coin Refunded)';
                if (user) { user.jpwCoins += 1; await user.save(); }
                customerEmojiMsg = '🚫 **Order Cancelled & JPW Coin Refunded** 🔄🪙';
            }

            await order.save();
            bot.answerCallbackQuery(query.id, { text: `Status updated!` });

            try {
                if (order.status === 'Completed' || order.status === 'Rejected' || order.status.includes('Cancelled')) {
                    await bot.editMessageText(`📢 **ORDER ${order.status.toUpperCase()}**\n🎯 Target ID: \`${order.targetId}\`\n📌 Status: *${statusMsg}*`, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [] }
                    });
                } else {
                    let updatedKeyboard = {
                        reply_markup: {
                            inline_keyboard: [
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
                    await bot.editMessageText(`📢 **Order Status: ${statusMsg}**\n🎯 Target ID: \`${order.targetId}\`\n🔑 Pass: \`${order.targetPass}\``, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        ...updatedKeyboard
                    });
                }
            } catch(e) {}

            await notifyCustomerOnly(order, user, `📢 **Order Status Update** 🌟\n\n🎯 **Target ID:** \`${order.targetId}\`\n\n${customerEmojiMsg}\n\n🪙 Coins Balance: *${user ? user.jpwCoins.toFixed(2) : 0} JPW Coins*`);
        });
    } catch (e) {}
}

async function sendCustomerHomeMenu(bot, chatId, botUsername) {
    let user = await UserModel.findOne({ telegramChatId: chatId });
    const coinsBal = user ? user.jpwCoins.toFixed(2) : "0.00";
    const reachesBal = user ? user.reaches.toFixed(4) : "0.0000";
    const activePkg = user ? user.activePackage : "No active package";

    const portalUrl = serverPublicUrl || "https://cashtree.space";
    const referralLink = `https://t.me/${botUsername}?start=ref_${chatId}`;
    
    const welcomeMessage = `✨ **Welcome to JPW REACHED SERVICES BOT!** 🚀\n\n🆔 **Your Web Login ID / Chat ID:** \`${chatId}\`\n\n🔗 **Direct Mini App Portal Link:**\n${portalUrl}\n\n👥 **Your Refer & Earn Link:**\n\`${referralLink}\`\n*(Win JPW Coins - When your friend makes a ₹100+ recharge)*\n\n📝 **Order Format:** Send directly in chat: \`TARGET_ID PASSWORD\` (Costs 1 JPW Coin)\n\n📦 **Active Package:** ${activePkg}\n🪙 **JPW Coins Balance:** ${coinsBal} Coins\n💎 **Reaches Balance:** ${reachesBal}\n\n🤖 *JPW REACHED SERVICES BOT*\n💻 *Developed by tenaga technology*`;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🚀 Open Mini App Portal", web_app: { url: portalUrl } }],
                [{ text: "🎁 Daily Bonus", callback_data: "claim_daily_bonus" }, { text: "🔄 Convert Coins ➡️ Reaches", callback_data: "convert_coins" }],
                [{ text: "🤝 Share Coins", callback_data: "start_reach_transfer" }, { text: "👥 Refer & Earn", callback_data: "show_referral_info" }],
                [{ text: "🪙 Check Balance", callback_data: "check_balance" }, { text: "📦 Buy JPW Coins", callback_data: "view_packages" }]
            ]
        }
    };

    return await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', ...keyboard });
}

function startCustomerBot(token, isPrimary) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});

        let currentBotUsername = '';
        bot.getMe().then(info => {
            currentBotUsername = info.username;
            if (isPrimary) primaryCustomerBotUsername = currentBotUsername;
            botUsernamesMap[token] = currentBotUsername;
        }).catch(() => {});

        bot.on('message', async (msg) => {
            if (!msg || !msg.chat || !msg.text) return;
            const chatId = String(msg.chat.id);
            if (chatId === ADMIN_CHAT_ID) return;

            const text = msg.text.trim();
            const activeBotUsername = currentBotUsername || primaryCustomerBotUsername || 'JPWREACHSERVICESBOT';

            if (text.startsWith('/start')) {
                const payload = text.split(' ')[1];
                let referrerId = null;
                if (payload && payload.startsWith('ref_')) {
                    referrerId = payload.replace('ref_', '').trim();
                }

                let user = await UserModel.findOne({ telegramChatId: chatId });
                if (!user) {
                    user = await UserModel.create({ 
                        telegramChatId: chatId, 
                        name: msg.from.first_name || 'User', 
                        jpwCoins: 0,
                        reaches: 0,
                        referredBy: (referrerId && referrerId !== chatId) ? referrerId : null
                    });
                    await notifyAdminDirect(`👤 **New User Registered via Bot (@${activeBotUsername})**\n💬 Chat ID: \`${chatId}\`\n📌 Name: ${msg.from.first_name || 'User'}${referrerId ? ` (Referred by: ${referrerId})` : ''}`);
                }
                await sendCustomerHomeMenu(bot, chatId, activeBotUsername);
                return;
            }

            if (transferSessions[chatId]) {
                const session = transferSessions[chatId];
                if (session.step === 'awaiting_receiver') {
                    session.receiverId = text;
                    session.step = 'awaiting_amount';
                    bot.sendMessage(chatId, `✍️ How many JPW Coins do you want to send? (Enter amount)`, { parse_mode: 'Markdown' });
                    return;
                } else if (session.step === 'awaiting_amount') {
                    const amount = parseFloat(text);
                    const receiverId = session.receiverId;
                    delete transferSessions[chatId];

                    if (isNaN(amount) || amount <= 0) {
                        bot.sendMessage(chatId, `❌ Invalid amount! Transfer cancelled.`);
                        await sendCustomerHomeMenu(bot, chatId, activeBotUsername);
                        return;
                    }

                    if (receiverId === chatId) {
                        bot.sendMessage(chatId, `❌ You cannot send coins to yourself!`);
                        await sendCustomerHomeMenu(bot, chatId, activeBotUsername);
                        return;
                    }

                    let sender = await UserModel.findOne({ telegramChatId: chatId });
                    if (!sender || sender.jpwCoins < amount) {
                        bot.sendMessage(chatId, `❌ Insufficient JPW Coins balance!`);
                        await sendCustomerHomeMenu(bot, chatId, activeBotUsername);
                        return;
                    }

                    let receiver = await UserModel.findOne({ telegramChatId: receiverId });
                    if (!receiver) {
                        bot.sendMessage(chatId, `❌ Receiver (Chat ID: ${receiverId}) is not registered in the system!`);
                        await sendCustomerHomeMenu(bot, chatId, activeBotUsername);
                        return;
                    }

                    sender.jpwCoins -= amount;
                    receiver.jpwCoins += amount;

                    await sender.save();
                    await receiver.save();

                    bot.sendMessage(chatId, `✅ **JPW Coins Sent Successfully!**\nYou transferred ${amount} Coins.\nNew Balance: *${sender.jpwCoins.toFixed(2)} Coins*`, { parse_mode: 'Markdown' });
                    
                    try {
                        await bot.sendMessage(receiverId, `🎁 **JPW Coins Received!** 🎉\n\nYou received \`+${amount} Coins\` from ${sender.name || 'a user'} (${chatId})!\nNew Balance: *${receiver.jpwCoins.toFixed(2)} Coins* 🪙`, { parse_mode: 'Markdown' });
                    } catch(e) {}

                    await sendCustomerHomeMenu(bot, chatId, activeBotUsername);
                    return;
                }
            }

            const parts = text.split(' ');
            if (parts.length >= 2 && parts[0].length >= 8) {
                const targetId = parts[0];
                const targetPass = parts.slice(1).join(' ');

                let user = await UserModel.findOne({ telegramChatId: chatId });
                if (!user || user.jpwCoins < 1) {
                    bot.sendMessage(chatId, `❌ **Insufficient JPW Coins!** You need at least 1 JPW Coin to submit an order.`);
                    return;
                }

                user.jpwCoins -= 1;
                await user.save();

                const newOrder = await OrderModel.create({ telegramChatId: chatId, targetId, targetPass });
                await notifyAdminAndUser(newOrder, user, `🌐 **New Bot Order (Pending)**\n💬 Chat ID: \`${chatId}\`\n🎯 ID: \`${targetId}\`\n🔑 Pass: \`${targetPass}\``);

                bot.sendMessage(chatId, `📦 **Order Successfully Submitted!** 🚀\n\n🎯 Target ID: \`${targetId}\`\n📌 Status: *Pending ⏳*\n🪙 Remaining Coins: *${user.jpwCoins.toFixed(2)} Coins*`);
                return;
            }
        });

        bot.on('callback_query', async (query) => {
            const chatId = String(query.message.chat.id);
            const data = query.data;
            let user = await UserModel.findOne({ telegramChatId: chatId });
            const activeBotUsername = currentBotUsername || primaryCustomerBotUsername || 'JPWREACHSERVICESBOT';

            if (data === 'show_referral_info') {
                const portalUrl = serverPublicUrl || "https://cashtree.space";
                const referralLink = `https://t.me/${botUsername}?start=ref_${chatId}`;
                bot.answerCallbackQuery(query.id, { text: 'Refer & Earn info' });
                bot.sendMessage(chatId, `👥 **Refer & Earn System:**\n\nYour Link:\n\`${referralLink}\`\n\n📌 **Rule:** When your friend joins and completes a minimum ₹100 recharge, you will get a random JPW Coins bonus!`, { parse_mode: 'Markdown' });
            } else if (data === 'start_reach_transfer') {
                transferSessions[chatId] = { step: 'awaiting_receiver' };
                bot.answerCallbackQuery(query.id, { text: 'Starting coin transfer...' });
                bot.sendMessage(chatId, `🤝 **Share JPW Coins:**\nEnter recipient's **Telegram Chat ID**:`, { parse_mode: 'Markdown' });
            } else if (data === 'convert_coins') {
                if (!user || user.jpwCoins < 1) {
                    bot.answerCallbackQuery(query.id, { text: '❌ You need at least 1 JPW Coin to convert!', show_alert: true });
                    return;
                }
                const convertAmount = Math.floor(user.jpwCoins);
                user.jpwCoins -= convertAmount;
                user.reaches += convertAmount;
                await user.save();
                bot.answerCallbackQuery(query.id, { text: `✅ Converted ${convertAmount} Coins to Reaches!`, show_alert: true });
                bot.sendMessage(chatId, `🔄 **Conversion Successful!**\nConverted \`${convertAmount} JPW Coins\` into \`${convertAmount} Reaches\` 💎\n\n🪙 Coins: *${user.jpwCoins.toFixed(2)}*\n💎 Reaches: *${user.reaches.toFixed(4)}*`, { parse_mode: 'Markdown' });
            } else if (data === 'claim_daily_bonus') {
                const now = new Date();
                if (user && user.lastBonusTime) {
                    const diffTime = now - new Date(user.lastBonusTime);
                    const hoursLeft = 24 - (diffTime / (1000 * 60 * 60));
                    if (hoursLeft > 0) {
                        bot.answerCallbackQuery(query.id, { text: `⏳ Please wait ${hoursLeft.toFixed(1)} hours for next bonus!`, show_alert: true });
                        return;
                    }
                }
                if (user) {
                    const randomBonus = parseFloat((Math.random() * (0.1 - 0.01) + 0.01).toFixed(2));
                    user.jpwCoins += randomBonus;
                    user.lastBonusTime = now;
                    await user.save();
                    bot.answerCallbackQuery(query.id, { text: `🎉 +${randomBonus} JPW Coins Claimed!`, show_alert: true });
                    bot.sendMessage(chatId, `🎁 **Daily Bonus Claimed!**\n\`+${randomBonus} JPW Coins\` added. Balance: *${user.jpwCoins.toFixed(2)} Coins* 🪙`, { parse_mode: 'Markdown' });
                }
            } else if (data === 'check_balance') {
                const coins = user ? user.jpwCoins : 0;
                const reaches = user ? user.reaches : 0;
                bot.answerCallbackQuery(query.id, { text: `Coins: ${coins.toFixed(2)} | Reaches: ${reaches.toFixed(4)}` });
                bot.sendMessage(chatId, `🪙 **Your Balance:**\n\nJPW Coins: *${coins.toFixed(2)} Coins*\nReaches: *${reaches.toFixed(4)} Reaches* ✨`, { parse_mode: 'Markdown' });
            } else if (data === 'view_packages') {
                let inlineRows = [];
                RECHARGE_PACKAGES.forEach(p => {
                    inlineRows.push([{ text: `💳 Buy ₹${p.amount} ➡️ ${p.coins} JPW Coins`, callback_data: `buy_${p.amount}_${p.coins}` }]);
                });
                bot.sendMessage(chatId, `📦 **Select JPW Coin Package:** 🔥`, {
                    reply_markup: { inline_keyboard: inlineRows }
                });
            } else if (data.startsWith('buy_')) {
                const [, amount, coins] = data.split('_');
                bot.answerCallbackQuery(query.id, { text: 'Generating payment link...' });
                
                try {
                    const protocol = 'https';
                    const serverUrl = serverPublicUrl || "https://cashtree.space";
                    let orderId = `JPW_${Date.now()}_${chatId}`;

                    const postData = JSON.stringify({
                        order_id: orderId,
                        order_amount: parseFloat(amount),
                        order_currency: "INR",
                        customer_details: { customer_id: String(chatId), customer_phone: "9999999999", customer_email: "test@jpw.com" },
                        order_meta: { return_url: `${serverUrl}/?payment=success&telegramChatId=${chatId}&coins=${coins}&order_id=${orderId}` }
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
                        response.on('end', async () => {
                            try {
                                const json = JSON.parse(body);
                                if (response.statusCode === 200 && json.payment_session_id) {
                                    const portalUrl = serverPublicUrl || "https://cashtree.space";
                                    await bot.sendMessage(chatId, `💳 **Click below to complete your payment via Cashfree:**\n\n[👉 Pay ₹${amount} (For ${coins} JPW Coins)](${portalUrl})`, { parse_mode: 'Markdown' });
                                } else {
                                    await bot.sendMessage(chatId, `❌ Payment initialization failed: ${json.message || 'Error'}`);
                                }
                            } catch(e) {
                                await bot.sendMessage(chatId, `❌ Payment link error.`);
                            }
                        });
                    });
                    reqCashfree.on('error', () => {
                        bot.sendMessage(chatId, `❌ Network connection error.`);
                    });
                    reqCashfree.write(postData);
                    reqCashfree.end();

                } catch(err) {
                    bot.sendMessage(chatId, `❌ Error generating Cashfree link.`);
                }
            }
        });
    } catch (e) {}
}

async function notifyCustomerOnly(order, user, messageText) {
    try {
        if (user && user.telegramChatId) {
            const custBotToken = CUSTOMER_BOT_TOKENS[0];
            if (custBotToken) {
                const tempCustBot = new TelegramBot(custBotToken, { polling: false });
                await tempCustBot.sendMessage(user.telegramChatId, messageText, { parse_mode: 'Markdown' });
                
                if (order && (order.status === 'Completed' || order.status === 'Rejected' || order.status.includes('Cancelled'))) {
                    setTimeout(async () => {
                        let botInfo = await tempCustBot.getMe().catch(() => ({ username: primaryCustomerBotUsername }));
                        await sendCustomerHomeMenu(tempCustBot, user.telegramChatId, botInfo.username);
                    }, 3000);
                }
            }
        }
    } catch (e) {}
}

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

app.get('/api/bot-info', async (req, res) => {
    try {
        res.json({ success: true, botUsername: primaryCustomerBotUsername });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/send-otp', async (req, res) => {
    try {
        let { telegramChatId } = req.body;
        if (!telegramChatId) return res.json({ success: false, message: 'Chat ID required' });

        telegramChatId = String(telegramChatId).trim();
        let user = await UserModel.findOne({ telegramChatId });
        
        if (!user) {
            return res.json({ success: false, message: 'User not registered! Please start the bot first.' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStorage[telegramChatId] = { otp, expires: Date.now() + 5 * 60 * 1000 };

        if (CUSTOMER_BOT_TOKENS[0]) {
            const tempBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
            await tempBot.sendMessage(telegramChatId, `🔐 **Portal Login OTP:** \`${otp}\`\n\nThis OTP is valid for 5 minutes only.`, { parse_mode: 'Markdown' });
        }

        res.json({ success: true, message: 'OTP sent successfully!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/verify-otp', async (req, res) => {
    try {
        let { telegramChatId, otp } = req.body;
        if (!telegramChatId || !otp) return res.json({ success: false, message: 'Invalid details' });

        telegramChatId = String(telegramChatId).trim();
        const record = otpStorage[telegramChatId];

        if (!record || record.expires < Date.now()) {
            return res.json({ success: false, message: 'OTP has expired!' });
        }

        if (record.otp !== String(otp).trim()) {
            return res.json({ success: false, message: 'Incorrect OTP!' });
        }

        delete otpStorage[telegramChatId];
        let user = await UserModel.findOne({ telegramChatId });

        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/mini-app/auth', async (req, res) => {
    try {
        let { telegramChatId, name } = req.body;
        if (!telegramChatId) return res.json({ success: false, message: 'Unauthorized' });

        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (!user) {
            user = await UserModel.create({ telegramChatId: String(telegramChatId), name: name || 'User', jpwCoins: 0, reaches: 0 });
            await notifyAdminDirect(`👤 **New Mini App User**\n💬 Chat ID: \`${telegramChatId}\`\n📌 Name: ${name}`);
        }

        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/login', (req, res) => {
    try {
        const { password } = req.body;
        if (password === ADMIN_SECRET_PASS) {
            return res.json({ success: true });
        } else {
            return res.json({ success: false, message: 'Incorrect password!' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/admin/logs', (req, res) => {
    try {
        const logs = getRecentLogs();
        res.json({ success: true, logs });
    } catch (err) {
        res.status(500).json({ success: false, logs: err.message });
    }
});

app.get('/api/admin/referrals', async (req, res) => {
    try {
        const referredUsers = await UserModel.find({ referredBy: { $ne: null } }).sort({ createdAt: -1 });
        let referralList = [];
        for (let u of referredUsers) {
            let referrer = await UserModel.findOne({ telegramChatId: u.referredBy });
            referralList.push({
                userName: u.name,
                userChatId: u.telegramChatId,
                referrerName: referrer ? referrer.name : 'Unknown',
                referrerChatId: u.referredBy,
                hasRecharged100: u.hasRecharged100,
                createdAt: u.createdAt
            });
        }
        res.json({ success: true, referrals: referralList });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/claim-daily-bonus', async (req, res) => {
    try {
        const { telegramChatId } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (!user) return res.json({ success: false, message: 'User not found' });

        const now = new Date();
        if (user.lastBonusTime) {
            const diffTime = now - new Date(user.lastBonusTime);
            const hoursLeft = 24 - (diffTime / (1000 * 60 * 60));
            if (hoursLeft > 0) {
                return res.json({ success: false, message: `Please wait ${hoursLeft.toFixed(1)} hours for next bonus!` });
            }
        }

        const randomBonus = parseFloat((Math.random() * (0.1 - 0.01) + 0.01).toFixed(2));
        user.jpwCoins += randomBonus;
        user.lastBonusTime = now;
        await user.save();
        res.json({ success: true, message: `Daily bonus claimed: +${randomBonus} Coins`, user, randomBonus });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/claim-ad-reward', async (req, res) => {
    try {
        const adResult = adsModule.handleAdReward(null);
        res.json({ success: false, message: adResult.message });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/transfer-coins', async (req, res) => {
    try {
        const { senderChatId, receiverChatId, amount } = req.body;
        const sendAmount = parseFloat(amount);

        if (!senderChatId || !receiverChatId || isNaN(sendAmount) || sendAmount <= 0) {
            return res.json({ success: false, message: 'Invalid details provided!' });
        }

        if (senderChatId === receiverChatId) {
            return res.json({ success: false, message: 'You cannot transfer coins to yourself!' });
        }

        let sender = await UserModel.findOne({ telegramChatId: String(senderChatId) });
        if (!sender || sender.jpwCoins < sendAmount) {
            return res.json({ success: false, message: 'Insufficient JPW Coins balance!' });
        }

        let receiver = await UserModel.findOne({ telegramChatId: String(receiverChatId) });
        if (!receiver) {
            return res.json({ success: false, message: 'Receiver chat ID is not registered!' });
        }

        sender.jpwCoins -= sendAmount;
        receiver.jpwCoins += sendAmount;

        await sender.save();
        await receiver.save();

        try {
            if (CUSTOMER_BOT_TOKENS[0]) {
                const tempBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
                await tempBot.sendMessage(receiverChatId, `🎁 **Coins Received Alert!** 🎉\n\nYou received \`+${sendAmount} JPW Coins\` from ${sender.name || 'a user'}!\nNew Balance: *${receiver.jpwCoins.toFixed(2)} Coins* 🪙`, { parse_mode: 'Markdown' });
            }
        } catch(e) {}

        res.json({ success: true, message: `Successfully transferred ${sendAmount} JPW Coins!`, sender });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/convert-coins', async (req, res) => {
    try {
        const { telegramChatId, amount } = req.body;
        const convertAmt = parseInt(amount);
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });

        if (!user || isNaN(convertAmt) || convertAmt <= 0 || user.jpwCoins < convertAmt) {
            return res.json({ success: false, message: 'Invalid amount or insufficient coins!' });
        }

        user.jpwCoins -= convertAmt;
        user.reaches += convertAmt;
        await user.save();

        res.json({ success: true, message: `Successfully converted ${convertAmt} Coins to Reaches!`, user });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/giveaway', async (req, res) => {
    try {
        const { totalAmount } = req.body;
        const amount = parseFloat(totalAmount);
        if (isNaN(amount) || amount <= 0) {
            return res.json({ success: false, message: 'Invalid amount!' });
        }

        const allUsers = await UserModel.find({});
        if (allUsers.length === 0) {
            return res.json({ success: false, message: 'No users found in database!' });
        }

        const splitAmount = amount / allUsers.length;
        for (let u of allUsers) {
            u.jpwCoins += splitAmount;
            await u.save();
            try {
                if (CUSTOMER_BOT_TOKENS[0]) {
                    const tempBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
                    await tempBot.sendMessage(u.telegramChatId, `🎁 **Free Giveaway Split Alert!** 🎉\n\nAdmin has split a total of \`${amount} JPW Coins\` among all users.\nYou received: \`+${splitAmount.toFixed(4)} Coins\`! 🪙\n\n*(JPW REACHED SERVICES BOT)*`, { parse_mode: 'Markdown' });
                }
            } catch(e) {}
        }
        res.json({ success: true, message: `Successfully split ${amount} JPW Coins among ${allUsers.length} users!` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/broadcast', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.json({ success: false, message: 'Message required!' });

        const allUsers = await UserModel.find({});
        let count = 0;
        for (let u of allUsers) {
            try {
                if (CUSTOMER_BOT_TOKENS[0]) {
                    const tempBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
                    await tempBot.sendMessage(u.telegramChatId, `📢 **Announcement:**\n\n${message}\n\n— *JPW REACHED SERVICES BOT*`, { parse_mode: 'Markdown' });
                    count++;
                }
            } catch(e) {}
        }
        res.json({ success: true, message: `Announcement sent to ${count} users!` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/clear-database', async (req, res) => {
    try {
        const { pin } = req.body;
        if (pin !== '9999') {
            return res.json({ success: false, message: 'Incorrect security PIN!' });
        }
        await UserModel.deleteMany({});
        await OrderModel.deleteMany({});
        await UsedUtrModel.deleteMany({});
        res.json({ success: true, message: 'Server database successfully cleared!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/packages', (req, res) => {
    res.json({ success: true, packages: RECHARGE_PACKAGES });
});

// --- CASHFREE PAYMENT API ---
app.post('/api/pay', async (req, res) => {
    try {
        const { telegramChatId, amount, coins } = req.body;
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const serverUrl = "https://cashtree.space";
        let orderId = `JPW_${Date.now()}_${telegramChatId}`;

        let finalPayAmount = parseFloat(amount);

        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (user) {
            user.activePackage = `₹${amount} (${coins} JPW Coins)`;
            
            if (amount >= 100 && user.referredBy && !user.hasRecharged100) {
                user.hasRecharged100 = true;
                
                let referrer = await UserModel.findOne({ telegramChatId: user.referredBy });
                if (referrer && !user.referralRewarded) {
                    user.referralRewarded = true;
                    
                    let refBonus = parseFloat((Math.random() * (5.0 - 0.5) + 0.5).toFixed(2));

                    referrer.jpwCoins += refBonus;
                    await referrer.save();

                    try {
                        if (CUSTOMER_BOT_TOKENS[0]) {
                            const tempBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
                            await tempBot.sendMessage(referrer.telegramChatId, `👥 **Referral Bonus Received!** 🎉\n\nYour referred user has completed a ₹100+ recharge!\nYou received: \`+${refBonus} JPW Coins\`! 🪙\n\n*(JPW REACHED SERVICES BOT)*`, { parse_mode: 'Markdown' });
                        }
                    } catch(e) {}
                }
            }

            await user.save();
        }

        const postData = JSON.stringify({
            order_id: orderId,
            order_amount: finalPayAmount,
            order_currency: "INR",
            customer_details: {
                customer_id: String(telegramChatId),
                customer_phone: "9999999999",
                customer_email: "test@jpw.com"
            },
            order_meta: {
                return_url: `${serverUrl}/?payment=success&telegramChatId=${telegramChatId}&coins=${coins}&order_id=${orderId}`
            }
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
                        res.json({ success: true, paymentSessionId: json.payment_session_id, orderId, environment: 'PRODUCTION' });
                    } else {
                        res.json({ success: false, message: json.message || 'Cashfree Authorization Failed' });
                    }
                } catch(e) { 
                    res.status(500).json({ success: false, message: 'JSON Parse Error' }); 
                }
            });
        });
        reqCashfree.on('error', (err) => { 
            res.status(500).json({ success: false, message: 'Network Error: ' + err.message }); 
        });
        reqCashfree.write(postData);
        reqCashfree.end();

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/verify-instant', async (req, res) => {
    try {
        const { telegramChatId, coins, order_id } = req.body;
        const transactionId = order_id || `INSTANT_${Date.now()}_${telegramChatId}`;
        const existingUtr = await UsedUtrModel.findOne({ utrId: transactionId });
        if (existingUtr) return res.json({ success: false, message: 'Already credited!' });

        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (user) {
            await UsedUtrModel.create({ utrId: transactionId });
            user.jpwCoins += parseFloat(coins);
            await user.save();
            await notifyCustomerOnly(null, user, `💳 **Payment Successful!** 🎉✨\n\n✨ Added: \`+${coins} JPW Coins\` 🪙\n💰 **New Coins Balance:** \`${user.jpwCoins.toFixed(2)} Coins\` 🪙\n\n*(JPW REACHED SERVICES BOT)*`);
            res.json({ success: true, user });
        } else { 
            res.json({ success: false, message: 'User not found' }); 
        }
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

app.post('/api/order', async (req, res) => {
    try {
        const { telegramChatId, targetId, targetPass } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });

        if (!user || user.jpwCoins < 1) {
            return res.json({ success: false, message: 'Insufficient JPW Coins! At least 1 Coin is required.' });
        }

        user.jpwCoins -= 1;
        await user.save();

        const newOrder = await OrderModel.create({ telegramChatId: String(telegramChatId), targetId, targetPass });
        await notifyAdminAndUser(newOrder, user, `🌐 **New Website Order (Pending)**\n💬 Chat ID: \`${telegramChatId}\`\n🎯 ID: \`${targetId}\`\n🔑 Pass: \`${targetPass}\``);

        await notifyCustomerOnly(newOrder, user, `📦 **Order Successfully Placed!** 🚀✨\n\n🎯 **Target ID:** \`${targetId}\`\n📌 **Status:** *Pending ⏳*\n\n🪙 Remaining Coins: *${user.jpwCoins.toFixed(2)} Coins*`);

        res.json({ success: true, message: 'Order successfully submitted!', remainingCoins: user.jpwCoins });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/admin/data', async (req, res) => {
    try {
        const orders = await OrderModel.find().sort({ createdAt: -1 });
        const users = await UserModel.find();
        const bots = [
            { _id: 1, type: 'customer', botUsername: 'Customer Bot 1' },
            { _id: 2, type: 'customer', botUsername: 'Customer Bot 2' },
            { _id: 3, type: 'admin', botUsername: 'Admin Bot' }
        ];
        res.json({ success: true, orders, users, bots });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/update-reaches', async (req, res) => {
    try {
        const { userId, action, count } = req.body;
        let user = await UserModel.findById(userId);
        if (!user) return res.json({ success: false, message: 'User not found' });

        const amount = parseFloat(count) || 0;
        if (action === 'add') {
            user.jpwCoins += amount;
        } else if (action === 'deduct') {
            user.jpwCoins = Math.max(0, user.jpwCoins - amount);
        }
        await user.save();
        res.json({ success: true, message: `Coins updated! New Balance: ${user.jpwCoins.toFixed(2)}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/order-action', async (req, res) => {
    try {
        const { orderId, action } = req.body;
        let order = await OrderModel.findById(orderId);
        if (!order) return res.json({ success: false, message: 'Order not found' });

        let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });
        let statusMsg = '';

        if (action === 'accept') {
            order.status = 'Accepted';
            statusMsg = 'Accepted ✅';
        } else if (action === 'reject') {
            order.status = 'Rejected';
            statusMsg = 'Rejected ❌ (1 Coin Refunded)';
            if (user) { user.jpwCoins += 1; await user.save(); }
        } else if (action === 'inprogress') {
            order.status = 'In Progress';
            statusMsg = 'In Progress ⏳';
        } else if (action === 'complete') {
            order.status = 'Completed';
            statusMsg = 'Completed 🎉';
        } else if (action === 'cancel' && !order.status.includes('Refunded')) {
            order.status = 'Cancelled & Refunded';
            statusMsg = 'Cancelled ❌ (1 Coin Refunded)';
            if (user) { user.jpwCoins += 1; await user.save(); }
        }

        await order.save();
        await notifyAdminAndUser(order, user, `📢 **Order Status Update**\n🎯 Target ID: \`${order.targetId}\`\n📌 Status: *${statusMsg}*`);

        res.json({ success: true, message: `Order status updated: ${order.status}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/delete-user', async (req, res) => {
    try {
        const { userId } = req.body;
        await UserModel.findByIdAndDelete(userId);
        res.json({ success: true, message: 'Customer deleted successfully!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const SELF_URL = process.env.RENDER_EXTERNAL_URL || `https://cashtree.space`;
setInterval(() => {
    https.get(SELF_URL, (res) => {}).on('error', (err) => {});
}, 10 * 60 * 1000);

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    serverPublicUrl = process.env.RENDER_EXTERNAL_URL || `https://cashtree.space`;
    debugLog('Server', `🚀 System live on port ${PORT}`);
});
