require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const path = require('path');

// --- 1. Render Port Binding & Mini App Server ---
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname)); // index.html က bot.js နဲ့ ဘေးချင်းယှဉ်ရှိရပါမယ်

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 2. Bot Initialization ---
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = String(process.env.ADMIN_ID).trim();
const LOG_GROUP_ID = process.env.LOG_GROUP_ID;

// --- 3. Database Connection ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Database Connected!"))
    .catch(err => { 
        console.log("❌ DB Error:", err); 
        process.exit(1); 
    });

// --- 4. Database Schema ---
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

// --- 5. Reward API for Mini App ---
app.post('/reward-user', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).send('User ID required');
        const user = await User.findOne({ tgId: userId });
        if (user) {
            user.balance += 500;
            await user.save();
            try {
                await bot.telegram.sendMessage(userId, "💰 ကြော်ငြာကြည့်ရှုမှုအတွက် ၅၀၀ ကျပ် လက်ခံရရှိပါတယ်!");
            } catch (e) {}
            return res.json({ success: true, newBalance: user.balance });
        }
        res.status(404).send('User not found');
    } catch (error) {
        res.status(500).send('Internal Error');
    }
});

app.listen(port, () => console.log(`✅ Server is listening on port ${port}`));

const CHANNELS = ['@BitCoinMyannmar', '@BitCoinMyan'];

// --- 6. Helpers ---
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

// Global Error Handler
bot.catch((err, ctx) => {
    console.error(`⚠️ Telegram Error (${ctx.updateType}): ${err.message}`);
});

// --- 7. Keyboards ---
const mainMenu = Markup.keyboard([
    ['💰 လက်ကျန်ငွေ', '👫 ဖိတ်ခေါ်ရန်'],
    [Markup.button.webApp('💸 ကြော်ငြာကြည့်ပြီးငွေရှာရန်', 'https://bitcoin-bot-2zmf.onrender.com')],
    ['🗂 Wallet', '🎁 Bonus'],
    ['📤 ငွေထုတ်ယူရန်']
]).resize();

