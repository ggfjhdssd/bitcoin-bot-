require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');

// --- Render Keep-Alive Server ---
// Render က Port ဖွင့်မထားရင် Error တက်တတ်လို့ Express Server ထည့်ထားခြင်းဖြစ်သည်
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bitcoin Bot is Online!'));
app.listen(port, () => console.log(`✅ Keep-Alive server running on port ${port}`));

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = String(process.env.ADMIN_ID).trim();
const LOG_GROUP_ID = process.env.LOG_GROUP_ID;

// --- Database Connection ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Database Connected Successfully!"))
    .catch(err => { console.error("❌ DB Connection Error:", err.message); process.exit(1); });

// --- Database Schema ---
const userSchema = new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    balance: { type: Number, default: 0 },
    referredBy: { type: Number, default: null },
    referralCount: { type: Number, default: 0 },
    wallet: { type: String, default: "⛔ မသတ်မှတ်ရသေးပါ" },
    lastBonus: { type: Date, default: null },
    isBanned: { type: Boolean, default: false },
    state: { type: String, default: 'none' },
    tempData: { type: Object, default: {} }
});
const User = mongoose.model('User', userSchema);

const CHANNELS = ['@BitCoinMyannmar', '@BitCoinMyan'];

// --- Helpers ---
async function isJoined(ctx) {
    for (const ch of CHANNELS) {
        try {
            const member = await ctx.telegram.getChatMember(ch, ctx.from.id);
            if (['left', 'kicked'].includes(member.status)) return false;
        } catch (e) { return false; }
    }
    return true;
}

const isAdmin = (ctx) => String(ctx.from.id) === ADMIN_ID;

// --- GLOBAL ERROR HANDLER ---
// Bot တစ်ခုလုံး Crash မဖြစ်အောင် တားပေးသည်
bot.catch((err, ctx) => {
    console.error(`🔴 Global Telegram Error for ${ctx.updateType}:`, err.message || err);
});

// --- Keyboards ---
const mainMenu = Markup.keyboard([
    ['💰 လက်ကျန်ငွေ', '👫 ဖိတ်ခေါ်ရန်'],
    ['🗂 Wallet', '🎁 Bonus'],
    ['📤 ငွေထုတ်ယူရန်']
]).resize();

// --- Start Command ---
bot.start(async (ctx) => {
    try {
        let user = await User.findOne({ tgId: ctx.from.id });
        const refId = parseInt(ctx.payload);

        if (!user) {
            user = new User({ tgId: ctx.from.id, username: ctx.from.first_name || 'User' });
            if (refId && refId !== ctx.from.id) user.referredBy = refId;
            await user.save();
        }

        if (user.isBanned) return ctx.reply("🚫 သင်သည် စည်းကမ်းဖောက်ဖျက်မှုကြောင့် အသုံးပြုခွင့် ပိတ်ပင်ခံထားရပါသည်။").catch(() => {});

        const msg = `👋 မင်္ဂလာပါ ${ctx.from.first_name}\n\nBOT ကိုသုံးပြီးငွေရှာချင်တယ် မိတ်ဆွေ\nအောက်က Channel နှစ်ခုကို မJoin ထားရင် \nငွေထုတ်ရမည်မဟုတ်ပါ❌\n\nBot ကို အသုံးပြုဖို့အတွက် အောက်ပါ Channel ၂ခုကို join လုပ်ပါ👇\n\n1️⃣ @BitCoinMyannmar\n2️⃣ @BitCoinMyan\n\nJoin ပြီးရင် ✅ Joined ဆိုတဲ့ခလုတ်ကိုနှိပ်ပါ။`;

        await ctx.reply(msg, Markup.inlineKeyboard([
            [Markup.button.url('📲 Channel 1 ကို Join ပါ', 'https://t.me/BitCoinMyannmar')],
            [Markup.button.url('📲 Channel 2 ကို Join ပါ', 'https://t.me/BitCoinMyan')],
            [Markup.button.callback('✅ Joined', 'check_join')]
        ])).catch(() => {});
    } catch (e) { console.error(e.message); }
});

