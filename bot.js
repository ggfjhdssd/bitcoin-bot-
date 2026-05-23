require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const path = require('path');

// --- 1. Render Port Binding & Mini App Server ---
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// CORS — Vercel frontend မှ Render backend ကို fetch လုပ်ခွင့်ပေးသည်
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

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
    tempData: { type: Object, default: {} },
    lastActive: { type: Date, default: Date.now },
    hasReceivedReferralBonus: { type: Boolean, default: false },
    isJoined: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

// Withdrawal Request Schema
const withdrawalSchema = new mongoose.Schema({
    userId: Number,
    username: String,
    phone: String,
    name: String,
    amount: Number,
    nrcFront: String,
    nrcBack: String,
    status: { type: String, default: 'pending' }, // pending, approved, rejected
    createdAt: { type: Date, default: Date.now },
    reviewedAt: Date,
    reviewedBy: Number,
    rejectReason: String,
    verificationScreenshot: String,
    amountDeducted: { type: Boolean, default: false }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// --- 5. Reward API for Mini App (Adsgram အတွက်) ---
app.all('/reward-user', async (req, res) => {
    try {
        const userId = req.query.userId || req.body.userId;
        if (!userId) {
            return res.status(400).send('User ID required');
        }

        // FIX #2: user.balance += amount ကို $inc နဲ့ အစားထိုး (Concurrency-safe)
        const updatedUser = await User.findOneAndUpdate(
            { tgId: Number(userId) },
            { $inc: { balance: 500 } },
            { new: true }
        );

        if (updatedUser) {
            try {
                await bot.telegram.sendMessage(userId, "💰 ကြော်ငြာကြည့်ရှုမှုအတွက် ၅၀၀ ကျပ် လက်ခံရရှိပါတယ်!");
            } catch (e) { /* User blocked the bot */ }
            return res.json({ success: true, newBalance: updatedUser.balance });
        }
        res.status(404).send('User not found');
    } catch (error) {
        console.error("❌ /reward-user error:", error);
        res.status(500).send('Internal Error');
    }
});

// Balance ပြရန် API (index.html အတွက်) - /get-balance (legacy)
app.post('/get-balance', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'User ID required' });
        const user = await User.findOne({ tgId: userId });
        if (user) {
            return res.json({ balance: user.balance });
        }
        res.json({ balance: 0 });
    } catch (error) {
        console.error("❌ /get-balance error:", error);
        res.status(500).json({ error: 'Internal Error' });
    }
});

// /api/get-user — index.html ၏ refreshBalance() အတွက် (user အချက်အလက်အကုန်)
app.post('/api/get-user', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'User ID required' });
        const user = await User.findOne({ tgId: Number(userId) });
        if (user) {
            return res.json({
                balance: user.balance,
                username: user.username,
                wallet: user.wallet,
                referralCount: user.referralCount,
                lastSpin: user.lastActive,
                isBanned: user.isBanned
            });
        }
        // User မတွေ့ → အသစ် create
        const newUser = await User.findOneAndUpdate(
            { tgId: Number(userId) },
            { $setOnInsert: { username: 'User' } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return res.json({ balance: newUser.balance, username: newUser.username, wallet: newUser.wallet, referralCount: newUser.referralCount });
    } catch (error) {
        console.error("❌ /api/get-user error:", error);
        res.status(500).json({ error: 'Internal Error' });
    }
});

// /api/reward-user — index.html ၏ ad reward အတွက်
app.post('/api/reward-user', async (req, res) => {
    try {
        const { userId, slot } = req.body;
        if (!userId) return res.status(400).json({ error: 'User ID required' });
        const updatedUser = await User.findOneAndUpdate(
            { tgId: Number(userId) },
            { $inc: { balance: 500 } },
            { new: true }
        );
        if (updatedUser) {
            try { await bot.telegram.sendMessage(userId, `💰 ကြော်ငြာ (Slot ${slot || ''}) ကြည့်ရှုမှုအတွက် ၅၀၀ ကျပ် လက်ခံရရှိပါတယ်!`); } catch (e) {}
            return res.json({ success: true, newBalance: updatedUser.balance, rewardAmt: 500 });
        }
        res.status(404).json({ error: 'User not found' });
    } catch (error) {
        console.error("❌ /api/reward-user error:", error);
        res.status(500).json({ error: 'Internal Error' });
    }
});

// /api/spin — Lucky Spin အတွက်
app.post('/api/spin', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'User ID required' });
        const prizes = [100, 50, 200, 300, 500, 50, 100, 200];
        const idx = Math.floor(Math.random() * prizes.length);
        const amount = prizes[idx];
        const updatedUser = await User.findOneAndUpdate(
            { tgId: Number(userId) },
            { $inc: { balance: amount }, $set: { lastActive: new Date() } },
            { new: true }
        );
        if (!updatedUser) return res.status(404).json({ error: 'User not found' });
        try { await bot.telegram.sendMessage(userId, `🎰 Lucky Spin မှ ${amount} ကျပ် ရရှိပါတယ်! လက်ကျန်: ${updatedUser.balance.toLocaleString()} ကျပ်`); } catch (e) {}
        return res.json({ success: true, amount, newBalance: updatedUser.balance, prizeIndex: idx });
    } catch (error) {
        console.error("❌ /api/spin error:", error);
        res.status(500).json({ error: 'Internal Error' });
    }
});

// /api/task-config — Task slot config အတွက်
app.get('/api/task-config', async (req, res) => {
    res.json({
        slots: [
            { id: 1, title: 'ကြော်ငြာ ၁', reward: 500, blockId: 'task-31469' },
            { id: 2, title: 'ကြော်ငြာ ၂', reward: 500, blockId: 'task-31469' },
            { id: 3, title: 'ကြော်ငြာ ၃', reward: 500, blockId: 'task-31469' },
            { id: 4, title: 'ကြော်ငြာ ၄', reward: 500, blockId: 'task-31469' },
        ]
    });
});

// /api/withdraw-deep-link — Website က withdraw button နှိပ်ရင် bot deep link ပေး
app.post('/api/withdraw-deep-link', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'User ID required' });
        const botMe = await bot.telegram.getMe();
        const deepLink = `https://t.me/${botMe.username}?start=withdraw_${userId}`;
        return res.json({ deepLink });
    } catch (error) {
        console.error("❌ /api/withdraw-deep-link error:", error);
        res.status(500).json({ error: 'Internal Error' });
    }
});

app.listen(port, () => console.log(`✅ Server is listening on port ${port}`));

// --- Channel တစ်ခု ထားရှိရန် ---
const CHANNELS = ['@Bitcoinmyanmarmining', '@BitCoinMyan'];

// --- 6. Helpers ---

// ══════════════════════════════════════════════════════════
//  ① Custom Error — Telegram API လုံးဝ မဆက်သွယ်နိုင်သောအခါ
// ══════════════════════════════════════════════════════════
class TelegramApiError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TelegramApiError';
    }
}

// ══════════════════════════════════════════════════════════
//  ② In-Memory Cache — userId → { joined, expiresAt }
// ══════════════════════════════════════════════════════════
const joinCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 မိနစ်

setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of joinCache.entries()) {
        if (now >= data.expiresAt) joinCache.delete(userId);
    }
}, 10 * 60 * 1000);

// ══════════════════════════════════════════════════════════
//  ③ Exponential Backoff Retry Helper
// ══════════════════════════════════════════════════════════
const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']);

