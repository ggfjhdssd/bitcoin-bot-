require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const path = require('path');

// ═══════════════════════════════════════════════════════════════
//   EXPRESS SETUP
// ═══════════════════════════════════════════════════════════════
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ═══════════════════════════════════════════════════════════════
//   BOT + CONFIG
// ═══════════════════════════════════════════════════════════════
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = String(process.env.ADMIN_ID || '').trim();
const LOG_GROUP_ID = process.env.LOG_GROUP_ID;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://kyawngarrapp.vercel.app';

// ═══════════════════════════════════════════════════════════════
//   MONGODB
// ═══════════════════════════════════════════════════════════════
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Database Connected!'))
    .catch(err => { console.error('❌ DB Error:', err); process.exit(1); });

// ── Schemas ────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
    tgId:           { type: Number, unique: true },
    username:       String,
    balance:        { type: Number, default: 0 },
    referredBy:     { type: Number, default: null },
    referralCount:  { type: Number, default: 0 },
    wallet:         { type: String, default: '⛔ မသတ်မှတ်ရသေးပါ' },
    lastBonus:      { type: Date,   default: null },
    lastSpin:       { type: Date,   default: null },
    isBanned:       { type: Boolean, default: false },
    state:          { type: String, default: 'none' },
    tempData:       { type: Object, default: {} },
    lastActive:     { type: Date,   default: Date.now },
    hasReceivedReferralBonus: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

const configSchema = new mongoose.Schema({
    key:   { type: String, unique: true },
    value: mongoose.Schema.Types.Mixed
});
const Config = mongoose.model('Config', configSchema);

const withdrawalSchema = new mongoose.Schema({
    userId:     Number,
    username:   String,
    phone:      String,
    name:       String,
    amount:     Number,
    nrcFront:   String,
    nrcBack:    String,
    status:     { type: String, default: 'pending' },
    createdAt:  { type: Date, default: Date.now },
    reviewedAt: Date,
    reviewedBy: Number,
    rejectReason: String,
    verificationScreenshot: String,
    amountDeducted: { type: Boolean, default: false }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// ── Config helpers ─────────────────────────────────────────────
async function getCfg(key, def) {
    const doc = await Config.findOne({ key });
    return doc ? doc.value : def;
}
async function setCfg(key, value) {
    await Config.findOneAndUpdate({ key }, { value }, { upsert: true });
}

// ═══════════════════════════════════════════════════════════════
//   CORS
// ═══════════════════════════════════════════════════════════════
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// ═══════════════════════════════════════════════════════════════
//   API ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// ── GET USER INFO ──────────────────────────────────────────────
app.post('/api/get-user', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });
        const user = await User.findOne({ tgId: Number(userId) });
        if (!user) return res.json({ balance: 0, referralCount: 0, wallet: '', lastSpin: null });
        res.json({
            balance:       user.balance,
            referralCount: user.referralCount,
            wallet:        user.wallet,
            lastSpin:      user.lastSpin,
            username:      user.username,
        });
    } catch (e) {
        console.error('❌ /api/get-user:', e);
        res.status(500).json({ error: 'Internal Error' });
    }
});

// ── REWARD USER (Ad watch) ─────────────────────────────────────
app.post('/api/reward-user', async (req, res) => {
    try {
        const { userId, slot } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });
        const rewardAmt = await getCfg(`task${slot || 1}_reward`, 500);
        const updated = await User.findOneAndUpdate(
            { tgId: Number(userId) },
            { $inc: { balance: rewardAmt } },
            { new: true }
        );
        if (!updated) return res.status(404).json({ error: 'User not found' });
        try {
            await bot.telegram.sendMessage(userId,
                `💰 ကြော်ငြာ (Task ${slot || 1}) ကြည့်ရှုမှုအတွက် ${rewardAmt.toLocaleString()} ကျပ် လက်ခံရရှိပါပြီ! 🎉`
            );
        } catch (e) {}
        res.json({ success: true, newBalance: updated.balance, rewardAmt });
    } catch (e) {
        console.error('❌ /api/reward-user:', e);
        res.status(500).json({ error: 'Internal Error' });
    }
});

// ── TASK CONFIG (for frontend) ─────────────────────────────────
app.get('/api/task-config', async (req, res) => {
    try {
        const [r1, r2, r3, r4, vpnOpen] = await Promise.all([
            getCfg('task1_reward', 500),
            getCfg('task2_reward', 500),
            getCfg('task3_reward', 500),
            getCfg('task4_reward', 500),
            getCfg('vpn_note_open', true),
        ]);
        res.json({ rewards: [r1, r2, r3, r4], vpnNoteOpen: vpnOpen });
    } catch (e) {
        res.status(500).json({ error: 'Internal Error' });
    }
});

