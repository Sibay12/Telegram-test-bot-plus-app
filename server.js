const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
const { debugLog, getRecentLogs } = require('./utils/logger');

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

const INSTAMOJO_API_KEY = '2a3b36b356808da2c7bdfb0baa74cfa9';
const INSTAMOJO_AUTH_TOKEN = '06473101d417ab781de64a064a25a5a2';

const CUSTOMER_BOT_TOKENS = [
    '8437403049:AAGpJJ4dZZ5it5duK-hcvJE5Xu8rxu8J2XY',
    '8945258673:AAG_-nLAQLbv5-LGxfk2wPW5mMfbKD-PN0w'
];
const ADMIN_BOT_TOKEN = '8945258673:AAG_-nLAQLbv5-LGxfk2wPW5mMfbKD-PN0w';

const RECHARGE_PACKAGES = [
    { amount: 20, reaches: 1 },
    { amount: 50, reaches: 3 },
    { amount: 100, reaches: 7 },
    { amount: 200, reaches: 15 },
    { amount: 400, reaches: 33 },
    { amount: 800, reaches: 70 },
    { amount: 1000, reaches: 99 }
];

let otpStorage = {};
let adminPendingReply = {};

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
    .then(async () => {
        debugLog('Database', '🟢 MongoDB Connected Successfully!');
        try {
            await mongoose.connection.collection('users').dropIndexes().catch(() => {});
        } catch(e) {}
        initAllBots();
        startBackgroundGreetingTimer(); // ⏰ Background Timer (7:30 AM to 10:00 PM)
    })
    .catch(err => debugLog('Database', '❌ DB Error:', err.message));