async function withRetry(fn, retries = 3, baseDelayMs = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            const isNetworkError =
                RETRYABLE_CODES.has(e.code) ||
                (e.message && (e.message.includes('ETIMEDOUT') || e.message.includes('socket hang up')));

            if (!isNetworkError || attempt === retries) break;

            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            console.warn(`⚠️ [Retry ${attempt}/${retries}] ${e.code || e.message} — ${delay}ms စောင့်သည်...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new TelegramApiError(
        `Telegram API ${retries} ကြိမ် retry လုပ်လည်း ဆက်သွယ်မရပါ: ${lastError?.message}`
    );
}

// ══════════════════════════════════════════════════════════
//  ④ isJoined — Cache + Retry + Error Handling
// ══════════════════════════════════════════════════════════
async function isJoined(ctx) {
    const userId = ctx.from.id;

    const cached = joinCache.get(userId);
    if (cached && Date.now() < cached.expiresAt) {
        console.log(`✅ [Cache Hit] User ${userId} — API call ကျော်သည်`);
        return cached.joined;
    }

    for (const ch of CHANNELS) {
        const member = await withRetry(() => ctx.telegram.getChatMember(ch, userId));
        if (['left', 'kicked'].includes(member.status)) {
            return false;
        }
    }

    joinCache.set(userId, { joined: true, expiresAt: Date.now() + CACHE_TTL_MS });
    console.log(`✅ [Cache Set] User ${userId}`);
    return true;
}

const isAdmin = (ctx) => String(ctx.from.id) === ADMIN_ID;

bot.catch((err, ctx) => {
    console.error(`⚠️ Telegram Error (${ctx.updateType}): ${err.message}`);
});

// --- 7. Keyboards ---
const mainMenu = Markup.keyboard([
    ['💰 လက်ကျန်ငွေ', '👫 ဖိတ်ခေါ်ရန်'],
    ['💸 ကြော်ငြာကြည့်ပြီးငွေရှာရန်'],
    ['🗂 Wallet', '🎁 Bonus'],
    ['📤 ငွေထုတ်ယူရန်']
]).resize();

// --- 8. Start Command ---
// FIX #1: findOne + new User().save() ကို findOneAndUpdate (upsert) နဲ့ အစားထိုး
//         Race condition ကြောင့် ဖြစ်သော E11000 duplicate key error ကို ဖြေရှင်းသည်
bot.start(async (ctx) => {
    try {
        const payload = ctx.payload;
        // Website မှ ငွေထုတ်ခလုတ် နှိပ်လာသောအခါ → withdraw flow တန်းစပါ
        if (payload && payload.startsWith("withdraw_")) {
            const user = await User.findOne({ tgId: ctx.from.id });
            if (!user) return ctx.reply("⚠️ User မတွေ့ပါ။ Bot ကို /start နှိပ်ပြီး စဉ်ဆက်ပါ။");
            if (user.isBanned) return ctx.reply("🚫 သင်သည် ပိတ်ပင်ခံထားရပါသည်။");
            if (user.balance < 100000) {
                return ctx.reply("⚠ ငွေထုတ်ယူရန် အနည်းဆုံး 100,000 ကျပ် ရှိရပါမည်။\n\nလက်ကျန်: " + user.balance.toLocaleString() + " ကျပ်", mainMenu);
            }
            let joined = false;
            try { joined = await isJoined(ctx); } catch (e) { joined = false; }
            if (!joined) return ctx.reply("⚠️ Channel ၂ ခုလုံးကို Join ထားမှ ငွေထုတ်ခွင့်ရမည်ဖြစ်ပါသည်။", mainMenu);
            await User.updateOne({ tgId: ctx.from.id }, { $set: { state: "withdraw_phone" } });
            return ctx.reply("💸 ငွေထုတ်ယူမှု စတင်ပါပြီ!\n\nလက်ကျန်: " + user.balance.toLocaleString() + " ကျပ်\n\n📱 ငွေထုတ်ယူမည့် Kpay/Wave ဖုန်းနံပါတ်ကို ပို့ပေးပါ (ဂဏန်းသီးသန့်) 👇\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ");
        }

        const refId = payload ? parseInt(payload) : null;
        const isValidRef = refId && refId !== ctx.from.id;

        // upsert: true  → မရှိသေးရင် create, ရှိပြီးသားရင် update (setDefaultsOnInsert သုံးသည်)
        // setDefaultsOnInsert: true → Schema ထဲက default တွေကို insert အသစ်မှာသာ သုံးသည်
        // $setOnInsert  → ရှိပြီးသား user ကို referredBy မပြောင်းသွားအောင် insert အသစ်တွင်သာ set
        const updateQuery = {
            $setOnInsert: {
                username: ctx.from.first_name || 'User',
                ...(isValidRef ? { referredBy: refId } : {})
            }
        };

        const user = await User.findOneAndUpdate(
            { tgId: ctx.from.id },
            updateQuery,
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            }
        );

        if (user.isBanned) {
            return ctx.reply("🚫 သင်သည် စည်းကမ်းဖောက်ဖျက်မှုကြောင့် အသုံးပြုခွင့် ပိတ်ပင်ခံထားရပါသည်။").catch(() => {});
        }

        // ── isJoined status ကို Database မှ စစ်ဆေးသည် ──
        if (user.isJoined) {
            // ✅ Join ပြီးသား User → VPN သတိပေးစာ + ကြော်ငြာကြည့်ရန် Button
            const miniAppUrl = `https://the-netcoinmm.vercel.app/?id=${user.tgId}`;

            const vpnMsg =
                `📢 <b>ကြော်ငြာကြည့်ပြီး ငွေပိုရှာဖို့အတွက် သတိပြုရန်</b>\n\n` +
                `ယခု Task ကို လုပ်ဆောင်ရန်အတွက် <b>Jump Jump VPN</b> (သို့မဟုတ်) တခြား VPN တစ်ခုခုကို အသုံးပြုပြီး <b>USA</b> သို့မဟုတ် <b>UK</b> Location ပြောင်းပေးရန် လိုအပ်ပါသည်။\n\n` +
                `မြန်မာနိုင်ငံ Location ဖြင့် ကြည့်ပါက ကြော်ငြာတက်မည်မဟုတ်သလို Coins များလည်း ရရှိမည်မဟုတ်ပါ`;

            await ctx.replyWithHTML(vpnMsg,
                Markup.inlineKeyboard([
                    [Markup.button.webApp('📺 ကြော်ငြာကြည့်ရန်', miniAppUrl)]
                ])
            ).catch(() => {});
        } else {
            // ❌ မ Join ရသေးသည့် User → Channel Join တောင်းဆိုသည့် စာ
            const joinMsg =
                `👋 မင်္ဂလာပါ ${ctx.from.first_name}\n\n` +
                `BOT ကိုသုံးပြီးငွေရှာချင်တယ် မိတ်ဆွေ\n` +
                `အောက်က Channel ၂ ခုလုံးကို Join ထားမှသာ\n` +
                `ငွေထုတ်ခွင့်ရမည်ဖြစ်ပါသည်❌\n\n` +
                `Bot ကို အသုံးပြုဖို့အတွက် အောက်ပါ Channel ၂ ခုလုံးကို join လုပ်ပါ👇\n\n` +
                `1️⃣ @Bitcoinmyanmarmining\n` +
                `2️⃣ @BitCoinMyan\n\n` +
                `Join ပြီးရင် ✅ Joined ဆိုတဲ့ခလုတ်ကိုနှိပ်ပါ။\n\n` +
                `🟡 Bitcoin ငွေရှာ BOT အသစ် 🟡🔋\n` +
                `နေ့စဉ်ငွေရပြီး ငွေတန်းထုတ်နိုင်တယ်! 💯\n` +
                `မြန်မာနိုင်ငံတရားဝင် Bitcoin Bot !\n\n` +
                `🔥🎁 လူ 1 ယောက်ခေါ် → +5000ကျပ်\n` +
                `🎁 လူ 10 ယောက်ခေါ် → +50000ကျပ်\n\n` +
                `🔥 Start လုပ်ပြီးရင် Menu မှာ 👇\n` +
                `👫 ဖိတ်ခေါ်ရန် 👈 ကိုနှိပ်ပါ\n` +
                `Bot ပေးတဲ့ Link ကို သူငယ်ချင်းအခြား GP မှာတင်ပြီး ငွေရှာမယ်💸💰`;

            await ctx.reply(joinMsg, Markup.inlineKeyboard([
                [Markup.button.url('📲 Channel 1 ကို Join ပါ', 'https://t.me/Bitcoinmyanmarmining')],
                [Markup.button.url('📲 Channel 2 ကို Join ပါ', 'https://t.me/BitCoinMyan')],
                [Markup.button.callback('✅ Joined', 'check_join')]
            ])).catch(() => {});
        }
    } catch (e) {
        console.error("❌ /start error:", e);
    }
});