// ── LEGACY reward endpoint ─────────────────────────────────────
app.all('/reward-user', async (req, res) => {
    const userId = req.query.userId || req.body.userId;
    if (!userId) return res.status(400).send('User ID required');
    try {
        const updated = await User.findOneAndUpdate(
            { tgId: Number(userId) },
            { $inc: { balance: 500 } },
            { new: true }
        );
        if (!updated) return res.status(404).send('User not found');
        try { await bot.telegram.sendMessage(userId, '💰 ကြော်ငြာကြည့်ရှုမှုအတွက် ၅၀၀ ကျပ် လက်ခံရရှိပါတယ်!'); } catch (e) {}
        res.json({ success: true, newBalance: updated.balance });
    } catch (e) {
        res.status(500).send('Internal Error');
    }
});

// ── LEGACY get-balance ─────────────────────────────────────────
app.post('/get-balance', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });
        const user = await User.findOne({ tgId: userId });
        res.json({ balance: user ? user.balance : 0 });
    } catch (e) {
        res.status(500).json({ error: 'Internal Error' });
    }
});

// ── DAILY SPIN ─────────────────────────────────────────────────
const SPIN_PRIZES = [100, 50, 200, 300, 500, 50, 100, 200];

function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth()    === d2.getMonth()    &&
           d1.getDate()     === d2.getDate();
}

app.post('/api/spin', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });
        const user = await User.findOne({ tgId: Number(userId) });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.isBanned) return res.status(403).json({ error: 'Banned' });
        if (user.lastSpin && isSameDay(new Date(user.lastSpin), new Date())) {
            return res.json({ success: false, error: 'already_spun' });
        }
        const weights = [15, 20, 15, 10, 8, 20, 7, 5];
        const totalW = weights.reduce((a, b) => a + b, 0);
        let rand = Math.random() * totalW;
        let prizeIndex = 0;
        for (let i = 0; i < weights.length; i++) {
            rand -= weights[i];
            if (rand <= 0) { prizeIndex = i; break; }
        }
        const prize = SPIN_PRIZES[prizeIndex];
        const updated = await User.findOneAndUpdate(
            { tgId: Number(userId) },
            { $inc: { balance: prize }, $set: { lastSpin: new Date() } },
            { new: true }
        );
        try {
            await bot.telegram.sendMessage(userId,
                `🎰 Spin Wheel ဆုကြေး!\n\n🎉 ${prize} MMK ရရှိပါပြီ!\n💰 လက်ကျန်ငွေ: ${updated.balance.toLocaleString()} MMK`
            );
        } catch (e) {}
        res.json({ success: true, prize, newBalance: updated.balance });
    } catch (e) {
        console.error('❌ /api/spin:', e);
        res.status(500).json({ error: 'Internal Error' });
    }
});

// ── Start server ───────────────────────────────────────────────
app.listen(port, () => console.log(`✅ Server listening on port ${port}`));

// ═══════════════════════════════════════════════════════════════
//   TELEGRAM BOT
// ═══════════════════════════════════════════════════════════════

const CHANNELS = ['@Bitcoinmyanmarmining', '@BitCoinMyan'];

const joinCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [id, data] of joinCache.entries()) {
        if (now >= data.expiresAt) joinCache.delete(id);
    }
}, 10 * 60 * 1000);