// --- 8. Start Command ---
bot.start(async (ctx) => {
    try {
        let user = await User.findOne({ tgId: ctx.from.id });
        const payload = ctx.payload;
        const refId = payload ? parseInt(payload) : null;

        if (!user) {
            user = new User({ 
                tgId: ctx.from.id, 
                username: ctx.from.first_name || 'User' 
            });
            if (refId && refId !== ctx.from.id) user.referredBy = refId;
            await user.save();
        }

        if (user.isBanned) return ctx.reply("🚫 သင်သည် စည်းကမ်းဖောက်ဖျက်မှုကြောင့် အသုံးပြုခွင့် ပိတ်ပင်ခံထားရပါသည်။").catch(()=>{});

        const msg = `👋 မင်္ဂလာပါ ${ctx.from.first_name}\n\nBOT ကိုသုံးပြီးငွေရှာချင်တယ် မိတ်ဆွေ\nအောက်က Channel နှစ်ခုကို မJoin ထားရင် \nငွေထုတ်ရမည်မဟုတ်ပါ❌\n\nBot ကို အသုံးပြုဖို့အတွက် အောက်ပါ Channel ၂ခုကို join လုပ်ပါ👇\n\n1️⃣ @BitCoinMyannmar\n2️⃣ @BitCoinMyan\n\nJoin ပြီးရင် ✅ Joined ဆိုတဲ့ခလုတ်ကိုနှိပ်ပါ။\n\n🟡 Bitcoin ငွေရှာ BOT အသစ် 🟡🔋\nနေ့စဉ်ငွေရပြီး ငွေတန်းထုတ်နိုင်တယ်! 💯\nမြန်မာနိုင်ငံတရားဝင် Bitcoin Bot !\n\n🔥🎁 လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁 လူ 10 ယောက်ခေါ် → +50000ကျပ်\n\n🔥 Start လုပ်ပြီးရင် Menu မှာ 👇\n👫 ဖိတ်ခေါ်ရန် 👈 ကိုနှိပ်ပါ\nBot ပေးတဲ့ Link ကို သူငယ်ချင်းအခြား GP မှာတင်ပြီး ငွေရှာမယ်💸💰`;

        await ctx.reply(msg, Markup.inlineKeyboard([
            [Markup.button.url('📲 Channel 1 ကို Join ပါ', 'https://t.me/BitCoinMyannmar')],
            [Markup.button.url('📲 Channel 2 ကို Join ပါ', 'https://t.me/BitCoinMyan')],
            [Markup.button.callback('✅ Joined', 'check_join')]
        ])).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.action('check_join', async (ctx) => {
    try {
        if (await isJoined(ctx)) {
            const user = await User.findOne({ tgId: ctx.from.id });
            if (user && user.referredBy) {
                const refUser = await User.findOne({ tgId: user.referredBy });
                if (refUser) {
                    await User.updateOne({ tgId: user.referredBy }, { $inc: { balance: 5000, referralCount: 1 } });
                    try { await bot.telegram.sendMessage(refUser.tgId, `🎉 ဂုဏ်ယူပါတယ်! လူသစ်တစ်ယောက်ဖိတ်ခေါ်မှုအောင်မြင်ပြီး 5000 ကျပ် ရရှိပါသည်!`); } catch (err) {}
                }
                user.referredBy = null;
                await user.save();
            }
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply("🏡 မင်္ဂလာပါ! Main Menu မှာ ရွေးချယ်ပါ ✨", mainMenu).catch(()=>{});
        } else {
            await ctx.answerCbQuery("⚠️ Channel (၂) ခုလုံးကို Join ရပါမည်!", { show_alert: true }).catch(()=>{});
        }
    } catch (e) { console.error(e); }
});

// --- 9. Main Menu Buttons ---
bot.hears('💰 လက်ကျန်ငွေ', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    if (user) ctx.reply(`🙌🏻 အသုံးပြုသူ = ${user.username}\n💰 လက်ကျန်ငွေ = ${user.balance.toLocaleString()} ကျပ်\n\n🪢 ပိုပြီး ရနိုင်ရန် မိတ်ဆွေ ဖိတ်ပါ ✨`).catch(()=>{});
});

bot.hears('👫 ဖိတ်ခေါ်ရန်', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    const botMe = await bot.telegram.getMe();
    const refLink = `https://t.me/${botMe.username}?start=${ctx.from.id}`;
    const shareText = `@bitcoinminingmyanmar_bot Bitcoin Bot !🔥\n\n🎁လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁လူ 10 ယောက်ခေါ် → +50000ကျပ် 🔥\n\nငါ့ရဲ့ Invite Link က ${refLink} ဖြစ်ပါတယ်`;

    const msg = `🙌🏻 သင့်စုစုပေါင်း ဖိတ်ခေါ်ထားသူ = ${user.referralCount} User(s)\n🙌🏻 သင့်ဖိတ်ခေါ်ရန် Link = ${refLink}\n\n🪢 ဖိတ်ခေါ်ပြီး 5000 ကျပ် ရယူနိုင်ပါသည်\n\n🟡 Bitcoin ငွေရှာ BOT အသစ် 🟡\n🔋 နေ့စဉ်ငွေရပြီး ငွေတန်းထုတ်နိုင်တယ်! 💯 မြန်မာနိုင်ငံတရားဝင် Bitcoin Bot !🔥\n\n🎁လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁လူ 10 ယောက်ခေါ် → +50000ကျပ်\n\n🔥သူငယ်ချင်းတွေရဲ့ ဝယ်ယူမှုတိုင်းအတွက် ကော်မရှင် 80% အထိရ\n✅သင့် Wave/KPay ဆီသို့ ငွေတန်းထုတ်နိုင်တယ်\n\n🎯 ငါ့လင့်ကနေ ဝင်ပြီး ဘောနပ် 5000ကျပ် ယူလိုက်ပါ`;

    await ctx.reply(msg, Markup.inlineKeyboard([
        [Markup.button.callback('👥 ဖိတ်ခေါ်ထားသောသူများ', 'my_refs')],
        [Markup.button.callback('🏆 Top List', 'top_list')],
        [Markup.button.switchToChat('🚀 Bot Link ကို Share ပါ', shareText)]
    ])).catch(()=>{});
});

bot.action('my_refs', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    await ctx.reply(`👤 သင့်မှာ ဖိတ်ခေါ်ထားသူ ${user.referralCount} ဦး ရှိပါသည်။`).catch(()=>{});
    await ctx.answerCbQuery();
});

bot.action('top_list', async (ctx) => {
    const topUsers = await User.find().sort({ referralCount: -1 }).limit(10);
    let text = "🔥 <b>အကောင်းဆုံး Referral Users List</b> 🔥\n\n";
    topUsers.forEach((u, i) => { text += `${i + 1}. ${u.username || 'User'} : 👨 ${u.referralCount} ယောက်\n`; });
    await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.callback('🔙 နောက်သို့', 'back_to_menu')]) }).catch(()=>{});
    await ctx.answerCbQuery();
});

bot.hears('🗂 Wallet', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    await ctx.reply(`💡 သင့်လက်ရှိ Wallet နံပါတ်: ${user.wallet}\n\n💠 Wallet သတ်မှတ် / ပြင်ဆင် 💠 နှိပ်ပါ`, Markup.inlineKeyboard([[Markup.button.callback('💠 Wallet ပြင်ဆင်ပါ', 'set_wallet')]]));
});

bot.action('set_wallet', async (ctx) => {
    await User.updateOne({ tgId: ctx.from.id }, { state: 'wait_wallet' });
    ctx.reply("✏️ Now Send Your Kpay/Wave Number and Name To Use It For Future Withdrawals").catch(()=>{});
});

bot.hears('🎁 Bonus', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    const now = new Date();
    if (user.lastBonus && (now - user.lastBonus < 86400000)) return ctx.reply("⏳ ၂၄ နာရီအတွင်း တစ်ကြိမ်သာ ရနိုင်ပါသည်။").catch(()=>{});
    const bonus = Math.floor(Math.random() * (10000 - 500 + 1)) + 500;
    user.balance += bonus;
    user.lastBonus = now;
    await user.save();
    ctx.reply(`🎉 သင် ${bonus} ကျပ် ရရှိလိုက်ပြီ ဖြစ်ပါသည်။`).catch(()=>{});
});