bot.action('check_join', async (ctx) => {
    try {
        let joined;
        try {
            joined = await isJoined(ctx);
        } catch (e) {
            if (e instanceof TelegramApiError) {
                console.error(`🔴 [check_join] TelegramApiError: ${e.message}`);
                return ctx.answerCbQuery(
                    "⚠️ Bot တွင် ယာယီချိတ်ဆက်မှု အခက်အခဲရှိနေပါသဖြင့် ခေတ္တစောင့်ဆိုင်းပြီးမှ ထပ်မံကြိုးစားကြည့်ပါခင်ဗျာ။",
                    { show_alert: true }
                ).catch(() => {});
            }
            throw e;
        }

        if (joined) {
            const user = await User.findOne({ tgId: ctx.from.id });
            if (!user) return;

            // ✅ isJoined = true ကို Database မှာ မှတ်သားသည်
            await User.updateOne(
                { tgId: ctx.from.id },
                { $set: { isJoined: true } }
            );

            // Referral Bonus Logic - Channel join ထားမှသာ ရမည်
            if (user.referredBy && !user.hasReceivedReferralBonus) {
                const refUser = await User.findOne({ tgId: user.referredBy });
                if (refUser) {
                    // FIX #2: Referrer balance ကို $inc နဲ့ atomic update လုပ်သည်
                    await User.updateOne(
                        { tgId: user.referredBy },
                        { $inc: { balance: 5000, referralCount: 1 } }
                    );

                    // Referrer အသစ်ပြောင်းလဲသွားသော balance ကို ထပ်ယူ
                    const updatedRefUser = await User.findOne({ tgId: user.referredBy });
                    try {
                        await bot.telegram.sendMessage(
                            refUser.tgId,
                            `🎉 ဂုဏ်ယူပါတယ်! လူသစ်တစ်ယောက်ဖိတ်ခေါ်မှုအောင်မြင်ပြီး 5000 ကျပ် ရရှိပါသည်!\n\n` +
                            `လက်ကျန်: ${updatedRefUser ? updatedRefUser.balance.toLocaleString() : '...'} ကျပ်`
                        );
                    } catch (err) { /* User blocked the bot */ }

                    // FIX #2: New user bonus ကိုလည်း $inc နဲ့ update
                    await User.updateOne(
                        { tgId: ctx.from.id },
                        {
                            $inc: { balance: 5000 },
                            $set: { hasReceivedReferralBonus: true, referredBy: null }
                        }
                    );
                } else {
                    // refUser မတွေ့ → referredBy ရှင်းပေး
                    await User.updateOne(
                        { tgId: ctx.from.id },
                        { $set: { hasReceivedReferralBonus: true, referredBy: null } }
                    );
                }
            } else if (user.referredBy && user.hasReceivedReferralBonus) {
                await User.updateOne(
                    { tgId: ctx.from.id },
                    { $set: { referredBy: null } }
                );
            }

            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply("🏡 မင်္ဂလာပါ! Main Menu မှာ ရွေးချယ်ပါ ✨", mainMenu).catch(() => {});
        } else {
            await ctx.answerCbQuery("⚠️ Channel (၂) ခုလုံးကို Join ရပါမည်!", { show_alert: true }).catch(() => {});
        }
    } catch (e) {
        console.error("❌ check_join error:", e);
    }
});

// --- 9. Main Menu Buttons ---

// ★ ကြော်ငြာကြည့်ပြီးငွေရှာရန် — VPN notice + Mini App button with userId
bot.hears('💸 ကြော်ငြာကြည့်ပြီးငွေရှာရန်', async (ctx) => {
    try {
        const tgId = ctx.from.id;
        const user = await User.findOne({ tgId });
        if (!user) return ctx.reply('⚠️ User မတွေ့ပါ။ /start နှိပ်ပြီး စတင်ပါ။').catch(() => {});
        if (user.isBanned) return ctx.reply('🚫 သင်သည် ပိတ်ပင်ခံထားရပါသည်။').catch(() => {});

        // Mini App URL — userId ကို uid param အနေနဲ့ ထည့်ပေးသည် (fallback အတွက်)
        const miniAppUrl = `https://the-netcoinmm.vercel.app/?uid=${tgId}`;

        const msg =
            `📢 <b>ကြော်ငြာကြည့်ပြီး ငွေပိုရှာဖို့အတွက် သတိပြုရန်</b>\n\n` +
            `ယခု Task ကို လုပ်ဆောင်ရန်အတွက် <b>Jump Jump VPN</b> (သို့မဟုတ်) တခြား VPN တစ်ခုခုကို အသုံးပြုပြီး <b>USA</b> သို့မဟုတ် <b>UK</b> Location ပြောင်းပေးရန် လိုအပ်ပါသည်။\n\n` +
            `မြန်မာနိုင်ငံ Location ဖြင့် ကြည့်ပါက ကြော်ငြာတက်မည်မဟုတ်သလို Coins များလည်း ရရှိမည်မဟုတ်ပါ`;

        await ctx.replyWithHTML(msg,
            Markup.inlineKeyboard([
                [Markup.button.webApp('📺 ကြော်ငြာကြည့်ရန်', miniAppUrl)]
            ])
        ).catch(() => {});
    } catch (e) {
        console.error('❌ ad-watch handler error:', e);
    }
});

bot.hears('💰 လက်ကျန်ငွေ', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (user) {
            await ctx.reply(`🙌🏻 အသုံးပြုသူ = ${user.username}\n💰 လက်ကျန်ငွေ = ${user.balance.toLocaleString()} ကျပ်\n\n🪢 ပိုပြီး ရနိုင်ရန် မိတ်ဆွေ ဖိတ်ပါ ✨`).catch(() => {});
        }
    } catch (e) {
        console.error("❌ balance check error:", e);
    }
});

bot.hears('👫 ဖိတ်ခေါ်ရန်', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user) return;
        const botMe = await bot.telegram.getMe();
        const refLink = `https://t.me/${botMe.username}?start=${ctx.from.id}`;
        const shareText = `@bitcoinminingmyanmar_bot Bitcoin Bot !🔥\n\n🎁လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁လူ 10 ယောက်ခေါ် → +50000ကျပ် 🔥\n\nငါ့ရဲ့ Invite Link က ${refLink} ဖြစ်ပါတယ်`;

        const msg = `🙌🏻 သင့်စုစုပေါင်း ဖိတ်ခေါ်ထားသူ = ${user.referralCount} User(s)\n🙌🏻 သင့်ဖိတ်ခေါ်ရန် Link = ${refLink}\n\n🪢 ဖိတ်ခေါ်ပြီး 5000 ကျပ် ရယူနိုင်ပါသည်\n\n🟡 Bitcoin ငွေရှာ BOT အသစ် 🟡\n🔋 နေ့စဉ်ငွေရပြီး ငွေတန်းထုတ်နိုင်တယ်! 💯 မြန်မာနိုင်ငံတရားဝင် Bitcoin Bot !🔥\n\n🎁လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁လူ 10 ယောက်ခေါ် → +50000ကျပ်\n\n🔥သူငယ်ချင်းတွေရဲ့ ဝယ်ယူမှုတိုင်းအတွက် ကော်မရှင် 80% အထိရ\n✅သင့် Wave/KPay ဆီသို့ ငွေတန်းထုတ်နိုင်တယ်\n\n🎯 ငါ့လင့်ကနေ ဝင်ပြီး ဘောနပ် 5000ကျပ် ယူလိုက်ပါ`;

        await ctx.reply(msg, Markup.inlineKeyboard([
            [Markup.button.callback('👥 ဖိတ်ခေါ်ထားသောသူများ', 'my_refs')],
            [Markup.button.callback('🏆 Top List', 'top_list')],
            [Markup.button.switchToChat('🚀 Bot Link ကို Share ပါ', shareText)]
        ])).catch(() => {});
    } catch (e) {
        console.error("❌ referral error:", e);
    }
});