const RETRYABLE_CODES = new Set(['ETIMEDOUT','ECONNRESET','ENOTFOUND','ECONNREFUSED','EAI_AGAIN']);
async function withRetry(fn, retries = 3, baseDelay = 1000) {
    let lastError;
    for (let i = 1; i <= retries; i++) {
        try { return await fn(); }
        catch (e) {
            lastError = e;
            const net = RETRYABLE_CODES.has(e.code) ||
                (e.message && (e.message.includes('ETIMEDOUT') || e.message.includes('socket hang up')));
            if (!net || i === retries) break;
            const delay = baseDelay * Math.pow(2, i - 1);
            console.warn(`⚠️ [Retry ${i}/${retries}] ${e.code || e.message} — ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw new Error(`Telegram API ${retries} ကြိမ် retry လည်း မရပါ: ${lastError?.message}`);
}

async function isJoined(ctx) {
    const userId = ctx.from.id;
    const cached = joinCache.get(userId);
    if (cached && Date.now() < cached.expiresAt) return cached.joined;
    for (const ch of CHANNELS) {
        const member = await withRetry(() => ctx.telegram.getChatMember(ch, userId));
        if (['left', 'kicked'].includes(member.status)) return false;
    }
    joinCache.set(userId, { joined: true, expiresAt: Date.now() + CACHE_TTL_MS });
    return true;
}

const isAdmin = ctx => String(ctx.from.id) === ADMIN_ID;

bot.catch((err, ctx) => console.error(`⚠️ Bot Error (${ctx.updateType}):`, err.message));

// ── Keyboards ──────────────────────────────────────────────────
const mainMenu = Markup.keyboard([
    ['💰 ငွေလက်ကျန်', '🎮 Mini App ဖွင့်မည်'],
    ['👥 Referral',   '👤 ကျွန်တော့်အကောင့်'],
    ['📤 ငွေထုတ်ယူရန်', '💳 Wallet သတ်မှတ်မည်'],
]).resize();

// ═══════════════════════════════════════════════════════════════
//   COMMANDS — အားလုံး bot.on('message') ရဲ့ အပေါ်မှာ ရှိရမည်
// ═══════════════════════════════════════════════════════════════

// ── /start ────────────────────────────────────────────────────
bot.start(async ctx => {
    try {
        const tgUser = ctx.from;
        let user = await User.findOne({ tgId: tgUser.id });

        if (!user) {
            user = new User({
                tgId:     tgUser.id,
                username: tgUser.username || String(tgUser.id),
            });
            const args = ctx.message.text.split(' ');
            if (args[1]) {
                const refId = parseInt(args[1]);
                if (!isNaN(refId) && refId !== tgUser.id) {
                    const refUser = await User.findOne({ tgId: refId });
                    if (refUser) {
                        user.referredBy = refId;
                        await User.updateOne({ tgId: refId }, { $inc: { balance: 5000, referralCount: 1 } });
                        try { await bot.telegram.sendMessage(refId, `🎉 Referral ဆုကြေး! +5,000 MMK ရရှိပါပြီ!`); } catch (e) {}
                    }
                }
            }
            await user.save();
        } else {
            await User.updateOne({ tgId: tgUser.id }, { $set: { username: tgUser.username, lastActive: new Date() } });
        }

        const joined = await isJoined(ctx);
        if (!joined) {
            return ctx.reply(
`👋 မင်္ဂလာပါ ${tgUser.first_name || tgUser.username || 'မိတ်ဆွေ'}

BOT ကိုသုံးပြီးငွေရှာချင်တယ် မိတ်ဆွေ
အောက်က Channel ၂ ခုလုံးကို Join ထားမှသာ 
ငွေထုတ်ခွင့်ရမည်ဖြစ်ပါသည်❌

Bot ကို အသုံးပြုဖို့အတွက် အောက်ပါ Channel ၂ ခုလုံးကို join လုပ်ပါ👇

1️⃣ @Bitcoinmyanmarmining
2️⃣ @BitCoinMyan

Join ပြီးရင် ✅ Joined ဆိုတဲ့ခလုတ်ကိုနှိပ်ပါ။

🟡 Bitcoin ငွေရှာ BOT အသစ် 🟡🔋
နေ့စဉ်ငွေရပြီး ငွေတန်းထုတ်နိုင်တယ်! 💯
မြန်မာနိုင်ငံတရားဝင် Bitcoin Bot !

🔥🎁 လူ 1 ယောက်ခေါ် → +5000ကျပ်
🎁 လူ 10 ယောက်ခေါ် → +50000ကျပ်

🔥 Start လုပ်ပြီးရင် Menu မှာ 👇
👫 ဖိတ်ခေါ်ရန် 👈 ကိုနှိပ်ပါ
Bot ပေးတဲ့ Link ကို သူငယ်ချင်းအခြား GP မှာတင်ပြီး ငွေရှာမယ်💸💰`,
                Markup.inlineKeyboard([
                    [Markup.button.url('📱 Channel 1 ကို Join ပါ', 'https://t.me/Bitcoinmyanmarmining')],
                    [Markup.button.url('📱 Channel 2 ကို Join ပါ', 'https://t.me/BitCoinMyan')],
                    [Markup.button.callback('Joined ✅', 'check_join')],
                ])
            );
        }

        await ctx.reply(
            `🎉 မင်္ဂလာပါ ${tgUser.first_name || 'ခင်ဗျာ'}!\n\n` +
            `💰 လက်ကျန်ငွေ: ${user.balance.toLocaleString()} MMK\n\n` +
            `Mini App ဖွင့်ပြီး ကြော်ငြာကြည့်၊ Spin Wheel လှည့်ကာ ငွေများ ရပါဦး!`,
            {
                reply_markup: {
                    ...mainMenu.reply_markup,
                    inline_keyboard: [[
                        { text: '🎮 Mini App ဖွင့်မည်', web_app: { url: MINI_APP_URL } }
                    ]]
                }
            }
        );
    } catch (e) {
        console.error('❌ /start:', e);
        ctx.reply('⚠️ Error ဖြစ်သွားပါသည်။ ပြန်ကြိုးစားပါ။').catch(() => {});
    }
});

// ── /cancel ───────────────────────────────────────────────────
bot.command('cancel', async ctx => {
    await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'none', tempData: {} } });
    ctx.reply('✅ ပြန်ထွက်လိုက်ပါပြီ', mainMenu);
});

// ── /admin ────────────────────────────────────────────────────
bot.command('admin', async ctx => {
    if (!isAdmin(ctx)) return;
    const msg =
`🛠 *Admin Panel — သုံးနည်းများ*

━━━━━━━━━━━━━━━━━━━
👥 *User Management*
━━━━━━━━━━━━━━━━━━━
📊 /users
   └ User စာရင်း ကြည့်မည်

💰 /addbalance \`<userId>\` \`<amount>\`
   └ ဥပမာ: /addbalance 123456 5000

🚫 /ban \`<userId>\`
   └ ဥပမာ: /ban 123456

✅ /unban \`<userId>\`
   └ ဥပမာ: /unban 123456

📨 /broadcast \`<message>\`
   └ ဥပမာ: /broadcast မင်္ဂလာပါ!

━━━━━━━━━━━━━━━━━━━
📋 *Task ရမည့်ငွေ ပြောင်း*
━━━━━━━━━━━━━━━━━━━
/settask1 \`<amount>\`  — Task 1
/settask2 \`<amount>\`  — Task 2
/settask3 \`<amount>\`  — Task 3
/settask4 \`<amount>\`  — Task 4
   └ ဥပမာ: /settask1 300

━━━━━━━━━━━━━━━━━━━
📢 *VPN Note Control*
━━━━━━━━━━━━━━━━━━━
/open  — Website မှာ VPN note ပြမည်
/close — Website မှာ VPN note ဖျောက်မည်

━━━━━━━━━━━━━━━━━━━
💸 *Withdrawals*
━━━━━━━━━━━━━━━━━━━
/withdrawals — Pending ငွေထုတ်မှု ကြည့်`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ── /users ────────────────────────────────────────────────────
bot.command('users', async ctx => {
    if (!isAdmin(ctx)) return;
    const count  = await User.countDocuments();
    const banned = await User.countDocuments({ isBanned: true });
    ctx.reply(
        `📊 *User Statistics*\n\nTotal: ${count}\nBanned: ${banned}\nActive: ${count - banned}`,
        { parse_mode: 'Markdown' }
    );
});

// ── /addbalance ───────────────────────────────────────────────
bot.command('addbalance', async ctx => {
    if (!isAdmin(ctx)) return;
    try {
        const parts = ctx.message.text.split(' ');
        if (parts.length < 3) return ctx.reply('Usage: /addbalance <userId> <amount>');
        const [, targetId, amount] = parts;
        const updated = await User.findOneAndUpdate(
            { tgId: Number(targetId) },
            { $inc: { balance: Number(amount) } },
            { new: true }
        );
        if (!updated) return ctx.reply('❌ User မတွေ့ပါ');
        ctx.reply(`✅ Balance ထည့်ပြီး\nUser: ${targetId}\nAmount: ${Number(amount).toLocaleString()} MMK\nNew Balance: ${updated.balance.toLocaleString()} MMK`);
        try { await bot.telegram.sendMessage(Number(targetId), `💰 Admin မှ ${Number(amount).toLocaleString()} MMK ထည့်ပေးလိုက်ပါပြီ!\nလက်ကျန်: ${updated.balance.toLocaleString()} MMK`); } catch (e) {}
    } catch (e) { ctx.reply('❌ Error: ' + e.message); }
});

// ── /ban ──────────────────────────────────────────────────────
bot.command('ban', async ctx => {
    if (!isAdmin(ctx)) return;
    const id = parseInt(ctx.message.text.split(' ')[1]);
    if (isNaN(id)) return ctx.reply('Usage: /ban <userId>');
    await User.updateOne({ tgId: id }, { $set: { isBanned: true } });
    ctx.reply(`✅ User ${id} banned`);
});

// ── /unban ────────────────────────────────────────────────────
bot.command('unban', async ctx => {
    if (!isAdmin(ctx)) return;
    const id = parseInt(ctx.message.text.split(' ')[1]);
    if (isNaN(id)) return ctx.reply('Usage: /unban <userId>');
    await User.updateOne({ tgId: id }, { $set: { isBanned: false } });
    ctx.reply(`✅ User ${id} unbanned`);
});

// ── /broadcast ────────────────────────────────────────────────
bot.command('broadcast', async ctx => {
    if (!isAdmin(ctx)) return;
    const msg = ctx.message.text.split('/broadcast ')[1];
    if (!msg) return ctx.reply('Usage: /broadcast <message>');
    const users = await User.find({ isBanned: false });
    await ctx.reply(`📨 Sending to ${users.length} users...`);
    let ok = 0, fail = 0;
    for (const u of users) {
        try { await bot.telegram.sendMessage(u.tgId, msg); ok++; await new Promise(r => setTimeout(r, 50)); }
        catch (e) { fail++; }
    }
    ctx.reply(`✅ Done\n✅ Success: ${ok}\n❌ Failed: ${fail}`);
});

// ── /withdrawals ──────────────────────────────────────────────
bot.command('withdrawals', async ctx => {
    if (!isAdmin(ctx)) return;
    const pending = await Withdrawal.find({ status: 'pending' }).sort({ createdAt: -1 });
    if (!pending.length) return ctx.reply('✅ Pending မရှိပါ');
    let msg = `⏳ *Pending Withdrawals* (${pending.length})\n\n`;
    pending.forEach((w, i) => {
        msg += `${i + 1}. ID:${w.userId} | ${w.name} | ${w.amount.toLocaleString()} ကျပ် | ${new Date(w.createdAt).toLocaleString()}\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ── /open ─────────────────────────────────────────────────────
bot.command('open', async ctx => {
    if (!isAdmin(ctx)) return;
    await setCfg('vpn_note_open', true);
    ctx.reply('✅ VPN Note ဖွင့်လိုက်ပါပြီ — Website မှာ ပေါ်နေမည်');
});

// ── /close ────────────────────────────────────────────────────
bot.command('close', async ctx => {
    if (!isAdmin(ctx)) return;
    await setCfg('vpn_note_open', false);
    ctx.reply('✅ VPN Note ပိတ်လိုက်ပါပြီ — Website မှာ ပျောက်သွားမည်');
});

// ── /settask1 ─────────────────────────────────────────────────
bot.command('settask1', async ctx => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /settask1 <amount>');
    const amt = parseInt(parts[1]);
    if (isNaN(amt) || amt < 1) return ctx.reply('❌ ပမာဏ မမှန်ပါ');
    await setCfg('task1_reward', amt);
    ctx.reply(`✅ Task 1 ရမည့်ငွေ: *${amt.toLocaleString()} ကျပ်* သို့ ပြောင်းပြီး`, { parse_mode: 'Markdown' });
});

// ── /settask2 ─────────────────────────────────────────────────
bot.command('settask2', async ctx => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /settask2 <amount>');
    const amt = parseInt(parts[1]);
    if (isNaN(amt) || amt < 1) return ctx.reply('❌ ပမာဏ မမှန်ပါ');
    await setCfg('task2_reward', amt);
    ctx.reply(`✅ Task 2 ရမည့်ငွေ: *${amt.toLocaleString()} ကျပ်* သို့ ပြောင်းပြီး`, { parse_mode: 'Markdown' });
});

// ── /settask3 ─────────────────────────────────────────────────
bot.command('settask3', async ctx => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /settask3 <amount>');
    const amt = parseInt(parts[1]);
    if (isNaN(amt) || amt < 1) return ctx.reply('❌ ပမာဏ မမှန်ပါ');
    await setCfg('task3_reward', amt);
    ctx.reply(`✅ Task 3 ရမည့်ငွေ: *${amt.toLocaleString()} ကျပ်* သို့ ပြောင်းပြီး`, { parse_mode: 'Markdown' });
});

// ── /settask4 ─────────────────────────────────────────────────
bot.command('settask4', async ctx => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /settask4 <amount>');
    const amt = parseInt(parts[1]);
    if (isNaN(amt) || amt < 1) return ctx.reply('❌ ပမာဏ မမှန်ပါ');
    await setCfg('task4_reward', amt);
    ctx.reply(`✅ Task 4 ရမည့်ငွေ: *${amt.toLocaleString()} ကျပ်* သို့ ပြောင်းပြီး`, { parse_mode: 'Markdown' });
});

// ── Inline button: check_join ──────────────────────────────────
bot.action('check_join', async ctx => {
    try {
        const joined = await isJoined(ctx);
        if (joined) {
            await ctx.answerCbQuery('✅ Verified!');
            await ctx.deleteMessage().catch(() => {});
            await ctx.reply('🎉 ကြိုဆိုပါတယ်! Main Menu ကို ဖွင့်ပါ', mainMenu);
        } else {
            await ctx.answerCbQuery('❌ Channel များကို Join မလုပ်ရသေးပါ');
        }
    } catch (e) {
        ctx.answerCbQuery('❌ Error').catch(() => {});
    }
});

// ── Inline button: approve/reject withdrawal ───────────────────
bot.action(/^approve_withdraw_(.+)$/, async ctx => {
    if (!isAdmin(ctx)) return;
    try {
        const w = await Withdrawal.findById(ctx.match[1]);
        if (!w) return ctx.answerCbQuery('❌ မတွေ့ပါ');
        if (w.status !== 'pending') return ctx.answerCbQuery('✅ ပြီးသားပါ');
        w.status = 'approved'; w.reviewedAt = new Date(); w.reviewedBy = ctx.from.id;
        await w.save();
        try { await bot.telegram.sendMessage(w.userId, `✅ ငွေထုတ်မှု အတည်ပြုပြီး!\n${w.amount.toLocaleString()} MMK လွှဲပေးလိုက်ပါပြီ 🎉`); } catch (e) {}
        await ctx.editMessageCaption(
            `✅ Approved\nUser: ${w.userId} | ${w.amount.toLocaleString()} ကျပ်`,
            { reply_markup: { inline_keyboard: [] } }
        ).catch(() => {});
        ctx.answerCbQuery('✅ Approved!');
    } catch (e) { ctx.answerCbQuery('❌ Error').catch(() => {}); }
});

bot.action(/^reject_withdraw_(.+)$/, async ctx => {
    if (!isAdmin(ctx)) return;
    if (!global.pendingRejects) global.pendingRejects = new Map();
    global.pendingRejects.set(ctx.from.id, ctx.match[1]);
    await ctx.reply('ငြင်းပယ်ရသည့် အကြောင်းရင်းကို ရိုက်ပါ\n(/cancel ဖြင့် ပြန်ထွက်နိုင်သည်)');
    ctx.answerCbQuery();
});

bot.action('back_to_menu', async ctx => {
    try { await ctx.deleteMessage(); } catch (e) {}
    ctx.reply('🏡 Main Menu', mainMenu);
});

// ── Keyboard buttons ───────────────────────────────────────────
bot.hears('💰 ငွေလက်ကျန်', async ctx => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;
        ctx.reply(`💰 လက်ကျန်ငွေ: ${user.balance.toLocaleString()} MMK`);
    } catch (e) { console.error('❌ balance:', e); }
});

bot.hears('🎮 Mini App ဖွင့်မည်', async ctx => {
    ctx.reply('Mini App ကို ဖွင့်ပါ 👇', Markup.inlineKeyboard([
        [{ text: '🎮 Mini App ဖွင့်မည်', web_app: { url: MINI_APP_URL } }]
    ]));
});

bot.hears('👤 ကျွန်တော့်အကောင့်', async ctx => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;
        const lastSpinStr = user.lastSpin
            ? new Date(user.lastSpin).toLocaleDateString('my-MM')
            : 'မလှည့်ရသေးပါ';
        ctx.reply(
            `👤 *ကျွန်တော့်အကောင့်*\n\n` +
            `🆔 ID: ${user.tgId}\n` +
            `💰 Balance: ${user.balance.toLocaleString()} MMK\n` +
            `👥 Referral: ${user.referralCount} ယောက်\n` +
            `🎰 Last Spin: ${lastSpinStr}\n` +
            `💳 Wallet: ${user.wallet}`,
            { parse_mode: 'Markdown' }
        );
    } catch (e) { console.error('❌ profile:', e); }
});

bot.hears('👥 Referral', async ctx => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user) return;
        const botUsername = (await bot.telegram.getMe()).username;
        const link = `https://t.me/${botUsername}?start=${ctx.from.id}`;
        ctx.reply(
            `👥 *Referral Link*\n\n` +
            `သူငယ်ချင်းတစ်ယောက် Join လုပ်တိုင်း *+2,000 MMK* ရပါမည်!\n\n` +
            `🔗 ${link}\n\n` +
            `Referral ဦးရေ: ${user.referralCount} ယောက်`,
            { parse_mode: 'Markdown' }
        );
    } catch (e) { console.error('❌ referral:', e); }
});

bot.hears('💳 Wallet သတ်မှတ်မည်', async ctx => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;
        await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'wait_wallet' } });
        ctx.reply('💳 Kpay/Wave ဖုန်းနံပါတ် သို့မဟုတ် Account ကို ရိုက်ထည့်ပေးပါ\n\n❌ မလုပ်လိုပါက /cancel နှိပ်ပါ');
    } catch (e) { console.error('❌ wallet:', e); }
});