bot.hears('📤 ငွေထုတ်ယူရန်', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    if (user.balance < 100000) return ctx.reply("⚠ သင်ထုတ်ယူနိုင်ရန်အနည်းဆုံး 100,000 ကျပ် ရှိရပါမည်").catch(()=>{});
    user.state = 'withdraw_phone';
    await user.save();
    ctx.reply("📱 ငွေထုတ်ယူမည့် Kpay/Wave ဖုန်းနံပါတ်ကို ပို့ပေးပါ (ဂဏန်းသီးသန့်) 👇").catch(()=>{});
});

// --- 10. Admin Commands ---
bot.command('panel', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const total = await User.countDocuments();
    let msg = `👑 <b>Super Admin Panel</b>\n\n📊 Total Users: ${total}\n\n`;
    msg += `🔹 <code>/users [page]</code>\n🔹 <code>/add [ID] [Amt]</code>\n🔹 <code>/sub [ID] [Amt]</code>\n🔹 <code>/broadcast [Msg]</code>\n🔹 <code>/ban [ID]</code>`;
    await ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const msgText = ctx.message.text.split('/broadcast ')[1];
    if (!msgText) return ctx.reply("⚠️ စာသားထည့်ပါ။");
    const users = await User.find();
    for (const u of users) { try { await bot.telegram.sendMessage(u.tgId, msgText); } catch (e) {} }
    ctx.reply("✅ Broadcast Done.");
});

// --- 11. Global Message Handler (Withdrawal & Wallet) ---
bot.on('message', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;

        // Wallet Setting
        if (user.state === 'wait_wallet') {
            user.wallet = ctx.message.text;
            user.state = 'none';
            await user.save();
            return ctx.reply(`✅ Wallet သတ်မှတ်လိုက်ပါပြီ : ${ctx.message.text}`);
        }

        // Withdrawal Process
        if (user.state === 'withdraw_phone') {
            if (!/^\d+$/.test(ctx.message.text)) return ctx.reply("⚠️ နံပါတ်သီးသန့်သာ ထည့်ပေးပါ။");
            user.tempData = { phone: ctx.message.text };
            user.state = 'withdraw_name';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("👤 Kpay/Wave အကောင့်နာမည်ကို ပို့ပေးပါ 👇");
        }

        if (user.state === 'withdraw_name') {
            user.tempData = { ...user.tempData, name: ctx.message.text };
            user.state = 'withdraw_amount';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("💵 ထုတ်ယူလိုသော ပမာဏကို ရိုက်ထည့်ပါ 👇");
        }

        if (user.state === 'withdraw_amount') {
            const amt = parseInt(ctx.message.text);
            if (isNaN(amt) || amt < 100000 || amt > user.balance) return ctx.reply("❌ ပမာဏ မှားယွင်းနေပါသည်။");
            user.tempData = { ...user.tempData, amt: amt };
            user.state = 'withdraw_nrc_front';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("📸 မှတ်ပုံတင် 'အရှေ့ဘက်' ဓာတ်ပုံ ပို့ပေးပါ 👇");
        }

        if (user.state === 'withdraw_nrc_front' && ctx.message.photo) {
            user.tempData = { ...user.tempData, front: ctx.message.photo[ctx.message.photo.length - 1].file_id };
            user.state = 'withdraw_nrc_back';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("📸 မှတ်ပုံတင် 'အနောက်ဘက်' ဓာတ်ပုံ ပို့ပေးပါ 👇");
        }

        if (user.state === 'withdraw_nrc_back' && ctx.message.photo) {
            const backId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const data = user.tempData;
            user.balance -= data.amt;
            user.state = 'none';
            user.tempData = {};
            await user.save();

            await ctx.reply("✅ ငွေထုတ်ယူမှုအောင်မြင်ပါသည်။ Admin မှ စစ်ဆေးပေးပါမည်။");
            const adminMsg = `🚨 <b>Withdraw Request</b>\n🆔 ID: ${user.tgId}\n👤 Name: ${data.name}\n📞 Phone: ${data.phone}\n💵 Amt: ${data.amt} MMK`;
            try {
                await bot.telegram.sendMessage(LOG_GROUP_ID, adminMsg, { parse_mode: 'HTML' });
                await bot.telegram.sendPhoto(LOG_GROUP_ID, data.front, { caption: "NRC Front" });
                await bot.telegram.sendPhoto(LOG_GROUP_ID, backId, { caption: "NRC Back" });
            } catch (err) {}
        }
    } catch (e) { console.error(e); }
});

bot.action('back_to_menu', async (ctx) => {
    try { await ctx.deleteMessage(); } catch (e) {}
    await ctx.reply("🏡 မင်္ဂလာပါ! Main Menu မှာ ရွေးချယ်ပါ ✨", mainMenu);
});

bot.launch().then(() => console.log("🚀 Bot is Live and Fully Functional!"));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