bot.action('my_refs', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user) return ctx.answerCbQuery();
        await ctx.reply(`👤 သင့်မှာ ဖိတ်ခေါ်ထားသူ ${user.referralCount} ဦး ရှိပါသည်။`).catch(() => {});
        await ctx.answerCbQuery();
    } catch (e) {
        console.error("❌ my_refs error:", e);
        await ctx.answerCbQuery();
    }
});

bot.action('top_list', async (ctx) => {
    try {
        const topUsers = await User.find().sort({ referralCount: -1 }).limit(10);
        let text = "🔥 <b>အကောင်းဆုံး Referral Users List</b> 🔥\n\n";
        topUsers.forEach((u, i) => { text += `${i + 1}. ${u.username || 'User'} : 👨 ${u.referralCount} ယောက်\n`; });
        await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.callback('🔙 နောက်သို့', 'back_to_menu')]) }).catch(() => {});
        await ctx.answerCbQuery();
    } catch (e) {
        console.error("❌ top_list error:", e);
        await ctx.answerCbQuery();
    }
});

bot.hears('🗂 Wallet', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user) return;
        await ctx.reply(`💡 သင့်လက်ရှိ Wallet နံပါတ်: ${user.wallet}\n\n💠 Wallet သတ်မှတ် / ပြင်ဆင် 💠 နှိပ်ပါ`, Markup.inlineKeyboard([[Markup.button.callback('💠 Wallet ပြင်ဆင်ပါ', 'set_wallet')]]));
    } catch (e) {
        console.error("❌ wallet error:", e);
    }
});

bot.action('set_wallet', async (ctx) => {
    try {
        await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'wait_wallet' } });
        await ctx.reply("✏️ Now Send Your Kpay/Wave Number and Name To Use It For Future Withdrawals").catch(() => {});
        await ctx.answerCbQuery();
    } catch (e) {
        console.error("❌ set_wallet error:", e);
        await ctx.answerCbQuery();
    }
});

bot.hears('🎁 Bonus', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user) return;
        const now = new Date();
        if (user.lastBonus && (now - user.lastBonus < 86400000)) {
            return ctx.reply("⏳ ၂၄ နာရီအတွင်း တစ်ကြိမ်သာ ရနိုင်ပါသည်။").catch(() => {});
        }
        const bonus = Math.floor(Math.random() * (10000 - 500 + 1)) + 500;

        // FIX #2: balance ကို $inc နဲ့ atomic update
        await User.updateOne(
            { tgId: ctx.from.id },
            { $inc: { balance: bonus }, $set: { lastBonus: now } }
        );

        await ctx.reply(`🎉 သင် ${bonus} ကျပ် ရရှိလိုက်ပြီ ဖြစ်ပါသည်။`).catch(() => {});
    } catch (e) {
        console.error("❌ bonus error:", e);
    }
});

// FIX #3: /cancel Command — User ရဲ့ stuck state ကို ရှင်းပေးသည်
bot.command('cancel', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user) return;

        if (user.state === 'none') {
            return ctx.reply("ℹ️ လက်ရှိ လုပ်ဆောင်နေသော အဆင့်မရှိပါ။").catch(() => {});
        }

        // Withdrawal process လက်ဆောင်ထားသော withdrawalId ရှိရင် cancel
        if (user.state === 'waiting_verification_screenshot' && user.tempData?.withdrawalId) {
            await Withdrawal.findByIdAndDelete(user.tempData.withdrawalId).catch(() => {});
        }

        await User.updateOne(
            { tgId: ctx.from.id },
            { $set: { state: 'none', tempData: {} } }
        );

        await ctx.reply("✅ လုပ်ဆောင်မှုကို ပယ်ဖျက်လိုက်ပါပြီ။ Main Menu သို့ ပြန်လာပါပြီ။", mainMenu).catch(() => {});
    } catch (e) {
        console.error("❌ /cancel error:", e);
    }
});

// ==================== ငွေထုတ်ခြင်း အဆင့်များ ====================
bot.hears('📤 ငွေထုတ်ယူရန်', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user) return;
        if (user.isBanned) return;

        let joined;
        try {
            joined = await isJoined(ctx);
        } catch (e) {
            if (e instanceof TelegramApiError) {
                console.error(`🔴 [withdraw] TelegramApiError: ${e.message}`);
                return ctx.reply("⚠️ Bot တွင် ယာယီချိတ်ဆက်မှု အခက်အခဲရှိနေပါသဖြင့် ခေတ္တစောင့်ဆိုင်းပြီးမှ ထပ်မံကြိုးစားကြည့်ပါခင်ဗျာ။").catch(() => {});
            }
            throw e;
        }
        if (!joined) {
            return ctx.reply("⚠️ ငွေထုတ်ယူရန်အတွက် Channel ၂ ခုလုံးကို Join ထားရပါမည်။").catch(() => {});
        }

        if (user.balance < 100000) {
            return ctx.reply("⚠ သင်ထုတ်ယူနိုင်ရန်အနည်းဆုံး 100,000 ကျပ် ရှိရပါမည်").catch(() => {});
        }

        await User.updateOne(
            { tgId: ctx.from.id },
            { $set: { state: 'withdraw_phone' } }
        );

        await ctx.reply("📱 ငွေထုတ်ယူမည့် Kpay/Wave ဖုန်းနံပါတ်ကို ပို့ပေးပါ (ဂဏန်းသီးသန့်) 👇\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ").catch(() => {});
    } catch (e) {
        console.error("❌ withdrawal start error:", e);
    }
});

// ==================== ADMIN COMMANDS ====================
bot.command('panel', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const total = await User.countDocuments();
        const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
        let msg = `👑 <b>Super Admin Panel</b>\n\n📊 Total Users: ${total}\n⏳ Pending Withdrawals: ${pendingWithdrawals}\n\n`;
        msg += `🔹 <code>/users [page]</code> - စာမျက်နှာအလိုက် user စာရင်း\n`;
        msg += `🔹 <code>/user [user_id]</code> - user အချက်အလက်ကြည့်\n`;
        msg += `🔹 <code>/add [user_id] [ငွေပမာဏ]</code> - ငွေတိုး\n`;
        msg += `🔹 <code>/sub [user_id] [ငွေပမာဏ]</code> - ငွေလျှော့\n`;
        msg += `🔹 <code>/addref [user_id] [အရေအတွက်]</code> - referral အရေအတွက်တိုး\n`;
        msg += `🔹 <code>/subref [user_id] [အရေအတွက်]</code> - referral လျှော့\n`;
        msg += `🔹 <code>/ban [user_id]</code> - ပိတ်ပင်မယ်\n`;
        msg += `🔹 <code>/unban [user_id]</code> - ပြန်ဖွင့်မယ်\n`;
        msg += `🔹 <code>/send [user_id] [စာသား]</code> - တစ်ဦးချင်းစာပို့\n`;
        msg += `🔹 <code>/sendbatch [အရေအတွက်(<=50)] [စာသား]</code> - နောက်ဆုံး active users ကို batch ပို့\n`;
        msg += `🔹 <code>/broadcast [စာသား]</code> - အားလုံးကိုပို့ (သတိထားပါ)\n`;
        msg += `🔹 <code>/withdrawals</code> - ဆိုင်းငံ့ထားသော ငွေထုတ်မှုများ\n`;
        await ctx.reply(msg, { parse_mode: 'HTML' });
    } catch (e) {
        console.error("❌ /panel error:", e);
    }
});

