require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');

// --- 1. Render Port Binding & Server ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is Online!'));
app.listen(port, () => console.log(`✅ Server is listening on port ${port}`));

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

const CHANNELS = ['@BitCoinMyannmar', '@BitCoinMyan'];

// --- 5. Helpers ---
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

bot.catch((err, ctx) => {
    console.error(`⚠️ Telegram Error (${ctx.updateType}): ${err.message}`);
});

// --- 7. Keyboards (Mini App Button ပေါင်းထည့်ထားသည်) ---
const mainMenu = Markup.keyboard([
    ['💰 လက်ကျန်ငွေ', '👫 ဖိတ်ခေါ်ရန်'],
    [Markup.button.webApp('💸 ကြော်ငြာကြည့်ပြီးငွေရှာရန်', process.env.MINI_APP_URL)], 
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
            if (refId && refId !== ctx.from.id) {
                user.referredBy = refId;
            }
            await user.save();
        }

        if (user.isBanned) {
            return ctx.reply("🚫 သင်သည် စည်းကမ်းဖောက်ဖျက်မှုကြောင့် အသုံးပြုခွင့် ပိတ်ပင်ခံထားရပါသည်။").catch(()=>{});
        }

        const msg = `👋 မင်္ဂလာပါ ${ctx.from.first_name}\n\nBOT ကိုသုံးပြီးငွေရှာချင်တယ် မိတ်ဆွေ\nအောက်က Channel နှစ်ခုကို မJoin ထားရင် \nငွေထုတ်ရမည်မဟုတ်ပါ❌\n\nBot ကို အသုံးပြုဖို့အတွက် အောက်ပါ Channel ၂ခုကို join လုပ်ပါ👇\n\n1️⃣ @BitCoinMyannmar\n2️⃣ @BitCoinMyan\n\nJoin ပြီးရင် ✅ Joined ဆိုတဲ့ခလုတ်ကိုနှိပ်ပါ။\n\n🟡 Bitcoin ငွေရှာ BOT အသစ် 🟡🔋\nနေ့စဉ်ငွေရပြီး ငွေတန်းထုတ်နိုင်တယ်! 💯\nမြန်မာနိုင်ငံတရားဝင် Bitcoin Bot !\n\n🔥🎁 လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁 လူ 10 ယောက်ခေါ် → +50000ကျပ်\n\n🔥 Start လုပ်ပြီးရင် Menu မှာ 👇\n👫 ဖိတ်ခေါ်ရန် 👈 ကိုနှိပ်ပါ\nBot ပေးတဲ့ Link ကို သူငယ်ချင်းအခြား GP မှာတင်ပြီး ငွေရှာမယ်💸💰`;

        await ctx.reply(msg, Markup.inlineKeyboard([
            [Markup.button.url('📲 Channel 1 ကို Join ပါ', 'https://t.me/BitCoinMyannmar')],
            [Markup.button.url('📲 Channel 2 ကို Join ပါ', 'https://t.me/BitCoinMyan')],
            [Markup.button.callback('✅ Joined', 'check_join')]
        ])).catch(()=>{});
    } catch (e) { console.error("Start Error:", e); }
});

bot.action('check_join', async (ctx) => {
    try {
        if (await isJoined(ctx)) {
            const user = await User.findOne({ tgId: ctx.from.id });
            if (user && user.referredBy) {
                const refUser = await User.findOne({ tgId: user.referredBy });
                if (refUser) {
                    await User.updateOne({ tgId: user.referredBy }, { 
                        $inc: { balance: 5000, referralCount: 1 } 
                    });
                    try {
                        await bot.telegram.sendMessage(refUser.tgId, `🎉 ဂုဏ်ယူပါတယ်! လူသစ်တစ်ယောက်ဖိတ်ခေါ်မှုအောင်မြင်ပြီး 5000 ကျပ် ရရှိပါသည်!`);
                    } catch (err) {}
                }
                user.referredBy = null;
                await user.save();
            }
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply("🏡 မင်္ဂလာပါ! Main Menu မှာ ရွေးချယ်ပါ ✨", mainMenu).catch(()=>{});
        } else {
            await ctx.answerCbQuery("⚠️ Channel (၂) ခုလုံးကို Join ရပါမည်!", { show_alert: true }).catch(()=>{});
        }
    } catch (e) { console.error("Check Join Error:", e); }
});