const userSchema = new mongoose.Schema({
    telegramChatId: { type: String, required: true, unique: true },
    name: { type: String, default: 'User' },
    phone: { type: String, default: '' },
    reaches: { type: Number, default: 0 },
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

let primaryCustomerBotUsername = '';
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

// ⏰ Background Timer: 7:30 AM se 10:00 PM tak har 20 minute me Hinglish comfort message
function startBackgroundGreetingTimer() {
    const INTERVAL_TIME = 20 * 60 * 1000; // 20 minutes
    setInterval(async () => {
        try {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            const currentTimeInMinutes = hours * 60 + minutes;

            // Time range: 7:30 AM (450 mins) to 10:00 PM (1320 mins)
            const startTime = 7 * 60 + 30; // 450
            const endTime = 22 * 60;       // 1320

            if (currentTimeInMinutes < startTime || currentTimeInMinutes > endTime) {
                return; // Raat 10 baje ke baad aur subah 7:30 se pehle kuch nahi bhejna hai
            }

            const allUsers = await UserModel.find({});
            if (allUsers.length === 0) return;

            let timeGreeting = "Hello";
            if (hours >= 4 && hours < 12) {
                timeGreeting = "Good Morning";
            } else if (hours >= 12 && hours < 17) {
                timeGreeting = "Good Afternoon";
            } else if (hours >= 17 && hours < 21) {
                timeGreeting = "Good Evening";
            } else {
                timeGreeting = "Hello";
            }

            for (let user of allUsers) {
                if (!user.telegramChatId) continue;
                const userName = user.name || 'Friend';
                
                const comfortMessage = `🌟 **${timeGreeting}, ${userName} ji!** 🌿\n\nSab kuch yahan smoothly handle ho raha hai, aapko kisi bhi baat ki tension लेने ki koi zarurat nahi hai. Aap bilkul sukoon se rahiye! 😌\n\nAraam se apna lunch/nashta kijiye, baaki sab hum dekh rahe hain. Have a great time! ☕✨`;

                if (CUSTOMER_BOT_TOKENS[0]) {
                    const tempBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
                    await tempBot.sendMessage(user.telegramChatId, comfortMessage, { parse_mode: 'Markdown' }).catch(() => {});
                }
            }
            debugLog('AutoGreeting', `Sent Hinglish comfort greeting to ${allUsers.length} users.`);
        } catch (err) {
            debugLog('AutoGreetingErr', err.message);
        }
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

async function createInstaPaymentLink(chatId, baseAmount, reaches) {
    return new Promise((resolve) => {
        let finalPayAmount = parseFloat(baseAmount);
        const postData = new URLSearchParams({
            purpose: `Recharge_${reaches}Reaches_${chatId}`,
            amount: finalPayAmount.toFixed(2),
            buyer_name: 'Customer',
            send_email: 'False',
            send_sms: 'False',
            redirect_url: `${serverPublicUrl}/?payment=success&telegramChatId=${chatId}&reaches=${reaches}`,
            webhook: `${serverPublicUrl}/instamojo-webhook`
        }).toString();

        const options = {
            hostname: 'www.instamojo.com',
            path: '/api/1.1/payment-requests/',
            method: 'POST',
            headers: {
                'X-Api-Key': INSTAMOJO_API_KEY,
                'X-Auth-Token': INSTAMOJO_AUTH_TOKEN,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const reqInsta = https.request(options, (response) => {
            let body = '';
            response.on('data', chunk => body += chunk);
            response.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (response.statusCode === 201 && json.success) {
                        resolve(json.payment_request.longurl);
                    } else {
                        resolve(null);
                    }
                } catch(e) { resolve(null); }
            });
        });
        reqInsta.write(postData);
        reqInsta.end();
    });
}

function startCustomerBot(token, isPrimary) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});

        bot.getMe().then(info => {
            if (isPrimary && !primaryCustomerBotUsername) {
                primaryCustomerBotUsername = info.username;
            }
        }).catch(() => {});

        bot.on('message', async (msg) => {
            if (!msg || !msg.chat || !msg.text) return;
            const chatId = String(msg.chat.id);
            if (chatId === ADMIN_CHAT_ID) return;

            const text = msg.text.trim();

            if (text.startsWith('/start')) {
                let user = await UserModel.findOne({ telegramChatId: chatId });
                if (!user) {
                    user = await UserModel.create({ telegramChatId: chatId, name: msg.from.first_name || 'User', reaches: 0 });
                    await notifyAdminDirect(`👤 **New User Registered via Bot**\n💬 Chat ID: \`${chatId}\`\n📌 Name: ${msg.from.first_name || 'User'}`);
                }

                const portalUrl = serverPublicUrl || "https://jpw-portal.onrender.com";
                const welcomeMessage = `✨ **Welcome to JPW Public Reach Service!** 🚀\n\n🆔 **Aapki Web Login ID / Chat ID:** \`${chatId}\`\n\n🔗 **Direct Mini App Portal Link:**\n${portalUrl}\n\n📝 **Order Format:** Order dene ke liye seedhe chat mein bhejein: \`TARGET_ID PASSWORD\` (Jaise: \`1234567890 mypass\`)`;

                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🚀 Open Mini App Portal", web_app: { url: portalUrl } }],
                            [{ text: "💎 Check Balance", callback_data: "check_balance" }, { text: "📦 Recharge Packages", callback_data: "view_packages" }]
                        ]
                    }
                };

                bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', ...keyboard });
                return;
            }

            const parts = text.split(' ');
            if (parts.length >= 2 && parts[0].length >= 8) {
                const targetId = parts[0];
                const targetPass = parts.slice(1).join(' ');

                let user = await UserModel.findOne({ telegramChatId: chatId });
                if (!user || user.reaches < 1) {
                    bot.sendMessage(chatId, `❌ **Insufficient Balance!** Order dene ke liye aapke paas kam se kam 1 Reach hona chahiye.`);
                    return;
                }

                user.reaches -= 1;
                await user.save();

                const newOrder = await OrderModel.create({ telegramChatId: chatId, targetId, targetPass });
                await notifyAdminAndUser(newOrder, user, `🌐 **New Bot Order (Pending)**\n💬 Chat ID: \`${chatId}\`\n🎯 ID: \`${targetId}\`\n🔑 Pass: \`${targetPass}\``);

                bot.sendMessage(chatId, `📦 **Order Successfully Submit Ho Gaya Hai!** 🚀\n\n🎯 Target ID: \`${targetId}\`\n📌 Status: *Pending ⏳*\n💎 Remaining Balance: *${user.reaches.toFixed(4)} Reaches*`);
                return;
            }
        });

        bot.on('callback_query', async (query) => {
            const chatId = String(query.message.chat.id);
            const data = query.data;
            let user = await UserModel.findOne({ telegramChatId: chatId });

            if (data === 'check_balance') {
                const bal = user ? user.reaches : 0;
                bot.answerCallbackQuery(query.id, { text: `Aapka Balance: ${bal.toFixed(4)} Reaches` });
                bot.sendMessage(chatId, `💎 **Aapka Current Balance:** *${bal.toFixed(4)} Reaches* ✨`, { parse_mode: 'Markdown' });
            } else if (data === 'view_packages') {
                let inlineRows = [];
                RECHARGE_PACKAGES.forEach(p => {
                    inlineRows.push([{ text: `💳 Buy ₹${p.amount} ➡️ ${p.reaches} Reaches`, callback_data: `buy_${p.amount}_${p.reaches}` }]);
                });
                bot.sendMessage(chatId, `📦 **Recharge Packages Select Karein:** 🔥`, {
                    reply_markup: { inline_keyboard: inlineRows }
                });
            } else if (data.startsWith('buy_')) {
                const [, amount, reaches] = data.split('_');
                bot.answerCallbackQuery(query.id, { text: 'Payment link generate ho raha hai...' });
                const payUrl = await createInstaPaymentLink(chatId, amount, reaches);
                if (payUrl) {
                    bot.sendMessage(chatId, `🔗 **Secure Payment ke liye neeche click karein:**\n\n[👉 ₹${amount} Pay Karein (${reaches} Reaches ke liye)](${payUrl})`, { parse_mode: 'Markdown' });
                } else {
                    bot.sendMessage(chatId, `❌ Payment link create karne mein error aagya.`);
                }
            }
        });
    } catch (e) {}
}