bot.command('users', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const args = ctx.message.text.split(' ');
        let page = 1;
        if (args.length > 1) page = parseInt(args[1]) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;
        const users = await User.find().skip(skip).limit(limit).sort({ tgId: 1 });
        const total = await User.countDocuments();
        let msg = `👥 <b>User List (Page ${page}/${Math.ceil(total / limit)})</b>\n\n`;
        users.forEach(u => {
            msg += `🆔 <code>${u.tgId}</code> | ${u.username || 'NoName'} | 💰${u.balance} | 👥${u.referralCount} | ${u.isBanned ? '🚫Banned' : '✅'}\n`;
        });
        await ctx.reply(msg, { parse_mode: 'HTML' });
    } catch (e) {
        console.error("❌ /users error:", e);
    }
});

bot.command('user', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply("⚠️ user_id ထည့်ပါ။\n/user 123456789");
        const userId = parseInt(args[1]);
        const user = await User.findOne({ tgId: userId });
        if (!user) return ctx.reply("❌ User not found.");
        const msg = `👤 <b>User Info</b>\n\n` +
            `🆔 ID: <code>${user.tgId}</code>\n` +
            `👤 Name: ${user.username || 'N/A'}\n` +
            `💰 Balance: ${user.balance.toLocaleString()} ကျပ်\n` +
            `👫 Referrals: ${user.referralCount}\n` +
            `🗂 Wallet: ${user.wallet}\n` +
            `🚫 Banned: ${user.isBanned ? 'Yes' : 'No'}\n` +
            `🎁 Referral Bonus Received: ${user.hasReceivedReferralBonus ? 'Yes' : 'No'}\n` +
            `📅 Last Bonus: ${user.lastBonus ? user.lastBonus.toLocaleString() : 'None'}\n` +
            `🕒 Last Active: ${user.lastActive ? user.lastActive.toLocaleString() : 'Never'}`;
        await ctx.reply(msg, { parse_mode: 'HTML' });
    } catch (e) {
        console.error("❌ /user error:", e);
    }
});

// FIX #2: /add command — $inc နဲ့ atomic balance update
bot.command('add', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const args = ctx.message.text.split(' ');
        if (args.length < 3) return ctx.reply("⚠️ /add [user_id] [ငွေပမာဏ]");
        const userId = parseInt(args[1]);
        const amount = parseInt(args[2]);
        if (isNaN(amount) || amount <= 0) return ctx.reply("❌ ငွေပမာဏ မှားယွင်းနေပါသည်။");

        const updatedUser = await User.findOneAndUpdate(
            { tgId: userId },
            { $inc: { balance: amount } },
            { new: true }
        );
        if (!updatedUser) return ctx.reply("❌ User not found.");

        await ctx.reply(`✅ User ${userId} ကို ${amount} ကျပ် ပေါင်းထည့်ပြီးပါပြီ။ လက်ကျန်: ${updatedUser.balance.toLocaleString()}`);
        try {
            await bot.telegram.sendMessage(userId, `💰 သင့်အကောင့်ထဲသို့ ${amount} ကျပ် ပေါင်းထည့်လိုက်ပါသည်။ လက်ကျန်: ${updatedUser.balance.toLocaleString()}`);
        } catch (e) {}
    } catch (e) {
        console.error("❌ /add error:", e);
    }
});

// FIX #2: /sub command — $inc (negative) နဲ့ atomic balance update
bot.command('sub', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const args = ctx.message.text.split(' ');
        if (args.length < 3) return ctx.reply("⚠️ /sub [user_id] [ငွေပမာဏ]");
        const userId = parseInt(args[1]);
        const amount = parseInt(args[2]);
        if (isNaN(amount) || amount <= 0) return ctx.reply("❌ ငွေပမာဏ မှားယွင်းနေပါသည်။");

        const user = await User.findOne({ tgId: userId });
        if (!user) return ctx.reply("❌ User not found.");
        if (user.balance < amount) return ctx.reply("❌ User ရဲ့လက်ကျန်မလုံလောက်ပါ။");

        const updatedUser = await User.findOneAndUpdate(
            { tgId: userId },
            { $inc: { balance: -amount } },
            { new: true }
        );

        await ctx.reply(`✅ User ${userId} ထံမှ ${amount} ကျပ် နုတ်ယူပြီးပါပြီ။ လက်ကျန်: ${updatedUser.balance.toLocaleString()}`);
        try {
            await bot.telegram.sendMessage(userId, `💸 သင့်အကောင့်မှ ${amount} ကျပ် နုတ်ယူလိုက်ပါသည်။ လက်ကျန်: ${updatedUser.balance.toLocaleString()}`);
        } catch (e) {}
    } catch (e) {
        console.error("❌ /sub error:", e);
    }
});

// FIX #2: /addref command — $inc နဲ့ atomic referralCount update
bot.command('addref', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const args = ctx.message.text.split(' ');
        if (args.length < 3) return ctx.reply("⚠️ /addref [user_id] [အရေအတွက်]");
        const userId = parseInt(args[1]);
        const count = parseInt(args[2]);
        if (isNaN(count) || count <= 0) return ctx.reply("❌ အရေအတွက် မှားယွင်းနေပါသည်။");

        const updatedUser = await User.findOneAndUpdate(
            { tgId: userId },
            { $inc: { referralCount: count } },
            { new: true }
        );
        if (!updatedUser) return ctx.reply("❌ User not found.");

        await ctx.reply(`✅ User ${userId} ၏ referral count ကို ${count} တိုးပြီးပါပြီ။ စုစုပေါင်း: ${updatedUser.referralCount}`);
        try {
            await bot.telegram.sendMessage(userId, `👥 သင့်ရဲ့ referral အရေအတွက် ${count} တိုးလာပါသည်။ စုစုပေါင်း: ${updatedUser.referralCount}`);
        } catch (e) {}
    } catch (e) {
        console.error("❌ /addref error:", e);
    }
});

// FIX #2: /subref command — $inc (negative) နဲ့ atomic referralCount update
bot.command('subref', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const args = ctx.message.text.split(' ');
        if (args.length < 3) return ctx.reply("⚠️ /subref [user_id] [အရေအတွက်]");
        const userId = parseInt(args[1]);
        const count = parseInt(args[2]);
        if (isNaN(count) || count <= 0) return ctx.reply("❌ အရေအတွက် မှားယွင်းနေပါသည်။");

        const user = await User.findOne({ tgId: userId });
        if (!user) return ctx.reply("❌ User not found.");
        if (user.referralCount < count) return ctx.reply("❌ User ရဲ့ referral count မလုံလောက်ပါ။");

        const updatedUser = await User.findOneAndUpdate(
            { tgId: userId },
            { $inc: { referralCount: -count } },
            { new: true }
        );

        await ctx.reply(`✅ User ${userId} ၏ referral count ကို ${count} လျှော့ပြီးပါပြီ။ စုစုပေါင်း: ${updatedUser.referralCount}`);
        try {
            await bot.telegram.sendMessage(userId, `👥 သင့်ရဲ့ referral အရေအတွက် ${count} လျှော့ချခံရပါသည်။ စုစုပေါင်း: ${updatedUser.referralCount}`);
        } catch (e) {}
    } catch (e) {
        console.error("❌ /subref error:", e);
    }
});

