// 👑 Admin Bot Full Command & Button Menu
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
                const adminKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "📊 View All Stats & Users", callback_data: "admin_stats" },
                                { text: "📢 Broadcast Message", callback_data: "admin_broadcast_prompt" }
                            ],
                            [
                                { text: "⚡ Pending Reach Orders", callback_data: "admin_reach_orders" },
                                { text: "📌 Pending SR Orders", callback_data: "admin_sr_orders" }
                            ],
                            [
                                { text: "🌐 Open Admin Web Panel", url: (serverPublicUrl || "https://cashtree.space") + "/admin" }
                            ]
                        ]
                    }
                };
                bot.sendMessage(chatId, `👑 **JPW Super Admin Control Panel** 🚀\n\nWelcome back, Boss! Choose an option below to manage your system:`, { parse_mode: 'Markdown', ...adminKeyboard });
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
                        await tempCustBot.sendMessage(srOrder.telegramChatId, `💬 **Admin SR Update (${srOrder.customerName}):**\n\n📢 *${text}*`, { parse_mode: 'Markdown' }).catch(()=>{});
                    }
                    bot.sendMessage(chatId, `✅ SR Reply sent successfully!`);
                }
                return;
            }
        });

        bot.on('callback_query', async (query) => {
            const chatId = String(query.message.chat.id);
            if (chatId !== ADMIN_CHAT_ID) return;
            const data = query.data;

            if (data === 'admin_stats') {
                bot.answerCallbackQuery(query.id);
                let userCount = await UserModel.countDocuments();
                let reachCount = await OrderModel.countDocuments();
                let srCount = await SrModel.countDocuments();
                bot.sendMessage(chatId, `📊 **System Statistics:**\n\n👤 Total Engineers/Users: *${userCount}*\n⚡ Reach Orders: *${reachCount}*\n📌 SR Orders: *${srCount}*`, { parse_mode: 'Markdown' });
            } else if (data === 'admin_reach_orders') {
                bot.answerCallbackQuery(query.id);
                let pending = await OrderModel.find({ status: 'Pending' }).limit(5);
                if(pending.length === 0) { bot.sendMessage(chatId, "✅ No pending Reach orders!"); return; }
                pending.forEach(o => {
                    bot.sendMessage(chatId, `⚡ Reach Order\nID: \`${o.targetId}\`\nChatID: \`${o.telegramChatId}\``, {
                        reply_markup: { inline_keyboard: [[{ text: "✅ Accept", callback_data: `accept_${o._id}` }, { text: "❌ Reject", callback_data: `reject_${o._id}` }]] }
                    });
                });
            } else if (data === 'admin_sr_orders') {
                bot.answerCallbackQuery(query.id);
                let pendingSr = await SrModel.find({ status: 'Pending' }).limit(5);
                if(pendingSr.length === 0) { bot.sendMessage(chatId, "✅ No pending SR orders!"); return; }
                pendingSr.forEach(s => {
                    bot.sendMessage(chatId, `📌 SR Order\nCustomer: ${s.customerName}\nMobile: \`${s.mobileNumber}\``, {
                        reply_markup: { inline_keyboard: [[{ text: "✅ Accept", callback_data: `sraccept_${s._id}` }, { text: "❌ Reject", callback_data: `srreject_${s._id}` }]] }
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
                    bot.sendMessage(chatId, `✍️ Send reply for SR (${srOrder.customerName}):`);
                    return;
                } else if (action === 'sraccept') { srOrder.status = 'Accepted'; }
                else if (action === 'srreject') { srOrder.status = 'Rejected'; if(user){user.jpwCoins+=1;await user.save();} }
                else if (action === 'srinprog') { srOrder.status = 'In Progress'; }
                else if (action === 'srcomp') { srOrder.status = 'Completed'; }

                await srOrder.save();
                bot.answerCallbackQuery(query.id, { text: 'Updated!' });
                bot.sendMessage(chatId, `✅ SR Status updated to: *${srOrder.status}*`, { parse_mode: 'Markdown' });
            } else if (data.includes('_') && !data.startsWith('admin')) {
                const [action, orderId] = data.split('_');
                let order = await OrderModel.findById(orderId);
                if (!order) { bot.answerCallbackQuery(query.id, { text: 'Not found!' }); return; }
                let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });

                if (action === 'reply') {
                    adminPendingReply[chatId] = orderId;
                    bot.answerCallbackQuery(query.id);
                    bot.sendMessage(chatId, `✍️ Send reply for Reach Order ID: \`${order.targetId}\``);
                    return;
                } else if (action === 'accept') { order.status = 'Accepted'; }
                else if (action === 'reject') { order.status = 'Rejected'; if(user){user.jpwCoins+=1;await user.save();} }
                else if (action === 'inprogress') { order.status = 'In Progress'; }
                else if (action === 'complete') { order.status = 'Completed'; }
                else if (action === 'cancel') { order.status = 'Cancelled & Refunded'; if(user){user.jpwCoins+=1;await user.save();} }

                await order.save();
                bot.answerCallbackQuery(query.id, { text: 'Updated!' });
                bot.sendMessage(chatId, `✅ Reach Order Status updated to: *${order.status}*`, { parse_mode: 'Markdown' });
            }
        });
    } catch(e) {}
}

// 🤖 Customer Bot 10+ Options Menu
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
            const portalUrl = serverPublicUrl || "https://cashtree.space";

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
            const portalUrl = serverPublicUrl || "https://cashtree.space";
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

// 🎁 FIX: Missing Backend APIs for Daily Bonus & Coin Transfer in Mini App
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

        const randomBonus = parseFloat((Math.random() * 0.5 + 0.1).toFixed(2)); // 0.1 to 0.6 coins
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