// --- Check Join Action ---
bot.action('check_join', async (ctx) => {
    try {
        if (await isJoined(ctx)) {
            const user = await User.findOne({ tgId: ctx.from.id });
            if (user && user.referredBy) {
                const refUser = await User.findOne({ tgId: user.referredBy });
                if (refUser) {
                    refUser.balance += 5000;
                    refUser.referralCount += 1;
                    await refUser.save();
                    bot.telegram.sendMessage(refUser.tgId, `🎉 ဂုဏ်ယူပါတယ်! လူသစ်တစ်ယောက်ဖိတ်ခေါ်မှုအောင်မြင်ပြီး 5000 ကျပ် ရရှိပါသည်!`).catch(() => {});
                }
                user.referredBy = null;
                await user.save();
            }
            await ctx.deleteMessage().catch(() => {}); // Message ဖျက်မရလျှင် ကျော်သွားမည်
            await ctx.reply("🏡 မင်္ဂလာပါ! Main Menu မှာ ရွေးချယ်ပါ ✨", mainMenu).catch(() => {});
        } else {
            await ctx.answerCbQuery("⚠️ Channel (၂) ခုလုံးကို Join ရပါမည်!", { show_alert: true }).catch(() => {});
        }
    } catch (e) { console.error(e.message); }
});

// --- Main Menu Buttons ---
bot.hears('💰 လက်ကျန်ငွေ', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (user) ctx.reply(`🙌🏻 အသုံးပြုသူ = ${user.username}\n💰 လက်ကျန်ငွေ = ${user.balance.toLocaleString()} ကျပ်\n\n🪢 ပိုပြီး ရနိုင်ရန် မိတ်ဆွေ ဖိတ်ပါ ✨`).catch(() => {});
    } catch (e) { console.error(e.message); }
});

bot.hears('👫 ဖိတ်ခေါ်ရန်', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        const botMe = await bot.telegram.getMe();
        const refLink = `https://t.me/${botMe.username}?start=${ctx.from.id}`;
        const shareText = `Bitcoin Bot !🔥\n\n🎁လူ 1 ယောက်ခေါ် → +5000ကျပ်\nငါ့ရဲ့ Invite Link က ${refLink}`;

        ctx.reply(`🙌🏻 သင့်စုစုပေါင်း ဖိတ်ခေါ်ထားသူ = ${user.referralCount}\n🔗 Link = ${refLink}`, Markup.inlineKeyboard([
            [Markup.button.callback('👥 ဖိတ်ခေါ်ထားသောသူများ', 'my_refs')],
            [Markup.button.callback('🏆 Top List', 'top_list')],
            [Markup.button.switchToChat('🚀 Share Link', shareText)]
        ])).catch(() => {});
    } catch (e) { console.error(e.message); }
});

// --- Wallet & Bonus ---
bot.hears('🗂 Wallet', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        ctx.reply(`💡 သင့် Wallet: ${user.wallet}`, Markup.inlineKeyboard([[Markup.button.callback('💠 ပြင်ဆင်ပါ', 'set_wallet')]]));
    } catch (e) { console.error(e.message); }
});

bot.hears('🎁 Bonus', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        const now = new Date();
        if (user.lastBonus && (now - user.lastBonus < 86400000)) {
            return ctx.reply("⏳ 24 နာရီ မပြည့်သေးပါ။");
        }
        const bonus = Math.floor(Math.random() * 5000) + 500;
        user.balance += bonus;
        user.lastBonus = now;
        await user.save();
        ctx.reply(`🎉 သင် ${bonus} ကျပ် ရရှိပါသည်!`);
    } catch (e) { console.error(e.message); }
});

// --- Withdrawal ---
bot.hears('📤 ငွေထုတ်ယူရန်', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (user.balance < 100000) return ctx.reply("⚠ အနည်းဆုံး 100,000 ကျပ် ရှိရပါမည်။");
        user.state = 'withdraw_phone';
        await user.save();
        ctx.reply("📱 Kpay/Wave ဖုန်းနံပါတ် ပို့ပေးပါ 👇");
    } catch (e) { console.error(e.message); }
});