function startAdminBot(token) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});

        bot.on('message', async (msg) => {
            if (!msg || !msg.chat || !msg.text) return;
            const chatId = String(msg.chat.id);
            const text = msg.text.trim();

            if (text.startsWith('/start') && chatId === ADMIN_CHAT_ID) {
                bot.sendMessage(chatId, `👑 **JPW Admin Control Bot mein aapka swagat hai!**\n\n🎁 **Giveaway Split Command:**\nSabhi users mein reach equal split karne ke liye bhejein:\n\`/giveaway [total_reaches]\` (Jaise: \`/giveaway 2\` ya \`/giveaway 0.001\`)`, { parse_mode: 'Markdown' });
                return;
            }

            if (chatId !== ADMIN_CHAT_ID) return;

            // 🎁 Split Giveaway System
            if (text.startsWith('/giveaway ')) {
                const totalAmountStr = text.replace('/giveaway ', '').trim();
                const totalAmount = parseFloat(totalAmountStr);

                if (isNaN(totalAmount) || totalAmount <= 0) {
                    bot.sendMessage(chatId, `❌ Please valid amount enter karein! (Jaise: \`/giveaway 2\` )`);
                    return;
                }

                const allUsers = await UserModel.find({});
                if (allUsers.length === 0) {
                    bot.sendMessage(chatId, `⚠️ Database mein koi user available nahi hai!`);
                    return;
                }

                const splitAmount = totalAmount / allUsers.length;
                let successCount = 0;

                for (let u of allUsers) {
                    u.reaches += splitAmount;
                    await u.save();
                    successCount++;
                    try {
                        await bot.sendMessage(u.telegramChatId, `🎁 **Free Giveaway Split Alert!** 🎉\n\nAdmin dwara total \`${totalAmount} Reaches\` ko sabhi ${allUsers.length} users mein split kiya gaya hai.\nAapke hisse mein aaye hain: \`+${splitAmount.toFixed(6)} Reaches\`! 💎`, { parse_mode: 'Markdown' });
                    } catch(e) {}
                }

                bot.sendMessage(chatId, `✅ Total **${totalAmount} Reaches** successfully sabhi **${successCount} users** ke beech split kar diye gaye hain!\nHar user ko mila: \`${splitAmount.toFixed(6)} Reaches\` 🎁🔥`);
                return;
            }

            if (adminPendingReply[chatId]) {
                const orderId = adminPendingReply[chatId];
                delete adminPendingReply[chatId];

                let order = await OrderModel.findById(orderId);
                if (order) {
                    order.adminReply = text;
                    await order.save();

                    await notifyCustomerOnly(order, await UserModel.findOne({ telegramChatId: order.telegramChatId }), `💬 **Aapke order ke liye Admin ka message**\n🎯 Target ID: \`${order.targetId}\`\n\n📢 *${text}*`);
                    bot.sendMessage(chatId, `✅ Customer ko message successfully bhej diya gaya hai!`);
                } else {
                    bot.sendMessage(chatId, `❌ Order nahi mila!`);
                }
                return;
            }

            if (text.startsWith('/broadcast ')) {
                const broadcastMsg = text.replace('/broadcast ', '');
                const allUsers = await UserModel.find({});
                let count = 0;
                for (let u of allUsers) {
                    try {
                        await bot.sendMessage(u.telegramChatId, `📢 **Announcement:**\n\n${broadcastMsg}`, { parse_mode: 'Markdown' });
                        count++;
                    } catch(e) {}
                }
                bot.sendMessage(chatId, `✅ ${count} users ko broadcast successfully bhej diya gaya hai!`);
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
                bot.answerCallbackQuery(query.id, { text: 'Order nahi mila!' });
                return;
            }

            let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });
            let statusMsg = '';
            let customerEmojiMsg = '';

            if (action === 'reply') {
                adminPendingReply[chatId] = orderId;
                bot.answerCallbackQuery(query.id, { text: 'Apna message bhejein...' });
                bot.sendMessage(chatId, `✍️ **Order ID ke liye apna reply bhejein:** \`${order.targetId}\``, { parse_mode: 'Markdown' });
                return;
            } else if (action === 'accept') {
                order.status = 'Accepted';
                statusMsg = 'Accepted ✅';
                customerEmojiMsg = '🎉 **Great News! Aapka order ACCEPT kar liya gaya hai!** ✅';
            } else if (action === 'reject') {
                order.status = 'Rejected';
                statusMsg = 'Rejected ❌ (Reach Refunded)';
                if (user) { user.reaches += 1; await user.save(); }
                customerEmojiMsg = '❌ **Order Reject Ho Gaya**\nAapka Reach puri tarah se refund kar diya gaya hai! 🔄💎';
            } else if (action === 'inprogress') {
                order.status = 'In Progress';
                statusMsg = 'In Progress ⏳';
                customerEmojiMsg = '⏳ **Aapka order In Progress hai!** 🔄';
            } else if (action === 'complete') {
                order.status = 'Completed';
                statusMsg = 'Completed 🎉';
                customerEmojiMsg = '🎉 **Congratulations! Aapka order successfully complete ho gaya hai!** 🏆✨';
            } else if (action === 'cancel' && !order.status.includes('Refunded')) {
                order.status = 'Cancelled & Refunded';
                statusMsg = 'Cancelled ❌ (Reach Refunded)';
                if (user) { user.reaches += 1; await user.save(); }
                customerEmojiMsg = '🚫 **Order Cancel Ho Gaya & Reach Refund Ho Gaya** 🔄💎';
            }

            await order.save();
            bot.answerCallbackQuery(query.id, { text: `Status update ho gaya hai!` });

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
                    };
                    await bot.editMessageText(`📢 **Order Status: ${statusMsg}**\n🎯 Target ID: \`${order.targetId}\`\n🔑 Pass: \`${order.targetPass}\``, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: updatedKeyboard
                    });
                }
            } catch(e) {}

            await notifyCustomerOnly(order, user, `📢 **Order Status Update** 🌟\n\n🎯 **Target ID:** \`${order.targetId}\`\n\n${customerEmojiMsg}\n\n💎 Balance: *${user ? user.reaches.toFixed(4) : 0} Reaches*`);
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

