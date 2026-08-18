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
let primaryCustomerBotUsername = 'JPWREACHSERVICESBOT';
let serverPublicUrl = 'https://cashtree.space';

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
            await tempBot.sendMessage(ADMIN_CHAT_ID, `📌 **New SR Order Received**\n\n👤 Customer Name: ${srOrder.customerName}\n📞 Mobile: \`${srOrder.mobileNumber}\`\n☎️ Landline: \`${srOrder.landlineNumber}\`\n💬 Engineer Chat ID: \`${srOrder.telegramChatId}\``, { parse_mode: 'Markdown', ...keyboard });
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
                                { text: "✏️ Edit Order", callback_data: "admin_edit_order" }
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

            // 📢 Announcement Handler
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

            // ✏️ Edit Order Search Handler (Target ID or SR Mobile Number)
            if (adminPendingEditSearch) {
                adminPendingEditSearch = false;
                const searchId = text;

                // Search in Reach Orders
                let order = await OrderModel.findOne({ targetId: searchId }).sort({ createdAt: -1 });
                if (order) {
                    const orderKeyboard = {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "🔄 Change Status", callback_data: `editstatus_reach_${order._id}` },
                                    { text: "💬 Send Reply", callback_data: `editreply_reach_${order._id}` }
                                ]
                            ]
                        }
                    };
                    bot.sendMessage(chatId, `⚡ **Reach Order Found:**\n\n🎯 Target ID: \`${order.targetId}\`\n🔑 Password: \`${order.targetPass}\`\n📌 Current Status: *${order.status}*\n💬 Chat ID: \`${order.telegramChatId}\`\n\n👇 **Kya karna chahte hain?**`, { parse_mode: 'Markdown', ...orderKeyboard });
                    return;
                }

                // Search in SR Orders
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
                                ]
                            ]
                        }
                    };
                    bot.sendMessage(chatId, `📌 **SR Order Found:**\n\n👤 Customer: *${srOrder.customerName}*\n📞 Mobile: \`${srOrder.mobileNumber}\`\n☎️ Landline: \`${srOrder.landlineNumber || 'N/A'}\`\n📌 Current Status: *${srOrder.status}*\n💬 Chat ID: \`${srOrder.telegramChatId}\`\n\n👇 **Kya karna chahte hain?**`, { parse_mode: 'Markdown', ...srKeyboard });
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

            // ✏️ Edit Order Triggers
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
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(()=>{});
                    bot.sendMessage(chatId, `❌ SR Status updated to: *Rejected* (Coin refunded to Engineer)`, { parse_mode: 'Markdown' });
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
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(()=>{});
                    bot.sendMessage(chatId, `🎉 SR Status updated to: *Completed*`, { parse_mode: 'Markdown' });
                    return;
                }
            } else if (data.includes('_') && !data.startsWith('admin') && !data.startsWith('edit') && !data.startsWith('setst')) {
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
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(()=>{});
                    bot.sendMessage(chatId, `❌ Reach Order Status: *Rejected* (Coin Refunded)`, { parse_mode: 'Markdown' });
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
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(()=>{});
                    bot.sendMessage(chatId, `🎉 Reach Order Status: *Completed*`, { parse_mode: 'Markdown' });
                    return;
                } else if (action === 'cancel') {
                    order.status = 'Cancelled & Refunded';
                    if(user){ user.jpwCoins += 1; await user.save(); }
                    await order.save();
                    bot.answerCallbackQuery(query.id, { text: 'Cancelled & Refunded!' });
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(()=>{});
                    bot.sendMessage(chatId, `🚫 Reach Order Status: *Cancelled & Refunded*`, { parse_mode: 'Markdown' });
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

// Admin Panel HTML Route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Mobile Web App HTML Route (Added for /app)
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mobile_app.html'));
});

// --- NEW ADD-ON APIs FOR MOBILE APP ID/PASSWORD LOGIN & STATUS TRACKING ---
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
// ------------------------------------------------------------------------

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