bot.command('ban', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply("⚠️ /ban [user_id]");
        const userId = parseInt(args[1]);
        const user = await User.findOne({ tgId: userId });
        if (!user) return ctx.reply("❌ User not found.");
        if (user.isBanned) return ctx.reply("✅ User already banned.");

        await User.updateOne(
            { tgId: userId },
            { $set: { isBanned: true, state: 'none', tempData: {} } }
        );

        await ctx.reply(`🚫 User ${userId} ကို ban လိုက်ပါပြီ။`);
        try { await bot.telegram.sendMessage(userId, "🚫 သင်သည် စည်းကမ်းဖောက်ဖျက်မှုကြောင့် အသုံးပြုခွင့် ပိတ်ပင်ခံထားရပါသည်။"); } catch (e) {}
    } catch (e) {
        console.error("❌ /ban error:", e);
    }
});

bot.command('unban', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply("⚠️ /unban [user_id]");
        const userId = parseInt(args[1]);
        const user = await User.findOne({ tgId: userId });
        if (!user) return ctx.reply("❌ User not found.");
        if (!user.isBanned) return ctx.reply("✅ User is not banned.");

        await User.updateOne({ tgId: userId }, { $set: { isBanned: false } });

        await ctx.reply(`✅ User ${userId} ကို unban လိုက်ပါပြီ။`);
        try { await bot.telegram.sendMessage(userId, "✅ သင့်အကောင့်ကို ပြန်လည်အသုံးပြုခွင့်ပေးလိုက်ပါပြီ။"); } catch (e) {}
    } catch (e) {
        console.error("❌ /unban error:", e);
    }
});

bot.command('send', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const text = ctx.message.text;
        const firstSpace = text.indexOf(' ');
        if (firstSpace === -1) return ctx.reply("⚠️ /send [user_id] [message]");
        const rest = text.substring(firstSpace + 1).trim();
        const secondSpace = rest.indexOf(' ');
        if (secondSpace === -1) return ctx.reply("⚠️ /send [user_id] [message]");
        const userIdStr = rest.substring(0, secondSpace);
        const msgText = rest.substring(secondSpace + 1).trim();
        const userId = parseInt(userIdStr);
        if (isNaN(userId)) return ctx.reply("❌ user_id မှားယွင်းနေပါသည်။");
        const user = await User.findOne({ tgId: userId });
        if (!user) return ctx.reply("❌ User not found.");
        try {
            await bot.telegram.sendMessage(userId, msgText);
            await ctx.reply(`✅ Message sent to ${userId}`);
        } catch (e) {
            await ctx.reply(`❌ Failed to send: ${e.message}`);
        }
    } catch (e) {
        console.error("❌ /send error:", e);
    }
});

bot.command('sendbatch', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const text = ctx.message.text;
        const firstSpace = text.indexOf(' ');
        if (firstSpace === -1) return ctx.reply("⚠️ /sendbatch [count] [message]");
        const rest = text.substring(firstSpace + 1).trim();
        const secondSpace = rest.indexOf(' ');
        if (secondSpace === -1) return ctx.reply("⚠️ /sendbatch [count] [message]");
        const countStr = rest.substring(0, secondSpace);
        const msgText = rest.substring(secondSpace + 1).trim();
        const count = parseInt(countStr);
        if (isNaN(count) || count < 1 || count > 50) return ctx.reply("❌ count သည် 1 နှင့် 50 ကြားဖြစ်ရပါမည်။");

        const users = await User.find({ isBanned: false }).sort({ lastActive: -1 }).limit(count);
        if (users.length === 0) return ctx.reply("❌ No active users found.");

        await ctx.reply(`📨 စတင် batch ပို့နေပါသည်... (ဦးရေ: ${users.length})`);
        let success = 0, fail = 0;
        for (const u of users) {
            try {
                await bot.telegram.sendMessage(u.tgId, msgText);
                success++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {
                fail++;
            }
        }
        await ctx.reply(`✅ Batch send complete.\n✅ Success: ${success}\n❌ Failed: ${fail}`);
    } catch (e) {
        console.error("❌ /sendbatch error:", e);
    }
});

bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const msgText = ctx.message.text.split('/broadcast ')[1];
        if (!msgText) return ctx.reply("⚠️ စာသားထည့်ပါ။");
        const users = await User.find({ isBanned: false });
        await ctx.reply(`📨 စတင် broadcast ပို့နေပါသည်... (ဦးရေ: ${users.length})`);
        let success = 0, fail = 0;
        for (const u of users) {
            try {
                await bot.telegram.sendMessage(u.tgId, msgText);
                success++;
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (e) {
                fail++;
            }
        }
        await ctx.reply(`✅ Broadcast done.\n✅ Success: ${success}\n❌ Failed: ${fail}`);
    } catch (e) {
        console.error("❌ /broadcast error:", e);
    }
});

bot.command('withdrawals', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const pending = await Withdrawal.find({ status: 'pending' }).sort({ createdAt: -1 });
        if (pending.length === 0) return ctx.reply("✅ ဆိုင်းငံ့ငွေထုတ်မှု မရှိပါ။");
        let msg = `⏳ **ဆိုင်းငံ့ငွေထုတ်မှုများ** (${pending.length})\n\n`;
        pending.forEach((w, i) => {
            msg += `${i + 1}. ID: ${w.userId} | ${w.name} | ${w.amount} ကျပ် | ${new Date(w.createdAt).toLocaleString()}\n`;
        });
        await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error("❌ /withdrawals error:", e);
    }
});

// ==================== WITHDRAWAL APPROVAL SYSTEM ====================

bot.action(/^approve_withdraw_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const withdrawId = ctx.match[1];
        const withdrawal = await Withdrawal.findById(withdrawId);
        if (!withdrawal) return ctx.answerCbQuery("❌ ငွေထုတ်မှုမတွေ့ပါ။");
        if (withdrawal.status !== 'pending') return ctx.answerCbQuery("✅ ဒီငွေထုတ်မှုကို လုပ်ပြီးသားပါ။");

        withdrawal.status = 'approved';
        withdrawal.reviewedAt = new Date();
        withdrawal.reviewedBy = ctx.from.id;
        await withdrawal.save();

        const totalAmount = withdrawal.amount + 3000;
        try {
            await bot.telegram.sendMessage(withdrawal.userId,
                `လူကြီးမင်း ထုတ်ယူထားသော ငွေပမာဏနှင့် Verification Fee စုစုပေါင်း ${totalAmount.toLocaleString()} ကျပ် ကို လူကြီးမင်း၏ Kpay/Wave အကောင့်ထဲသို့ အောင်မြင်စွာ လွှဲပြောင်းပေးလိုက်ပါပြီ။ ပြေစာ (Receipt) ကိုလည်း အခုပဲ ပူးတွဲပို့ပေးလိုက်ပါတယ်ဗျာ။\n\n` +
                `ကျွန်တော်တို့ Bitcoin Mining Myanmar နဲ့အတူ အလုပ်ကြိုးစားပေးတဲ့အတွက် ကျေးဇူးအထူးတင်ရှိပါတယ်။ မိတ်ဆွေတို့ရဲ့ သူငယ်ချင်းတွေကိုလည်း ထပ်မံဖိတ်ခေါ်ပြီး ဝင်ငွေတွေ အများကြီး ထပ်ရှာလိုက်ဦးနော်။ 🚀💰\n\n` +
                `နောက်တစ်ကြိမ် ငွေထုတ်ယူမှုမှာလည်း အခုလိုပဲ အမြန်ဆုံး ဝန်ဆောင်မှုပေးသွားပါဦးမယ်ခင်ဗျာ။ ကျေးဇူးတင်ပါတယ်! 🙏🎉`
            );
        } catch (e) {}

        await ctx.editMessageCaption(`✅ ငွေထုတ်မှု အတည်ပြုပြီးပါပြီ။\nUser: ${withdrawal.userId}\nငွေပမာဏ: ${withdrawal.amount.toLocaleString()} ကျပ်`, {
            reply_markup: { inline_keyboard: [] }
        }).catch(() => {});
        await ctx.answerCbQuery("✅ အတည်ပြုပြီးပါပြီ။");
    } catch (e) {
        console.error("❌ approve_withdraw error:", e);
        await ctx.answerCbQuery("❌ Error ဖြစ်သွားပါသည်။").catch(() => {});
    }
});

