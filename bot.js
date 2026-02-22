require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const path = require('path');

// --- 1. Render Server Setup ---
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
// Folder မရှိရင် လက်ရှိ directory က index.html ကို သုံးအောင် လုပ်ထားပါတယ်
app.use(express.static(__dirname)); 

// Render Link ကို နှိပ်ရင် index.html ပွင့်စေဖို့
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
                // User က bot ကို block ထားရင် error မတက်အောင် catch လုပ်ထားပါတယ်
                await bot.telegram.sendMessage(userId, "💰 ကြော်ငြာကြည့်ရှုမှုအတွက် ၅၀၀ ကျပ် လက်ခံရရှိပါတယ်!");
            } catch (e) {
                console.log(`Notification failed: User ${userId} blocked the bot.`);
            }
            return res.json({ success: true, newBalance: user.balance });
        }
        res.status(404).send('User not found');
    } catch (error) {
        res.status(500).send('Internal Error');
    }
});

app.listen(port, () => console.log(`✅ Server is listening on port ${port}`));

const CHANNELS = ['@BitCoinMyannmar', '@BitCoinMyan'];

// --- Helpers ---
async function isJoined(ctx) {
    for (const ch of CHANNELS) {
        try {
            const member = await ctx.telegram.getChatMember(ch, ctx.from.id);
            if (['left', 'kicked'].includes(member.status)) return false;
        } catch (e) { 
            return false; 
        }
    }
    return true;
}

const isAdmin = (ctx) => String(ctx.from.id) === ADMIN_ID;

// --- Global Error Handler ---
bot.catch((err, ctx) => {
    console.error(`⚠️ Telegram Error (${ctx.updateType}): ${err.message}`);
});

// --- 7. Keyboards (Mini App URL ပြင်ထားသည်) ---
const mainMenu = Markup.keyboard([
    ['💰 လက်ကျန်ငွေ', '👫 ဖိတ်ခေါ်ရန်'],
    // process.env.MINI_APP_URL ထဲမှာ Render Link ကိုပဲ ထည့်ပါ (GitHub မထည့်ရ)
    [Markup.button.webApp('💸 ကြော်ငြာကြည့်ပြီးငွေရှာရန်', process.env.MINI_APP_URL)],
    ['🗂 Wallet', '🎁 Bonus'],
    ['📤 ငွေထုတ်ယူရန်']
]).resize();

// --- 8. Commands & Actions ---
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

        const msg = `👋 မင်္ဂလာပါ ${ctx.from.first_name}\n\nBOT ကိုသုံးပြီးငွေရှာချင်တယ် မိတ်ဆွေ\nအောက်က Channel နှစ်ခုကို မJoin ထားရင် \nငွေထုတ်ရမည်မဟုတ်ပါ❌\n\nBot ကို အသုံးပြုဖို့အတွက် အောက်ပါ Channel ၂ခုကို join လုပ်ပါ👇\n\n1️⃣ @BitCoinMyannmar\n2️⃣ @BitCoinMyan\n\nJoin ပြီးရင် ✅ Joined ဆိုတဲ့ခလုတ်ကိုနှိပ်ပါ။\n\n🟡 Bitcoin ငွေရှာ BOT အသစ် 🟡🔋\nနေ့စဉ်ငွေရပြီး ငွေတန်းထုတ်နိုင်တယ်! 💯\nမြန်မာနိုင်ငံတရားဝင် Bitcoin Bot !\n\n🔥🎁 လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁 လူ 10 ယောက်ခေါ် → +50000ကျပ်`;

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
                await User.updateOne({ tgId: user.referredBy }, { $inc: { balance: 5000, referralCount: 1 } });
                try {
                    await bot.telegram.sendMessage(user.referredBy, `🎉 ဂုဏ်ယူပါတယ်! လူသစ်တစ်ယောက်ဖိတ်ခေါ်မှုအောင်မြင်ပြီး 5000 ကျပ် ရရှိပါသည်!`);
                } catch (err) {}
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

bot.hears('💰 လက်ကျန်ငွေ', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    if (user) ctx.reply(`🙌🏻 အသုံးပြုသူ = ${user.username}\n💰 လက်ကျန်ငွေ = ${user.balance.toLocaleString()} ကျပ်\n\n🪢 ပိုပြီး ရနိုင်ရန် မိတ်ဆွေ ဖိတ်ပါ ✨`).catch(()=>{});
});

bot.hears('👫 ဖိတ်ခေါ်ရန်', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    const botMe = await bot.telegram.getMe();
    const refLink = `https://t.me/${botMe.username}?start=${ctx.from.id}`;
    const shareText = `Bitcoin Bot !🔥 လူ 1 ယောက်ခေါ် +5000ကျပ် \nInvite Link: ${refLink}`;
    
    ctx.reply(`🙌🏻 သင့်ဖိတ်ခေါ်ရန် Link = ${refLink}`, Markup.inlineKeyboard([
        [Markup.button.callback('🏆 Top List', 'top_list')],
        [Markup.button.switchToChat('🚀 Bot Link ကို Share ပါ', shareText)]
    ])).catch(()=>{});
});