bot.hears('📤 ငွေထုတ်ယူရန်', async ctx => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;
        if (user.balance < 100000) {
            return ctx.reply(`❌ အနည်းဆုံး 100,000 MMK ပြည့်မှ ထုတ်ရပါမည်\nလက်ကျန်: ${user.balance.toLocaleString()} MMK`);
        }
        await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'withdraw_phone', tempData: {} } });
        ctx.reply('📞 Kpay/Wave ဖုန်းနံပါတ် ထည့်ပေးပါ 👇\n\n❌ ပြန်ထွက်လိုပါက /cancel နှိပ်ပါ');
    } catch (e) { console.error('❌ withdraw_start:', e); }
});

// ═══════════════════════════════════════════════════════════════
//   GLOBAL MESSAGE HANDLER — အောက်ဆုံးမှာသာ ရှိရမည်
// ═══════════════════════════════════════════════════════════════
if (!global.pendingRejects) global.pendingRejects = new Map();

bot.on('message', async ctx => {
    try {
        // commands တွေကို ဒီ handler မထိစေဖို့ filter လုပ်သည်
        if (ctx.message.text && ctx.message.text.startsWith('/')) return;

        User.updateOne({ tgId: ctx.from.id }, { $set: { lastActive: new Date() } }).catch(() => {});

        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;

        // ── Admin: reject reason ───────────────────────────────
        if (isAdmin(ctx) && global.pendingRejects.has(ctx.from.id)) {
            const withdrawId = global.pendingRejects.get(ctx.from.id);
            const reason = ctx.message.text;
            if (!reason) return ctx.reply('⚠️ စာသားဖြင့် ရိုက်ထည့်ပါ');
            global.pendingRejects.delete(ctx.from.id);
            const w = await Withdrawal.findById(withdrawId);
            if (!w) return ctx.reply('❌ မတွေ့ပါ');
            if (w.status !== 'pending') return ctx.reply('✅ ပြီးသားပါ');
            if (w.amountDeducted) await User.updateOne({ tgId: w.userId }, { $inc: { balance: w.amount } });
            w.status = 'rejected'; w.reviewedAt = new Date(); w.reviewedBy = ctx.from.id; w.rejectReason = reason;
            await w.save();
            try { await bot.telegram.sendMessage(w.userId, `❌ ငွေထုတ်မှု ငြင်းပယ်\nအကြောင်း: ${reason}\n💰 ${w.amount.toLocaleString()} MMK ပြန်ထည့်ပေးပြီ`); } catch (e) {}
            return ctx.reply(`✅ Rejected: ${w.userId} | ${reason}`);
        }

        // ── Wallet setting ─────────────────────────────────────
        if (user.state === 'wait_wallet') {
            if (!ctx.message.text) return ctx.reply('⚠️ စာသားဖြင့် ထည့်ပါ');
            await User.updateOne({ tgId: ctx.from.id }, { $set: { wallet: ctx.message.text, state: 'none' } });
            return ctx.reply(`✅ Wallet: ${ctx.message.text}`, mainMenu);
        }

        // ── Withdrawal flow ────────────────────────────────────
        if (user.state === 'withdraw_phone') {
            if (!ctx.message.text || !/^\d+$/.test(ctx.message.text))
                return ctx.reply('⚠️ နံပါတ်သာ ထည့်ပါ\n\n/cancel ဖြင့် ပြန်ထွက်နိုင်သည်');
            await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'withdraw_name', tempData: { phone: ctx.message.text } } });
            return ctx.reply('👤 Kpay/Wave အကောင့်နာမည် ထည့်ပေးပါ 👇\n\n/cancel ဖြင့် ပြန်ထွက်နိုင်သည်');
        }
        if (user.state === 'withdraw_name') {
            if (!ctx.message.text) return ctx.reply('⚠️ နာမည် ရိုက်ပါ');
            await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'withdraw_amount', tempData: { ...user.tempData, name: ctx.message.text } } });
            return ctx.reply('💵 ထုတ်ယူမည့် ပမာဏ ရိုက်ပါ (အနည်းဆုံး 100,000 ကျပ်)\n\n/cancel ဖြင့် ပြန်ထွက်နိုင်သည်');
        }
        if (user.state === 'withdraw_amount') {
            const amt = parseInt(ctx.message.text);
            if (isNaN(amt) || amt < 100000) return ctx.reply('❌ အနည်းဆုံး 100,000 ကျပ် ဖြစ်ရပါမည်\n\n/cancel ဖြင့် ပြန်ထွက်နိုင်သည်');
            if (amt > user.balance) return ctx.reply('❌ လက်ကျန်ငွေ မလုံပါ\n\n/cancel ဖြင့် ပြန်ထွက်နိုင်သည်');
            await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'withdraw_nrc_front', tempData: { ...user.tempData, amt } } });
            return ctx.reply('📸 မှတ်ပုံတင် အရှေ့ဘက် ဓာတ်ပုံ ပို့ပါ 👇\n\n/cancel ဖြင့် ပြန်ထွက်နိုင်သည်');
        }
        if (user.state === 'withdraw_nrc_front') {
            if (!ctx.message.photo) return ctx.reply('⚠️ ဓာတ်ပုံ ပို့ပေးပါ\n\n/cancel ဖြင့် ပြန်ထွက်နိုင်သည်');
            const photo = ctx.message.photo.at(-1);
            await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'withdraw_nrc_back', tempData: { ...user.tempData, front: photo.file_id } } });
            return ctx.reply('📸 မှတ်ပုံတင် အနောက်ဘက် ဓာတ်ပုံ ပို့ပါ 👇\n\n/cancel ဖြင့် ပြန်ထွက်နိုင်သည်');
        }
        if (user.state === 'withdraw_nrc_back') {
            if (!ctx.message.photo) return ctx.reply('⚠️ ဓာတ်ပုံ ပို့ပေးပါ\n\n/cancel ဖြင့် ပြန်ထွက်နိုင်သည်');
            const photo = ctx.message.photo.at(-1);
            const d = user.tempData;
            const w = new Withdrawal({
                userId: user.tgId, username: user.username,
                phone: d.phone, name: d.name, amount: d.amt,
                nrcFront: d.front, nrcBack: photo.file_id
            });
            await w.save();
            await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'waiting_verification_screenshot', tempData: { withdrawalId: w._id } } });
            await ctx.reply(
                `မှတ်ပုံတင် အချက်အလက်များကို လက်ခံရရှိပါပြီ။ ✅\n\n` +
                `လူကြီးမင်းအနေနဲ့ Referral အတု (သို့မဟုတ်) Bot အသုံးပြုသူ မဟုတ်ကြောင်း အတည်ပြုနိုင်ရန်အတွက် ပေးထားသော\n` +
                `Kpay: 09783646736\n` +
                `Name: Yee Moon Naing\n` +
                `ထံသို့ Verification Fee *၃,၀၀၀ ကျပ်* အရင်လွှဲပေးရပါမည်။ 💸\n\n` +
                `ငွေလွှဲပြီးပါက ပြေစာ (Screenshot) ကို ပို့ပေးပါ။ Admin ဘက်မှ အတည်ပြုပြီးသည်နှင့် လူကြီးမင်း ထုတ်ယူထားသော ငွေပမာဏ (၁၀၀,၀၀၀ ကျပ် + ၃,၀၀၀ ကျပ်) စုစုပေါင်းကို ၁ မိနစ်အတွင်း လူကြီးမင်းဆီသို့ ပြန်လည် လွှဲပြောင်းပေးသွားမည် ဖြစ်ပါသည်။ ✨\n\n` +
                `/cancel ဖြင့် ပြန်ထွက်နိုင်သည်`,
                { parse_mode: 'Markdown' }
            );
            try {
                await bot.telegram.sendPhoto(LOG_GROUP_ID, d.front, {
                    caption: `🆕 Withdrawal Request\nUser: ${user.tgId} | ${d.name} | ${d.phone}\nAmount: ${d.amt.toLocaleString()} ကျပ်`,
                    parse_mode: 'Markdown'
                });
                await bot.telegram.sendPhoto(LOG_GROUP_ID, photo.file_id, { caption: 'NRC Back' });
            } catch (e) {}
            return;
        }
        if (user.state === 'waiting_verification_screenshot') {
            if (!ctx.message.photo) return ctx.reply('⚠️ Screenshot ကို ဓာတ်ပုံဖြင့် ပို့ပါ\n\n/cancel ဖြင့် ပြန်ထွက်နိုင်သည်');
            const photo = ctx.message.photo.at(-1);
            const wId = user.tempData?.withdrawalId;
            if (!wId) {
                await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'none', tempData: {} } });
                return ctx.reply('❌ Error ဖြစ်ပါသည်');
            }
            const w = await Withdrawal.findById(wId);
            if (!w) {
                await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'none', tempData: {} } });
                return ctx.reply('❌ မတွေ့ပါ');
            }
            if (user.balance < w.amount) {
                await User.updateOne({ tgId: ctx.from.id }, { $set: { state: 'none', tempData: {} } });
                return ctx.reply('❌ Balance မလုံ');
            }
            await User.updateOne({ tgId: ctx.from.id }, { $inc: { balance: -w.amount }, $set: { state: 'none', tempData: {} } });
            w.verificationScreenshot = photo.file_id; w.amountDeducted = true;
            await w.save();
            await ctx.reply('✅ Screenshot လက်ခံပြီ! Admin စစ်ဆေးနေပါသည်...\n💰 ငွေ နုတ်ပြီးပါပြီ');
            try {
                await bot.telegram.sendPhoto(LOG_GROUP_ID, photo.file_id, {
                    caption: `🆕 Verification Screenshot\nUser: ${user.tgId} | Amount: ${w.amount.toLocaleString()} ကျပ်`,
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[
                        Markup.button.callback('✅ Approve', `approve_withdraw_${w._id}`),
                        Markup.button.callback('❌ Reject',  `reject_withdraw_${w._id}`)
                    ]])
                });
            } catch (e) {}
            return;
        }

        // ── Forward unhandled messages to log ──────────────────
        if (user.state === 'none' && ctx.message.text) {
            try {
                await bot.telegram.sendMessage(LOG_GROUP_ID,
                    `📨 User Message\nID: ${user.tgId} | @${user.username || 'N/A'}\n${ctx.message.text}`,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {}
        }
    } catch (e) {
        console.error('❌ message handler:', e);
    }
});

// ═══════════════════════════════════════════════════════════════
//   LAUNCH
// ═══════════════════════════════════════════════════════════════
bot.launch().then(() => console.log('🚀 Bot is Live!'));
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