// --- 9. Main Menu Buttons ---
bot.hears('💰 လက်ကျန်ငွေ', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;
        await ctx.reply(`🙌🏻 အသုံးပြုသူ = ${user.username}\n💰 လက်ကျန်ငွေ = ${user.balance.toLocaleString()} ကျပ်\n\n🪢 ပိုပြီး ရနိုင်ရန် မိတ်ဆွေ ဖိတ်ပါ ✨`).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.hears('👫 ဖိတ်ခေါ်ရန်', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;
        const botMe = await bot.telegram.getMe();
        const refLink = `https://t.me/${botMe.username}?start=${ctx.from.id}`;
        const shareText = `@bitcoinminingmyanmar_bot Bitcoin Bot !🔥\n\n🎁လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁လူ 10 ယောက်ခေါ် → +50000ကျပ် 🔥\n\nငါ့ရဲ့ Invite Link က ${refLink} ဖြစ်ပါတယ်`;

        const msg = `🙌🏻 သင့်စုစုပေါင်း ဖိတ်ခေါ်ထားသူ = ${user.referralCount} User(s)\n🙌🏻 သင့်ဖိတ်ခေါ်ရန် Link = ${refLink}\n\n🪢 ဖိတ်ခေါ်ပြီး 5000 ကျပ် ရယူနိုင်ပါသည်\n\n🟡 Bitcoin ငွေရှာ BOT အသစ် 🟡\n🔋 နေ့စဉ်ငွေရပြီး ငွေတန်းထုတ်နိုင်တယ်! 💯 မြန်မာနိုင်ငံတရားဝင် Bitcoin Bot !🔥\n\n🎁လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁လူ 10 ယောက်ခေါ် → +50000ကျပ်\n\n🔥သူငယ်ချင်းတွေရဲ့ ဝယ်ယူမှုတိုင်းအတွက် ကော်မရှင် 80% အထိရ\n✅သင့် Wave/KPay ဆီသို့ ငွေတန်းထုတ်နိုင်တယ်\n\n🎯 ငါ့လင့်ကနေ ဝင်ပြီး ဘောနပ် 5000ကျပ် ယူလိုက်ပါ`;

        await ctx.reply(msg, Markup.inlineKeyboard([
            [Markup.button.callback('👥 ဖိတ်ခေါ်ထားသောသူများ', 'my_refs')],
            [Markup.button.callback('🏆 Top List', 'top_list')],
            [Markup.button.switchToChat('🚀 Bot Link ကို Share ပါ', shareText)]
        ])).catch(()=>{});
    } catch (e) { console.error(e); }
});

// (Other buttons remain same...)
bot.hears('🗂 Wallet', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;
        await ctx.reply(`💡 သင့်လက်ရှိ Wallet နံပါတ်: ${user.wallet}\n\n💹ထို Wallet ကို အနာဂတ်ထုတ်ယူမှုများတွင် အသုံးပြုပါမည်။\n\nကျေးဇူးပြု၍ 💠 Wallet သတ်မှတ် / ပြင်ဆင် 💠 \nနှိပ်ပြီး သင်ငွေထုတ်ယူလိုသော WavePay/Kpay နာမည်နှင့် ဖုန်းနံပါတ်ကို ပို့ပေးပါ😘`, Markup.inlineKeyboard([
            [Markup.button.callback('💠 Wallet ပြင်ဆင်ပါ', 'set_wallet')]
        ])).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.action('set_wallet', async (ctx) => {
    try {
        await User.updateOne({ tgId: ctx.from.id }, { state: 'wait_wallet' });
        await ctx.reply("✏️ Now Send Your Kpay/Wave Number and Name").catch(()=>{});
        await ctx.answerCbQuery().catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.hears('🎁 Bonus', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;
        const now = new Date();
        if (user.lastBonus && (now - user.lastBonus < 86400000)) {
            return ctx.reply(`⏳ 24 နာရီပြည့်မှ ပြန်ယူပါဗျ။`).catch(()=>{});
        }
        const bonus = Math.floor(Math.random() * 5000) + 500;
        user.balance += bonus;
        user.lastBonus = now;
        await user.save();
        await ctx.reply(`🎉 သင် ${bonus} ကျပ် ရရှိပါသည်!`).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.hears('📤 ငွေထုတ်ယူရန်', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (user.balance < 100000) return ctx.reply("⚠ အနည်းဆုံး 100,000 ကျပ် ရှိရပါမည်");
        user.state = 'withdraw_phone';
        await user.save();
        await ctx.reply("📱 ဖုန်းနံပါတ် ပို့ပေးပါ 👇").catch(()=>{});
    } catch (e) { console.error(e); }
});

// --- 11. Message Handler ---
bot.on('message', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;

        if (user.state === 'wait_wallet') {
            user.wallet = ctx.message.text;
            user.state = 'none';
            await user.save();
            return ctx.reply("✅ Wallet Saved!").catch(()=>{});
        }

        // Add logic for withdrawal flow here if needed...
    } catch (e) { console.error(e); }
});

// --- 12. Bot Launch (အောက်ဆုံးပိုင်း အပြည့်အစုံ) ---
bot.launch().then(() => {
    console.log("🚀 Super Admin Bot is running flawlessly!");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