bot.hears('🎁 Bonus', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    const now = new Date();
    if (user.lastBonus && (now - user.lastBonus < 86400000)) return ctx.reply("⏳ ၂၄ နာရီအတွင်း တစ်ကြိမ်သာ ရနိုင်ပါသည်။").catch(()=>{});
    
    const bonus = Math.floor(Math.random() * (1000 - 500 + 1)) + 500;
    user.balance += bonus;
    user.lastBonus = now;
    await user.save();
    ctx.reply(`🎉 သင် ${bonus} ကျပ် ရရှိလိုက်ပါပြီ!`).catch(()=>{});
});

bot.hears('🗂 Wallet', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    ctx.reply(`💡 လက်ရှိ Wallet: ${user.wallet}`, Markup.inlineKeyboard([
        [Markup.button.callback('💠 Wallet ပြင်ဆင်ပါ', 'set_wallet')]
    ])).catch(()=>{});
});

bot.action('set_wallet', async (ctx) => {
    await User.updateOne({ tgId: ctx.from.id }, { state: 'wait_wallet' });
    ctx.reply("✏️ Kpay/Wave နံပါတ် နှင့် အမည် ပို့ပေးပါ 👇").catch(()=>{});
});

bot.hears('📤 ငွေထုတ်ယူရန်', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    if (user.balance < 100000) return ctx.reply("⚠ အနည်းဆုံး 100,000 ကျပ် ရှိရပါမည်").catch(()=>{});
    user.state = 'withdraw_phone';
    await user.save();
    ctx.reply("📱 ငွေထုတ်ယူမည့် Kpay/Wave ဖုန်းနံပါတ် ပို့ပေးပါ 👇").catch(()=>{});
});

// --- Admin Commands ---
bot.command('panel', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const total = await User.countDocuments();
    ctx.reply(`👑 Admin Panel\n📊 Total Users: ${total}\n/broadcast [စာသား]`).catch(()=>{});
});

bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const msg = ctx.message.text.split('/broadcast ')[1];
    if (!msg) return ctx.reply("စာသားထည့်ပါ");
    const users = await User.find();
    for (const u of users) {
        try { await bot.telegram.sendMessage(u.tgId, msg); } catch (e) {}
    }
    ctx.reply("✅ ပို့ဆောင်ပြီးပါပြီ").catch(()=>{});
});

// --- General Message Handler ---
bot.on('message', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;

        if (user.state === 'wait_wallet') {
            user.wallet = ctx.message.text;
            user.state = 'none';
            await user.save();
            return ctx.reply("✅ Wallet သတ်မှတ်ပြီးပါပြီ").catch(()=>{});
        }

        if (user.state === 'withdraw_phone') {
            user.tempData = { phone: ctx.message.text };
            user.state = 'withdraw_name';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("👤 အကောင့်နာမည် ပို့ပေးပါ 👇").catch(()=>{});
        }

        if (user.state === 'withdraw_name') {
            user.tempData = { ...user.tempData, name: ctx.message.text };
            user.state = 'withdraw_amount';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("💵 ပမာဏ ရိုက်ထည့်ပါ 👇").catch(()=>{});
        }

        if (user.state === 'withdraw_amount') {
            const amt = parseInt(ctx.message.text);
            if (isNaN(amt) || amt > user.balance) return ctx.reply("❌ ပမာဏ မှားယွင်းနေပါသည်").catch(()=>{});
            user.tempData = { ...user.tempData, amt: amt };
            user.state = 'withdraw_nrc_front';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("📸 မှတ်ပုံတင် အရှေ့ပုံ ပို့ပေးပါ 👇").catch(()=>{});
        }

        if (user.state === 'withdraw_nrc_front' && ctx.message.photo) {
            user.tempData = { ...user.tempData, front: ctx.message.photo[ctx.message.photo.length - 1].file_id };
            user.state = 'withdraw_nrc_back';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("📸 မှတ်ပုံတင် အနောက်ပုံ ပို့ပေးပါ 👇").catch(()=>{});
        }

        if (user.state === 'withdraw_nrc_back' && ctx.message.photo) {
            const backId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const data = user.tempData;
            user.balance -= data.amt;
            user.state = 'none';
            user.tempData = {};
            await user.save();
            ctx.reply("✅ ငွေထုတ်ယူမှု အောင်မြင်ပါသည်။ Admin မှ စစ်ဆေးပေးပါမည်။").catch(()=>{});
            try {
                await bot.telegram.sendMessage(LOG_GROUP_ID, `🚨 Withdraw: ${data.amt} MMK\nID: ${user.tgId}\nPhone: ${data.phone}`);
                await bot.telegram.sendPhoto(LOG_GROUP_ID, data.front);
                await bot.telegram.sendPhoto(LOG_GROUP_ID, backId);
            } catch (err) {}
        }
    } catch (e) { console.error(e); }
});

bot.launch().then(() => console.log("🚀 Bot is Live!"));