// --- Admin Panel Commands ---
bot.command('panel', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const total = await User.countDocuments();
    ctx.reply(`👑 <b>Admin Panel</b>\n📊 Total: ${total}\n\n/users, /info [ID], /add [ID] [Amt], /broadcast [Msg]`, { parse_mode: 'HTML' });
});

bot.command('users', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const users = await User.find().limit(10);
    let list = "👥 <b>Users:</b>\n";
    users.forEach(u => list += `• ${u.username} (<code>${u.tgId}</code>) - ${u.balance}\n`);
    ctx.reply(list, { parse_mode: 'HTML' });
});

bot.command('add', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const args = ctx.message.text.split(' ');
    await User.updateOne({ tgId: args[1] }, { $inc: { balance: parseInt(args[2]) } });
    ctx.reply("✅ Added.");
});

bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const msg = ctx.message.text.split('/broadcast ')[1];
    const users = await User.find();
    for (const u of users) { try { await bot.telegram.sendMessage(u.tgId, msg); } catch (e) {} }
    ctx.reply("✅ Done.");
});

// --- Message Handler (State Management) ---
bot.on('message', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;

        if (user.state === 'wait_wallet') {
            user.wallet = ctx.message.text;
            user.state = 'none';
            await user.save();
            return ctx.reply("✅ Wallet သတ်မှတ်ပြီးပါပြီ။");
        }

        if (user.state === 'withdraw_phone') {
            user.tempData = { phone: ctx.message.text };
            user.state = 'withdraw_name';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("👤 အကောင့်နာမည် ပို့ပေးပါ 👇");
        }

        if (user.state === 'withdraw_name') {
            user.tempData = { ...user.tempData, name: ctx.message.text };
            user.state = 'withdraw_amount';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("💵 ပမာဏ ပို့ပေးပါ 👇");
        }

        if (user.state === 'withdraw_amount') {
            const amt = parseInt(ctx.message.text);
            if (isNaN(amt) || amt > user.balance) return ctx.reply("❌ ပမာဏ မှားနေပါသည်။");
            user.tempData = { ...user.tempData, amt: amt };
            user.state = 'withdraw_nrc_front';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("📸 မှတ်ပုံတင် 'အရှေ့' ပုံပို့ပါ 👇");
        }

        if (user.state === 'withdraw_nrc_front' && ctx.message.photo) {
            user.tempData = { ...user.tempData, front: ctx.message.photo[ctx.message.photo.length-1].file_id };
            user.state = 'withdraw_nrc_back';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("📸 မှတ်ပုံတင် 'အနောက်' ပုံပို့ပါ 👇");
        }

        if (user.state === 'withdraw_nrc_back' && ctx.message.photo) {
            const backId = ctx.message.photo[ctx.message.photo.length-1].file_id;
            const data = user.tempData;
            user.balance -= data.amt;
            user.state = 'none';
            user.tempData = {};
            await user.save();

            ctx.reply("✅ ငွေထုတ်ယူမှု Admin ထံ ပို့ပြီးပါပြီ။");
            const adminMsg = `🚨 <b>Withdraw Request</b>\n🆔 ID: ${user.tgId}\n📞 Phone: ${data.phone}\n💵 Amt: ${data.amt}`;
            bot.telegram.sendMessage(LOG_GROUP_ID, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
            bot.telegram.sendPhoto(LOG_GROUP_ID, data.front).catch(() => {});
            bot.telegram.sendPhoto(LOG_GROUP_ID, backId).catch(() => {});
        }
    } catch (e) { console.error(e.message); }
});

bot.action('set_wallet', async (ctx) => {
    await User.updateOne({ tgId: ctx.from.id }, { state: 'wait_wallet' });
    ctx.reply("✏️ Wallet နံပါတ် ပို့ပေးပါ:");
});

bot.launch().then(() => console.log("🚀 Bot is LIVE!"));

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