app.post('/api/send-otp', async (req, res) => {
    try {
        let { telegramChatId } = req.body;
        if (!telegramChatId) return res.json({ success: false, message: 'Chat ID required hai' });

        telegramChatId = String(telegramChatId).trim();
        let user = await UserModel.findOne({ telegramChatId });
        
        if (!user) {
            return res.json({ success: false, message: 'User registered nahi hai! Pehle bot start karein.' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStorage[telegramChatId] = { otp, expires: Date.now() + 5 * 60 * 1000 };

        if (CUSTOMER_BOT_TOKENS[0]) {
            const tempBot = new TelegramBot(CUSTOMER_BOT_TOKENS[0], { polling: false });
            await tempBot.sendMessage(telegramChatId, `🔐 **Portal Login OTP:** \`${otp}\`\n\nYeh OTP sirf 5 minutes ke liye valid hai.`, { parse_mode: 'Markdown' });
        }

        res.json({ success: true, message: 'OTP bhej diya gaya hai!' });
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
            return res.json({ success: false, message: 'OTP expire ho gaya hai!' });
        }

        if (record.otp !== String(otp).trim()) {
            return res.json({ success: false, message: 'Galat OTP!' });
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
            user = await UserModel.create({ telegramChatId: String(telegramChatId), name: name || 'User', reaches: 0 });
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
            return res.json({ success: false, message: 'Galat password!' });
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

app.post('/api/admin/clear-database', async (req, res) => {
    try {
        const { pin } = req.body;
        if (pin !== '9999') {
            return res.json({ success: false, message: 'Galat security PIN!' });
        }
        await UserModel.deleteMany({});
        await OrderModel.deleteMany({});
        await UsedUtrModel.deleteMany({});
        res.json({ success: true, message: 'Server database successfully clear kar di gayi hai!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/packages', (req, res) => {
    res.json({ success: true, packages: RECHARGE_PACKAGES });
});

app.post('/api/pay', async (req, res) => {
    try {
        const { telegramChatId, amount, reaches } = req.body;
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const serverUrl = `${protocol}://${req.get('host')}`;

        let finalPayAmount = parseFloat(amount);

        const postData = new URLSearchParams({
            purpose: `Recharge_${reaches}Reaches_${telegramChatId}`,
            amount: finalPayAmount.toFixed(2),
            buyer_name: 'Customer',
            send_email: 'False',
            send_sms: 'False',
            redirect_url: `${serverUrl}/?payment=success&telegramChatId=${telegramChatId}&reaches=${reaches}`,
            webhook: `${serverUrl}/instamojo-webhook`
        }).toString();

        const options = {
            hostname: 'www.instamojo.com',
            path: '/api/1.1/payment-requests/',
            method: 'POST',
            headers: {
                'X-Api-Key': INSTAMOJO_API_KEY,
                'X-Auth-Token': INSTAMOJO_AUTH_TOKEN,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const reqInsta = https.request(options, (response) => {
            let body = '';
            response.on('data', chunk => body += chunk);
            response.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (response.statusCode === 201 && json.success) {
                        res.json({ success: true, paymentUrl: json.payment_request.longurl });
                    } else {
                        res.json({ success: false, message: json.message || 'Payment fail ho gaya' });
                    }
                } catch(e) { res.status(500).json({ success: false, message: 'JSON Parse Error' }); }
            });
        });
        reqInsta.write(postData);
        reqInsta.end();
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/verify-instant', async (req, res) => {
    try {
        const { telegramChatId, reaches } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (user) {
            user.reaches += parseFloat(reaches);
            await user.save();
            res.json({ success: true, user });
        } else {
            res.json({ success: false, message: 'User nahi mila' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/order', async (req, res) => {
    try {
        const { telegramChatId, targetId, targetPass } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });

        if (!user || user.reaches < 1) {
            return res.json({ success: false, message: 'Insufficient balance! Kam se kam 1 Reach required hai.' });
        }

        user.reaches -= 1;
        await user.save();

        const newOrder = await OrderModel.create({ telegramChatId: String(telegramChatId), targetId, targetPass });
        await notifyAdminAndUser(newOrder, user, `🌐 **New Website Order (Pending)**\n💬 Chat ID: \`${telegramChatId}\`\n🎯 ID: \`${targetId}\`\n🔑 Pass: \`${targetPass}\``);

        await notifyCustomerOnly(newOrder, user, `📦 **Order Successfully Place Ho Gaya!** 🚀✨\n\n🎯 **Target ID:** \`${targetId}\`\n📌 **Status:** *Pending ⏳*\n\n💎 Remaining Balance: *${user.reaches.toFixed(4)} Reaches*`);

        res.json({ success: true, message: 'Order successfully submit ho gaya!', remainingReaches: user.reaches });
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
        if (!user) return res.json({ success: false, message: 'User nahi mila' });

        const amount = parseFloat(count) || 0;
        if (action === 'add') {
            user.reaches += amount;
        } else if (action === 'deduct') {
            user.reaches = Math.max(0, user.reaches - amount);
        }
        await user.save();
        res.json({ success: true, message: `Reaches update ho gaye! New Balance: ${user.reaches.toFixed(4)}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/order-action', async (req, res) => {
    try {
        const { orderId, action } = req.body;
        let order = await OrderModel.findById(orderId);
        if (!order) return res.json({ success: false, message: 'Order nahi mila' });

        let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });
        let statusMsg = '';

        if (action === 'accept') {
            order.status = 'Accepted';
            statusMsg = 'Accepted ✅';
        } else if (action === 'reject') {
            order.status = 'Rejected';
            statusMsg = 'Rejected ❌ (Reach Refunded)';
            if (user) { user.reaches += 1; await user.save(); }
        } else if (action === 'inprogress') {
            order.status = 'In Progress';
            statusMsg = 'In Progress ⏳';
        } else if (action === 'complete') {
            order.status = 'Completed';
            statusMsg = 'Completed 🎉';
        } else if (action === 'cancel' && !order.status.includes('Refunded')) {
            order.status = 'Cancelled & Refunded';
            statusMsg = 'Cancelled ❌ (Reach Refunded)';
            if (user) { user.reaches += 1; await user.save(); }
        }

        await order.save();
        await notifyAdminAndUser(order, user, `📢 **Order Status Update**\n🎯 Target ID: \`${order.targetId}\`\n📌 Status: *${statusMsg}*`);

        res.json({ success: true, message: `Order status update ho gaya: ${order.status}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/delete-user', async (req, res) => {
    try {
        const { userId } = req.body;
        await UserModel.findByIdAndDelete(userId);
        res.json({ success: true, message: 'Customer delete kar diya gaya!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/instamojo-webhook', async (req, res) => {
    try {
        const paymentData = req.body;
        const status = paymentData.status;
        const purpose = paymentData.purpose || '';
        const paymentId = paymentData.payment_id;

        res.status(200).send('Webhook Received');

        if ((status === 'Credit' || status === 'Completed') && purpose.includes('Recharge_')) {
            const parts = purpose.split('_');
            if (parts.length >= 3) {
                const reachesToAdd = parseFloat(parts[1]);
                const telegramChatId = parts[2];

                const existingUtrDoc = await UsedUtrModel.findOne({ utrId: paymentId });
                if (!existingUtrDoc && !isNaN(reachesToAdd)) {
                    await UsedUtrModel.create({ utrId: paymentId });
                    let user = await UserModel.findOne({ telegramChatId });
                    if (user) {
                        user.reaches += reachesToAdd;
                        await user.save();
                        await notifyCustomerOnly(null, user, `💳 **Payment Successful!** 🎉✨\n\n✨ Add ho gaya: \`+${reachesToAdd} Reaches\` 🚀\n💰 **New Total Balance:** \`${user.reaches.toFixed(4)} Reaches\` 💎`);
                    }
                }
            }
        }
    } catch (err) {}
});

const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
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
    serverPublicUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    debugLog('Server', `🚀 System live on port ${PORT}`);
});
