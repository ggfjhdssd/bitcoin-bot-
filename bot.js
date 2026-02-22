require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');

// --- 1. Render Port Binding & Keep-alive Server ---
// Render မှာ "No open ports detected" error မတက်အောင် ဒါကို ထည့်ရပါတယ်
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
        } catch (e) { 
            return false; 
        }
    }
    return true;
}

const isAdmin = (ctx) => String(ctx.from.id) === ADMIN_ID;

// --- 6. Global Error Handler ---
// User က bot ကို block ထားရင် bot မရပ်သွားအောင် ဒါက ကာကွယ်ပေးပါတယ်
bot.catch((err, ctx) => {
    console.error(`⚠️ Telegram Error (${ctx.updateType}): ${err.message}`);
});

// --- 7. Keyboards ---
const mainMenu = Markup.keyboard([
    ['💰 လက်ကျန်ငွေ', '👫 ဖိတ်ခေါ်ရန်'],
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
    } catch (e) { 
        console.error("Start Error:", e); 
    }
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
                    } catch (err) {
                        console.log("Ref notification failed (user blocked bot)");
                    }
                }
                user.referredBy = null;
                await user.save();
            }
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply("🏡 မင်္ဂလာပါ! Main Menu မှာ ရွေးချယ်ပါ ✨", mainMenu).catch(()=>{});
        } else {
            await ctx.answerCbQuery("⚠️ Channel (၂) ခုလုံးကို Join ရပါမည်!", { show_alert: true }).catch(()=>{});
        }
    } catch (e) {
        console.error("Check Join Error:", e);
    }
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