bot.action(/^reject_withdraw_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const withdrawId = ctx.match[1];
        const withdrawal = await Withdrawal.findById(withdrawId);
        if (!withdrawal) return ctx.answerCbQuery("❌ ငွေထုတ်မှုမတွေ့ပါ။");
        if (withdrawal.status !== 'pending') return ctx.answerCbQuery("✅ ဒီငွေထုတ်မှုကို လုပ်ပြီးသားပါ။");

        if (!global.pendingRejects) global.pendingRejects = new Map();
        global.pendingRejects.set(ctx.from.id, withdrawId);

        await ctx.reply("ငြင်းပယ်ရသည့် အကြောင်းရင်းကို ရိုက်ထည့်ပါ။ (ဥပမာ - NRC မှားနေသည်)");
        await ctx.answerCbQuery();
    } catch (e) {
        console.error("❌ reject_withdraw error:", e);
        await ctx.answerCbQuery("❌ Error ဖြစ်သွားပါသည်။").catch(() => {});
    }
});

// ==================== GLOBAL MESSAGE HANDLER ====================

if (!global.pendingRejects) global.pendingRejects = new Map();

bot.on('message', async (ctx) => {
    try {
        // Update last active (await မပါဘဲ background မှာ run ပေး)
        User.updateOne({ tgId: ctx.from.id }, { $set: { lastActive: new Date() } }).catch(() => {});

        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;

        // ---------- Handle Admin Reject Reason ----------
        if (isAdmin(ctx) && global.pendingRejects.has(ctx.from.id)) {
            const withdrawId = global.pendingRejects.get(ctx.from.id);
            const reason = ctx.message.text;
            if (!reason) {
                return ctx.reply("ကျေးဇူးပြု၍ စာသားဖြင့် အကြောင်းရင်းရိုက်ထည့်ပါ။");
            }
            global.pendingRejects.delete(ctx.from.id);

            const withdrawal = await Withdrawal.findById(withdrawId);
            if (!withdrawal) return ctx.reply("❌ ငွေထုတ်မှုမတွေ့ပါ။");
            if (withdrawal.status !== 'pending') return ctx.reply("✅ ဒီငွေထုတ်မှုကို လုပ်ပြီးသားပါ။");

            // FIX #2: Refund ကို $inc နဲ့ atomic update
            if (withdrawal.amountDeducted) {
                await User.updateOne(
                    { tgId: withdrawal.userId },
                    { $inc: { balance: withdrawal.amount } }
                );
                console.log(`💰 Refunded ${withdrawal.amount} to user ${withdrawal.userId}`);
            }

            withdrawal.status = 'rejected';
            withdrawal.reviewedAt = new Date();
            withdrawal.reviewedBy = ctx.from.id;
            withdrawal.rejectReason = reason;
            await withdrawal.save();

            try {
                await bot.telegram.sendMessage(withdrawal.userId,
                    `❌ သင့်ငွေထုတ်မှုကို ငြင်းပယ်လိုက်ပါသည်။\n` +
                    `အကြောင်းရင်း: ${reason}\n\n` +
                    `ငွေထုတ်မှုအတွက် နုတ်ထားသော ငွေပမာဏ ${withdrawal.amount.toLocaleString()} ကျပ်ကို သင့်အကောင့်ထဲသို့ ပြန်လည်ပေါင်းထည့်ပေးလိုက်ပါပြီ။`
                );
            } catch (e) {}

            await ctx.reply(`✅ ငွေထုတ်မှု ငြင်းပယ်ပြီးပါပြီ။\nUser: ${withdrawal.userId}\nအကြောင်းရင်း: ${reason}\n💰 ငွေပြန်ပေါင်းပြီးပါပြီ။`);
            return;
        }

        // ---------- Wallet Setting ----------
        if (user.state === 'wait_wallet') {
            const walletText = ctx.message.text;
            if (!walletText) return ctx.reply("⚠️ စာသားဖြင့် ထည့်သွင်းပါ။");
            await User.updateOne(
                { tgId: ctx.from.id },
                { $set: { wallet: walletText, state: 'none' } }
            );
            return ctx.reply(`✅ Wallet သတ်မှတ်လိုက်ပါပြီ : ${walletText}`);
        }

        // ---------- Withdrawal Process ----------

        // FIX #3: /cancel hint ကို withdraw process ထဲ ထည့်ပေးသည်
        if (user.state === 'withdraw_phone') {
            if (!ctx.message.text || !/^\d+$/.test(ctx.message.text)) {
                return ctx.reply("⚠️ နံပါတ်သီးသန့်သာ ထည့်ပေးပါ။\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ");
            }
            await User.updateOne(
                { tgId: ctx.from.id },
                { $set: { state: 'withdraw_name', tempData: { phone: ctx.message.text } } }
            );
            return ctx.reply("👤 Kpay/Wave အကောင့်နာမည်ကို ပို့ပေးပါ 👇\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ");
        }

        if (user.state === 'withdraw_name') {
            if (!ctx.message.text) return ctx.reply("⚠️ နာမည် ရိုက်ထည့်ပေးပါ။");
            await User.updateOne(
                { tgId: ctx.from.id },
                { $set: { state: 'withdraw_amount', tempData: { ...user.tempData, name: ctx.message.text } } }
            );
            return ctx.reply("💵 ထုတ်ယူလိုသော ပမာဏကို ရိုက်ထည့်ပါ 👇\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ");
        }

        if (user.state === 'withdraw_amount') {
            const amt = parseInt(ctx.message.text);
            if (isNaN(amt) || amt < 100000) {
                return ctx.reply("❌ ပမာဏ မှားယွင်းနေပါသည်။ အနည်းဆုံး 100,000 ကျပ် ဖြစ်ရပါမည်။\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ");
            }
            if (amt > user.balance) {
                return ctx.reply("❌ သင့်လက်ကျန်ငွေ မလုံလောက်ပါ။\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ");
            }
            await User.updateOne(
                { tgId: ctx.from.id },
                { $set: { state: 'withdraw_nrc_front', tempData: { ...user.tempData, amt: amt } } }
            );
            return ctx.reply("📸 မှတ်ပုံတင် 'အရှေ့ဘက်' ဓာတ်ပုံ ပို့ပေးပါ 👇\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ");
        }

        if (user.state === 'withdraw_nrc_front') {
            if (!ctx.message.photo) {
                return ctx.reply("⚠️ ဓာတ်ပုံ ပို့ပေးပါ။\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ");
            }
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            await User.updateOne(
                { tgId: ctx.from.id },
                { $set: { state: 'withdraw_nrc_back', tempData: { ...user.tempData, front: photo.file_id } } }
            );
            return ctx.reply("📸 မှတ်ပုံတင် 'အနောက်ဘက်' ဓာတ်ပုံ ပို့ပေးပါ 👇\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ");
        }

        if (user.state === 'withdraw_nrc_back') {
            if (!ctx.message.photo) {
                return ctx.reply("⚠️ ဓာတ်ပုံ ပို့ပေးပါ။\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ");
            }
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const data = user.tempData;

            const withdrawal = new Withdrawal({
                userId: user.tgId,
                username: user.username,
                phone: data.phone,
                name: data.name,
                amount: data.amt,
                nrcFront: data.front,
                nrcBack: photo.file_id,
                amountDeducted: false
            });
            await withdrawal.save();

            await User.updateOne(
                { tgId: ctx.from.id },
                { $set: { state: 'waiting_verification_screenshot', tempData: { withdrawalId: withdrawal._id } } }
            );

            await ctx.reply(
                `မှတ်ပုံတင် အချက်အလက်များကို လက်ခံရရှိပါပြီ။ ✅\n\n` +
                `လူကြီးမင်းအနေနဲ့ Referral အတု (သို့မဟုတ်) Bot အသုံးပြုသူ မဟုတ်ကြောင်း အတည်ပြုနိုင်ရန်အတွက် ပေးထားသော Kpay - 09783646736 (Yee Moon Naing) ထံသို့ Verification Fee ၃,၀၀၀ ကျပ် အရင်လွှဲပေးရပါမည်။ 💸\n\n` +
                `ငွေလွှဲပြီးပါက ပြေစာ (Screenshot) ကို ပို့ပေးပါ။ Admin ဘက်မှ အတည်ပြုပြီးသည်နှင့် လူကြီးမင်း ထုတ်ယူထားသော ငွေပမာဏ (၁၀၀,၀၀၀ ကျပ် + ၃,၀၀၀ ကျပ်) စုစုပေါင်းကို ၁ မိနစ်အတွင်း လူကြီးမင်းဆီသို့ ပြန်လည် လွှဲပြောင်းပေးသွားမည် ဖြစ်ပါသည်။ ✨\n\n` +
                `❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ`
            );

            const caption = `🆕 **ငွေထုတ်မှုအသစ် (Verification Fee စောင့်ဆိုင်း)**\n\n` +
                `🆔 User ID: ${user.tgId}\n` +
                `👤 Name: ${data.name}\n` +
                `📞 Phone: ${data.phone}\n` +
                `💵 Amount: ${data.amt.toLocaleString()} ကျပ်\n` +
                `🕒 Time: ${new Date().toLocaleString()}`;

            try {
                await bot.telegram.sendPhoto(LOG_GROUP_ID, data.front, {
                    caption: caption,
                    parse_mode: 'Markdown'
                });
                await bot.telegram.sendPhoto(LOG_GROUP_ID, photo.file_id, { caption: "NRC အနောက်ဘက်" });
            } catch (e) {
                console.error("Failed to send withdrawal to log group:", e);
            }
            return;
        }

        // ---------- Verification Screenshot ----------
        if (user.state === 'waiting_verification_screenshot') {
            if (!ctx.message.photo) {
                return ctx.reply("⚠️ ငွေလွှဲပြေစာ Screenshot ကို ဓာတ်ပုံဖြင့်သာ ပို့ပေးပါ။\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ");
            }

            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const withdrawalId = user.tempData?.withdrawalId;

            if (!withdrawalId) {
                await User.updateOne(
                    { tgId: ctx.from.id },
                    { $set: { state: 'none', tempData: {} } }
                );
                return ctx.reply("❌ အမှားဖြစ်သွားပါသည်။ ငွေထုတ်ခြင်းကို ပြန်စပါ။");
            }

            const withdrawal = await Withdrawal.findById(withdrawalId);
            if (!withdrawal) {
                await User.updateOne(
                    { tgId: ctx.from.id },
                    { $set: { state: 'none', tempData: {} } }
                );
                return ctx.reply("❌ ငွေထုတ်မှုမှတ်တမ်း မတွေ့ပါ။");
            }

            // Re-check balance မထုတ်ခင် (double safety check)
            if (user.balance < withdrawal.amount) {
                await User.updateOne(
                    { tgId: ctx.from.id },
                    { $set: { state: 'none', tempData: {} } }
                );
                return ctx.reply("❌ သင့်လက်ကျန်ငွေ မလုံလောက်ပါ။ ငွေထုတ်ခြင်းကို ပယ်ဖျက်လိုက်ပါသည်။");
            }

            // FIX #2: Balance နုတ်ခြင်းကို $inc (atomic) နဲ့ လုပ်သည်
            await User.updateOne(
                { tgId: ctx.from.id },
                {
                    $inc: { balance: -withdrawal.amount },
                    $set: { state: 'none', tempData: {} }
                }
            );

            withdrawal.verificationScreenshot = photo.file_id;
            withdrawal.amountDeducted = true;
            await withdrawal.save();

            await ctx.reply(
                `ငွေလွှဲပြေစာ (Screenshot) ကို လက်ခံရရှိပါပြီ။ ✅\n\n` +
                `သင့်အကောင့်မှ ထုတ်ယူမည့်ငွေ ${withdrawal.amount.toLocaleString()} ကျပ်ကို နုတ်ယူထားပါသည်။\n\n` +
                `လူကြီးမင်းရဲ့ အချက်အလက်တွေနဲ့ ငွေလွှဲမှုကို Admin ဘက်က အမြန်ဆုံး စစ်ဆေးနေပါတယ်ဗျ။ အတည်ပြုပြီးတာနဲ့ လူကြီးမင်း ထုတ်ယူထားတဲ့ ငွေပမာဏနဲ့ Verification Fee စုစုပေါင်း (၁၀၃,၀၀၀ ကျပ်) ကို လူကြီးမင်းရဲ့ Kpay/Wave ဆီကို ၁ မိနစ်အတွင်း လွှဲပေးတော့မှာ ဖြစ်ပါတယ်။ 💸✨\n\n` +
                `ခေတ္တခဏလေး သည်းခံစောင့်ဆိုင်းပေးပါဦးနော်။ ကျွန်တော်တို့ရဲ့ Bitcoin Mining Myanmar ကို ယုံကြည်စွာ အသုံးပြုပေးတဲ့အတွက် ကျေးဇူးအထူးတင်ပါတယ်ခင်ဗျာ။ 🙏`
            );

            try {
                await bot.telegram.sendPhoto(LOG_GROUP_ID, photo.file_id, {
                    caption: `🆕 **Verification Fee Screenshot**\n\n` +
                        `User ID: ${user.tgId}\n` +
                        `Withdrawal ID: ${withdrawal._id}\n` +
                        `ငွေထုတ်ပမာဏ: ${withdrawal.amount.toLocaleString()} ကျပ်\n` +
                        `💰 ငွေနုတ်ပြီးပါပြီ။`,
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback('✅ Approve', `approve_withdraw_${withdrawal._id}`),
                            Markup.button.callback('❌ Reject', `reject_withdraw_${withdrawal._id}`)
                        ]
                    ])
                });
            } catch (e) {
                console.error("Failed to send verification screenshot to log group:", e);
            }
            return;
        }

        // ---------- Forward other messages to LOG_GROUP_ID ----------
        if (user.state === 'none') {
            try {
                const message = ctx.message;
                const forwardedMsg = `📨 **User Message Forward**\n\n` +
                    `🆔 User ID: ${user.tgId}\n` +
                    `👤 Username: ${user.username || 'N/A'}\n` +
                    `💬 Message: ${message.text || '(non-text)'}`;
                if (message.text) {
                    await bot.telegram.sendMessage(LOG_GROUP_ID, forwardedMsg, { parse_mode: 'Markdown' });
                } else if (message.photo) {
                    await bot.telegram.sendPhoto(LOG_GROUP_ID, message.photo[message.photo.length - 1].file_id, {
                        caption: forwardedMsg,
                        parse_mode: 'Markdown'
                    });
                } else if (message.video) {
                    await bot.telegram.sendVideo(LOG_GROUP_ID, message.video.file_id, { caption: forwardedMsg });
                } else if (message.document) {
                    await bot.telegram.sendDocument(LOG_GROUP_ID, message.document.file_id, { caption: forwardedMsg });
                } else {
                    await bot.telegram.sendMessage(LOG_GROUP_ID, forwardedMsg);
                }
            } catch (e) {
                console.error("Failed to forward message to log group:", e);
            }
        }

    } catch (e) {
        console.error("❌ Message handler error:", e);
    }
});

bot.action('back_to_menu', async (ctx) => {
    try {
        try { await ctx.deleteMessage(); } catch (e) {}
        await ctx.reply("🏡 မင်္ဂလာပါ! Main Menu မှာ ရွေးချယ်ပါ ✨", mainMenu);
    } catch (e) {
        console.error("❌ back_to_menu error:", e);
    }
});

bot.launch().then(() => console.log("🚀 Bot is Live and Fully Functional!"));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