bot.action('my_refs', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        const count = user.referralCount;
        await ctx.reply(count === 0 ? "👤 သင့်ဖိတ်ခေါ်ထားသူ မရှိသေးပါ။" : `👤 သင့်မှာ ဖိတ်ခေါ်ထားသူ ${count} ဦး ရှိပါသည်။`).catch(()=>{});
        await ctx.answerCbQuery().catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.action('top_list', async (ctx) => {
    try {
        const topUsers = await User.find().sort({ referralCount: -1 }).limit(10);
        let text = "🔥 <b>အကောင်းဆုံး Referral Users List</b> 🔥\n\n";
        topUsers.forEach((u, i) => {
            text += `${i + 1}. ${u.username || 'User'} : 👨 ${u.referralCount} ယောက်\n`;
        });
        await ctx.reply(text, { 
            parse_mode: 'HTML', 
            ...Markup.inlineKeyboard([Markup.button.callback('🔙 နောက်သို့', 'back_to_menu')]) 
        }).catch(()=>{});
        await ctx.answerCbQuery().catch(()=>{});
    } catch (e) { console.error(e); }
});

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
        await ctx.reply("✏️ Now Send Your Kpay/Wave Number and Name To Use It For Future Withdrawals\n\n⚠️ This Wallet Will Be Used For Future Withdrawals !!").catch(()=>{});
        await ctx.answerCbQuery().catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.hears('🎁 Bonus', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;
        const now = new Date();
        if (user.lastBonus && (now - user.lastBonus < 86400000)) {
            const diff = 86400000 - (now - user.lastBonus);
            const hours = Math.floor(diff / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            return ctx.reply(`⏳ ခွင့်မပြုသေးပါ! သင် 24 နာရီအတွင်း ဘောနပ်ရယူပြီးသားဖြစ်ပါသည်။\n⏰ ကျန်ရှိချိန်: ${hours} နာရီ ${mins} မိနစ်`).catch(()=>{});
        }
        const bonus = Math.floor(Math.random() * (10000 - 500 + 1)) + 500;
        user.balance += bonus;
        user.lastBonus = now;
        await user.save();
        await ctx.reply(`🎉 မင်္ဂလာပါ! ကံစမ်းမဲ ပေါက်ပါပြီ 🎉\n💰 သင် ${bonus} ကျပ် ရရှိလိုက်ပြီ ဖြစ်ပါသည်။\n🔔 500 ကျပ်မှ 10,000 ကျပ် အထိ ပေါက်နိုင်ပါသည်။\n⏳ 24 နာရီ ပြည့်မြောက်ပြီးနောက် ထပ်မံစမ်းနိုင်ပါသည်။`).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.hears('📤 ငွေထုတ်ယူရန်', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;
        if (user.balance < 100000) return ctx.reply("⚠ သင်ထုတ်ယူနိုင်ရန်အနည်းဆုံး 100,000 ကျပ် ရှိရပါမည်").catch(()=>{});
        user.state = 'withdraw_phone';
        await user.save();
        await ctx.reply("📱 ငွေထုတ်ယူမည့် Kpay/Wave ဖုန်းနံပါတ်ကို ပို့ပေးပါ (ဂဏန်းသီးသန့်) 👇").catch(()=>{});
    } catch (e) { console.error(e); }
});

// --- 10. Admin Panel Commands ---
bot.command('panel', async (ctx) => {
    try {
        if (!isAdmin(ctx)) return;
        const total = await User.countDocuments();
        let msg = `👑 <b>Super Admin Panel</b>\n\n📊 Total Users: ${total}\n\n`;
        msg += `<b>Available Commands:</b>\n`;
        msg += `🔹 <code>/users [page]</code> - User List ကြည့်ရန် (၁၀ ယောက်စီ)\n`;
        msg += `🔹 <code>/add [ID] [Amt]</code> - ငွေပေါင်းရန်\n`;
        msg += `🔹 <code>/sub [ID] [Amt]</code> - ငွေနုတ်ရန်\n`;
        msg += `🔹 <code>/setref [ID] [Count]</code> - Refer Count ပြင်ရန်\n`;
        msg += `🔹 <code>/ban [ID]</code> - User ကို ပိတ်ရန်\n`;
        msg += `🔹 <code>/unban [ID]</code> - User ပြန်ဖွင့်ရန်\n`;
        msg += `🔹 <code>/info [ID]</code> - အသေးစိတ်ကြည့်ရန်\n`;
        msg += `🔹 <code>/broadcast [Msg]</code> - လူကုန်ပို့ရန်`;
        await ctx.reply(msg, { parse_mode: 'HTML' }).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.command('users', async (ctx) => {
    try {
        if (!isAdmin(ctx)) return;
        const page = parseInt(ctx.message.text.split(' ')[1]) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;
        const users = await User.find().skip(skip).limit(limit);
        if (users.length === 0) return ctx.reply("❌ No more users.").catch(()=>{});
        let list = `👥 <b>User List (Page: ${page})</b>\n\n`;
        users.forEach((u, i) => {
            list += `${skip + i + 1}. ${u.username} (<code>${u.tgId}</code>) - 💰 ${u.balance}\n`;
        });
        list += `\nNext: <code>/users ${page + 1}</code>`;
        await ctx.reply(list, { parse_mode: 'HTML' }).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.command('setref', async (ctx) => {
    try {
        if (!isAdmin(ctx)) return;
        const args = ctx.message.text.split(' ');
        if (args.length < 3) return ctx.reply("⚠️ /setref [ID] [Count]").catch(()=>{});
        await User.updateOne({ tgId: args[1] }, { referralCount: parseInt(args[2]) });
        await ctx.reply(`✅ ID: ${args[1]} ၏ Refer Count ကို ${args[2]} သို့ ပြောင်းလိုက်ပါပြီ။`).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.command('add', async (ctx) => {
    try {
        if (!isAdmin(ctx)) return;
        const args = ctx.message.text.split(' ');
        if (args.length < 3) return ctx.reply("⚠️ /add [ID] [Amt]").catch(()=>{});
        await User.updateOne({ tgId: args[1] }, { $inc: { balance: parseInt(args[2]) } });
        await ctx.reply(`💰 ID: ${args[1]} သို့ ${args[2]} ကျပ် ပေါင်းပြီးပါပြီ။`).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.command('sub', async (ctx) => {
    try {
        if (!isAdmin(ctx)) return;
        const args = ctx.message.text.split(' ');
        if (args.length < 3) return ctx.reply("⚠️ /sub [ID] [Amt]").catch(()=>{});
        await User.updateOne({ tgId: args[1] }, { $inc: { balance: -parseInt(args[2]) } });
        await ctx.reply(`➖ ID: ${args[1]} မှ ${args[2]} ကျပ် နှုတ်ပြီးပါပြီ။`).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.command('ban', async (ctx) => {
    try {
        if (!isAdmin(ctx)) return;
        const target = ctx.message.text.split(' ')[1];
        if (!target) return ctx.reply("⚠️ /ban [ID]").catch(()=>{});
        await User.updateOne({ tgId: target }, { isBanned: true });
        await ctx.reply(`🚫 ID: ${target} ကို Ban လိုက်ပါပြီ။`).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.command('unban', async (ctx) => {
    try {
        if (!isAdmin(ctx)) return;
        const target = ctx.message.text.split(' ')[1];
        if (!target) return ctx.reply("⚠️ /unban [ID]").catch(()=>{});
        await User.updateOne({ tgId: target }, { isBanned: false });
        await ctx.reply(`✅ ID: ${target} ကို Unban လိုက်ပါပြီ။`).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.command('info', async (ctx) => {
    try {
        if (!isAdmin(ctx)) return;
        const target = ctx.message.text.split(' ')[1];
        if (!target) return ctx.reply("⚠️ /info [ID]").catch(()=>{});
        const u = await User.findOne({ tgId: target });
        if (!u) return ctx.reply("❌ User not found.").catch(()=>{});
        let detail = `👤 Info for <code>${u.tgId}</code>\nName: ${u.username}\nBalance: ${u.balance}\nRefer: ${u.referralCount}\nWallet: ${u.wallet}\nBanned: ${u.isBanned}`;
        await ctx.reply(detail, { parse_mode: 'HTML' }).catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.command('broadcast', async (ctx) => {
    try {
        if (!isAdmin(ctx)) return;
        const msgText = ctx.message.text.split('/broadcast ')[1];
        if (!msgText) return ctx.reply("⚠️ စာသားထည့်ပါ။").catch(()=>{});
        const users = await User.find();
        await ctx.reply(`📤 လူပေါင်း ${users.length} ဦးထံ ပို့နေပါပြီ...`).catch(()=>{});
        for (const u of users) {
            try { 
                await bot.telegram.sendMessage(u.tgId, msgText); 
            } catch (e) {
                // User block ထားရင် skip မယ်
            }
        }
        await ctx.reply("✅ Broadcast Done.").catch(()=>{});
    } catch (e) { console.error(e); }
});

// --- 11. Message Handler ---
bot.on('message', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user || user.isBanned) return;

        // Log to Group
        if (!isAdmin(ctx) && ctx.chat.type === 'private' && user.state === 'none') {
            try { 
                await bot.telegram.sendMessage(LOG_GROUP_ID, `📩 <b>Msg from:</b> ${ctx.from.first_name} (<code>${ctx.from.id}</code>)\n${ctx.message.text || '[Media]'}`, { parse_mode: 'HTML' }); 
            } catch(e){}
        }

        if (user.state === 'wait_wallet') {
            user.wallet = ctx.message.text;
            user.state = 'none';
            await user.save();
            return ctx.reply(`💼 သင့် WavePay Kpay လိပ်စာကို အောင်မြင်စွာ သတ်မှတ်လိုက်ပါသည် :-\n${ctx.message.text}`).catch(()=>{});
        }

        if (user.state === 'withdraw_phone') {
            if (!/^\d+$/.test(ctx.message.text)) return ctx.reply("⚠️ နံပါတ်သီးသန့်သာ ထည့်သွင်းပေးပါရန်။").catch(()=>{});
            user.tempData = { ...user.tempData, phone: ctx.message.text };
            user.state = 'withdraw_name';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("👤 Kpay/Wave အကောင့်နာမည်ကို ပို့ပေးပါ 👇").catch(()=>{});
        }

        if (user.state === 'withdraw_name') {
            user.tempData = { ...user.tempData, name: ctx.message.text };
            user.state = 'withdraw_amount';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("💵 ထုတ်ယူလိုသော ပမာဏကို ရိုက်ထည့်ပါ 👇").catch(()=>{});
        }

        if (user.state === 'withdraw_amount') {
            const amt = parseInt(ctx.message.text);
            if (isNaN(amt) || amt < 100000 || amt > user.balance) {
                return ctx.reply("❌ ပမာဏ မှားယွင်းနေပါသည် (အနည်းဆုံး 100,000 ကျပ်)").catch(()=>{});
            }
            user.tempData = { ...user.tempData, amt: amt };
            user.state = 'withdraw_nrc_front';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("📸 မှတ်ပုံတင် 'အရှေ့ဘက်' ဓာတ်ပုံ ပို့ပေးပါ 👇").catch(()=>{});
        }

        if (user.state === 'withdraw_nrc_front' && ctx.message.photo) {
            user.tempData = { 
                ...user.tempData, 
                front: ctx.message.photo[ctx.message.photo.length - 1].file_id 
            };
            user.state = 'withdraw_nrc_back';
            user.markModified('tempData');
            await user.save();
            return ctx.reply("📸 မှတ်ပုံတင် 'အနောက်ဘက်' ဓာတ်ပုံ ပို့ပေးပါ 👇").catch(()=>{});
        }

        if (user.state === 'withdraw_nrc_back' && ctx.message.photo) {
            const backId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const data = user.tempData;

            user.balance -= data.amt;
            user.state = 'none';
            user.tempData = {};
            await user.save();

            await ctx.reply("✅ မိတ်ဆွေရဲ့ပိုက်ဆံထုတ်ခြင်းအောင်မြင်ပါသည် မိတ်ဆွေရဲ့ငွေထုတ်စဉ်နံပါတ်ကို Admin ထံ ပို့ထားပါသည် ✨").catch(()=>{});

            const adminMsg = `🚨 <b>Withdrawal Request</b>\n🆔 ID: <code>${user.tgId}</code>\n👤 Name: ${data.name}\n📞 Phone: ${data.phone}\n💵 Amt: ${data.amt} MMK\n📊 Bal After: ${user.balance}\n💳 Wallet: ${user.wallet}`;
            
            try {
                await bot.telegram.sendMessage(LOG_GROUP_ID, adminMsg, { parse_mode: 'HTML' });
                await bot.telegram.sendPhoto(LOG_GROUP_ID, data.front, { caption: "NRC Front" });
                await bot.telegram.sendPhoto(LOG_GROUP_ID, backId, { caption: "NRC Back" });
            } catch (err) {
                console.log("Failed to send logs to group");
            }
        }
    } catch (e) { console.error(e); }
});

bot.action('back_to_menu', async (ctx) => {
    try {
        try { await ctx.deleteMessage(); } catch (e) {}
        await ctx.reply("🏡 မင်္ဂလာပါ! Main Menu မှာ ရွေးချယ်ပါ ✨", mainMenu).catch(()=>{});
    } catch (e) { console.error(e); }
});

// --- 12. Bot Launch ---
bot.launch().then(() => {
    console.log("🚀 Super Admin Bot is running flawlessly!");
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
