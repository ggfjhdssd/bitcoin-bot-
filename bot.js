require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');

// --- Render Keep-Alive Server ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bitcoin Bot is Online!'));
app.listen(port, () => console.log(`Keep-Alive server running on port ${port}`));

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = String(process.env.ADMIN_ID).trim();
const LOG_GROUP_ID = process.env.LOG_GROUP_ID;

// --- Database Connection ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Database Connected!"))
    .catch(err => { console.log("❌ DB Error:", err); process.exit(1); });

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

        if (user.isBanned) return ctx.reply("🚫 သင်သည် စည်းကမ်းဖောက်ဖျက်မှုကြောင့် အသုံးပြုခွင့် ပိတ်ပင်ခံထားရပါသည်။");

        const msg = `👋 မင်္ဂလာပါ ${ctx.from.first_name}\n\nBOT ကိုသုံးပြီးငွေရှာချင်တယ် မိတ်ဆွေ\nအောက်က Channel နှစ်ခုကို မJoin ထားရင် \nငွေထုတ်ရမည်မဟုတ်ပါ❌\n\nBot ကို အသုံးပြုဖို့အတွက် အောက်ပါ Channel ၂ခုကို join လုပ်ပါ👇\n\n1️⃣ @BitCoinMyannmar\n2️⃣ @BitCoinMyan\n\nJoin ပြီးရင် ✅ Joined ဆိုတဲ့ခလုတ်ကိုနှိပ်ပါ။\n\n🟡 Bitcoin ငွေရှာ BOT အသစ် 🟡🔋\nနေ့စဉ်ငွေရပြီး ငွေတန်းထုတ်နိုင်တယ်! 💯\nမြန်မာနိုင်ငံတရားဝင် Bitcoin Bot !\n\n🔥🎁 လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁 လူ 10 ယောက်ခေါ် → +50000ကျပ်\n\n🔥 Start လုပ်ပြီးရင် Menu မှာ 👇\n👫 ဖိတ်ခေါ်ရန် 👈 ကိုနှိပ်ပါ\nBot ပေးတဲ့ Link ကို သူငယ်ချင်းအခြား GP မှာတင်ပြီး ငွေရှာမယ်💸💰`;

        ctx.reply(msg, Markup.inlineKeyboard([
            [Markup.button.url('📲 Channel 1 ကို Join ပါ', 'https://t.me/BitCoinMyannmar')],
            [Markup.button.url('📲 Channel 2 ကို Join ပါ', 'https://t.me/BitCoinMyan')],
            [Markup.button.callback('✅ Joined', 'check_join')]
        ]));
    } catch (e) { console.error(e); }
});

bot.action('check_join', async (ctx) => {
    if (await isJoined(ctx)) {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (user && user.referredBy) {
            const refUser = await User.findOne({ tgId: user.referredBy });
            if (refUser) {
                refUser.balance += 5000;
                refUser.referralCount += 1;
                await refUser.save();
                bot.telegram.sendMessage(refUser.tgId, `🎉 ဂုဏ်ယူပါတယ်! လူသစ်တစ်ယောက်ဖိတ်ခေါ်မှုအောင်မြင်ပြီး 5000 ကျပ် ရရှိပါသည်!`);
            }
            user.referredBy = null;
            await user.save();
        }
        await ctx.deleteMessage();
        ctx.reply("🏡 မင်္ဂလာပါ! Main Menu မှာ ရွေးချယ်ပါ ✨", mainMenu);
    } else {
        ctx.answerCbQuery("⚠️ Channel (၂) ခုလုံးကို Join ရပါမည်!", { show_alert: true });
    }
});

// --- Main Menu Buttons ---
bot.hears('💰 လက်ကျန်ငွေ', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    ctx.reply(`🙌🏻 အသုံးပြုသူ = ${user.username}\n💰 လက်ကျန်ငွေ = ${user.balance.toLocaleString()} ကျပ်\n\n🪢 ပိုပြီး ရနိုင်ရန် မိတ်ဆွေ ဖိတ်ပါ ✨`);
});

bot.hears('👫 ဖိတ်ခေါ်ရန်', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    const botMe = await bot.telegram.getMe();
    const refLink = `https://t.me/${botMe.username}?start=${ctx.from.id}`;
    const shareText = `@bitcoinminingmyanmar_bot Bitcoin Bot !🔥\n\n🎁လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁လူ 10 ယောက်ခေါ် → +50000ကျပ် 🔥\n\nငါ့ရဲ့ Invite Link က ${refLink} ဖြစ်ပါတယ်`;

    const msg = `🙌🏻 သင့်စုစုပေါင်း ဖိတ်ခေါ်ထားသူ = ${user.referralCount} User(s)\n🙌🏻 သင့်ဖိတ်ခေါ်ရန် Link = ${refLink}\n\n🪢 ဖိတ်ခေါ်ပြီး 5000 ကျပ် ရယူနိုင်ပါသည်\n\n🟡 Bitcoin ငွေရှာ BOT အသစ် 🟡\n🔋 နေ့စဉ်ငွေရပြီး ငွေတန်းထုတ်နိုင်တယ်! 💯 မြန်မာနိုင်ငံတရားဝင် Bitcoin Bot !🔥\n\n🎁လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁လူ 10 ယောက်ခေါ် → +50000ကျပ်\n\n🔥သူငယ်ချင်းတွေရဲ့ ဝယ်ယူမှုတိုင်းအတွက် ကော်မရှင် 80% အထိရ\n✅သင့် Wave/KPay ဆီသို့ ငွေတန်းထုတ်နိုင်တယ်\n\n🎯 ငါ့လင့်ကနေ ဝင်ပြီး ဘောနပ် 5000ကျပ် ယူလိုက်ပါ`;

    ctx.reply(msg, Markup.inlineKeyboard([
        [Markup.button.callback('👥 ဖိတ်ခေါ်ထားသောသူများ', 'my_refs')],
        [Markup.button.callback('🏆 Top List', 'top_list')],
        [Markup.button.switchToChat('🚀 Bot Link ကို Share ပါ', shareText)]
    ]));
});

bot.action('my_refs', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    const count = user.referralCount;
    ctx.reply(count === 0 ? "👤 သင့်ဖိတ်ခေါ်ထားသူ မရှိသေးပါ။" : `👤 သင့်မှာ ဖိတ်ခေါ်ထားသူ ${count} ဦး ရှိပါသည်။`);
    ctx.answerCbQuery();
});

bot.action('top_list', async (ctx) => {
    const topUsers = await User.find().sort({ referralCount: -1 }).limit(10);
    let text = "🔥 <b>အကောင်းဆုံး Referral Users List</b> 🔥\n\n";
    topUsers.forEach((u, i) => {
        text += `${i + 1}. ${u.username || 'User'} : 👨 ${u.referralCount} ယောက်\n`;
    });
    ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.callback('🔙 နောက်သို့', 'back_to_menu')]) });
    ctx.answerCbQuery();
});

// --- Wallet ---
bot.hears('🗂 Wallet', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    ctx.reply(`💡 သင့်လက်ရှိ Wallet နံပါတ်: ${user.wallet}\n\n💹ထို Wallet ကို အနာဂတ်ထုတ်ယူမှုများတွင် အသုံးပြုပါမည်။\n\nကျေးဇူးပြု၍ 💠 Wallet သတ်မှတ် / ပြင်ဆင် 💠 \nနှိပ်ပြီး သင်ငွေထုတ်ယူလိုသော WavePay/Kpay နာမည်နှင့် ဖုန်းနံပါတ်ကို ပို့ပေးပါ😘`, Markup.inlineKeyboard([
        [Markup.button.callback('💠 Wallet ပြင်ဆင်ပါ', 'set_wallet')]
    ]));
});

bot.action('set_wallet', async (ctx) => {
    await User.updateOne({ tgId: ctx.from.id }, { state: 'wait_wallet' });
    ctx.reply("✏️ Now Send Your Kpay/Wave Number and Name To Use It For Future Withdrawals\n\n⚠️ This Wallet Will Be Used For Future Withdrawals !!");
    ctx.answerCbQuery();
});

// --- Bonus ---
bot.hears('🎁 Bonus', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    const now = new Date();
    if (user.lastBonus && (now - user.lastBonus < 86400000)) {
        const diff = 86400000 - (now - user.lastBonus);
        const hours = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        return ctx.reply(`⏳ ခွင့်မပြုသေးပါ! သင် 24 နာရီအတွင်း ဘောနပ်ရယူပြီးသားဖြစ်ပါသည်။\n⏰ ကျန်ရှိချိန်: ${hours} နာရီ ${mins} မိနစ်`);
    }
    const bonus = Math.floor(Math.random() * (10000 - 500 + 1)) + 500;
    user.balance += bonus;
    user.lastBonus = now;
    await user.save();
    ctx.reply(`🎉 မင်္ဂလာပါ! ကံစမ်းမဲ ပေါက်ပါပြီ 🎉\n💰 သင် ${bonus} ကျပ် ရရှိလိုက်ပြီ ဖြစ်ပါသည်။\n🔔 500 ကျပ်မှ 10,000 ကျပ် အထိ ပေါက်နိုင်ပါသည်။\n⏳ 24 နာရီ ပြည့်မြောက်ပြီးနောက် ထပ်မံစမ်းနိုင်ပါသည်။`);
});

// --- Withdrawal Flow ---
bot.hears('📤 ငွေထုတ်ယူရန်', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    if (user.balance < 100000) return ctx.reply("⚠ သင်ထုတ်ယူနိုင်ရန်အနည်းဆုံး 100,000 ကျပ် ရှိရပါမည်");
    user.state = 'withdraw_phone';
    await user.save();
    ctx.reply("📱 ငွေထုတ်ယူမည့် Kpay/Wave ဖုန်းနံပါတ်ကို ပို့ပေးပါ (ဂဏန်းသီးသန့်) 👇");
});

// --- Admin Panel Commands ---
bot.command('panel', async (ctx) => {
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
    ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('users', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const page = parseInt(ctx.message.text.split(' ')[1]) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;
    const users = await User.find().skip(skip).limit(limit);
    if (users.length === 0) return ctx.reply("❌ No more users.");
    let list = `👥 <b>User List (Page: ${page})</b>\n\n`;
    users.forEach((u, i) => {
        list += `${skip + i + 1}. ${u.username} (<code>${u.tgId}</code>) - 💰 ${u.balance}\n`;
    });
    list += `\nNext: <code>/users ${page + 1}</code>`;
    ctx.reply(list, { parse_mode: 'HTML' });
});

bot.command('setref', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const args = ctx.message.text.split(' ');
    if (args.length < 3) return ctx.reply("⚠️ /setref [ID] [Count]");
    await User.updateOne({ tgId: args[1] }, { referralCount: parseInt(args[2]) });
    ctx.reply(`✅ ID: ${args[1]} ၏ Refer Count ကို ${args[2]} သို့ ပြောင်းလိုက်ပါပြီ။ (Ranking မှာ ချက်ချင်းပြောင်းသွားပါမည်)`);
});

bot.command('add', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const args = ctx.message.text.split(' ');
    await User.updateOne({ tgId: args[1] }, { $inc: { balance: parseInt(args[2]) } });
    ctx.reply(`💰 ID: ${args[1]} သို့ ${args[2]} ကျပ် ပေါင်းပြီးပါပြီ။`);
});

bot.command('sub', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const args = ctx.message.text.split(' ');
    await User.updateOne({ tgId: args[1] }, { $inc: { balance: -parseInt(args[2]) } });
    ctx.reply(`➖ ID: ${args[1]} မှ ${args[2]} ကျပ် နှုတ်ပြီးပါပြီ။`);
});

bot.command('ban', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const target = ctx.message.text.split(' ')[1];
    await User.updateOne({ tgId: target }, { isBanned: true });
    ctx.reply(`🚫 ID: ${target} ကို Ban လိုက်ပါပြီ။`);
});

bot.command('unban', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const target = ctx.message.text.split(' ')[1];
    await User.updateOne({ tgId: target }, { isBanned: false });
    ctx.reply(`✅ ID: ${target} ကို Unban လိုက်ပါပြီ။`);
});

bot.command('info', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const target = ctx.message.text.split(' ')[1];
    const u = await User.findOne({ tgId: target });
    if (!u) return ctx.reply("❌ User not found.");
    let detail = `👤 Info for <code>${u.tgId}</code>\nName: ${u.username}\nBalance: ${u.balance}\nRefer: ${u.referralCount}\nWallet: ${u.wallet}\nBanned: ${u.isBanned}`;
    ctx.reply(detail, { parse_mode: 'HTML' });
});

bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const msg = ctx.message.text.split('/broadcast ')[1];
    if (!msg) return ctx.reply("⚠️ စာသားထည့်ပါ။");
    const users = await User.find();
    ctx.reply(`📤 လူပေါင်း ${users.length} ဦးထံ ပို့နေပါပြီ...`);
    for (const u of users) {
        try { await bot.telegram.sendMessage(u.tgId, msg); } catch (e) {}
    }
    ctx.reply("✅ Broadcast Done.");
});

// --- Message Handler ---
bot.on('message', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    if (!user || user.isBanned) return;

    // Log to Group
    if (!isAdmin(ctx) && ctx.chat.type === 'private' && user.state === 'none') {
        try { bot.telegram.sendMessage(LOG_GROUP_ID, `📩 <b>Msg from:</b> ${ctx.from.first_name} (<code>${ctx.from.id}</code>)\n${ctx.message.text || '[Media]'}`, { parse_mode: 'HTML' }); } catch(e){}
    }

    if (user.state === 'wait_wallet') {
        user.wallet = ctx.message.text;
        user.state = 'none';
        await user.save();
        return ctx.reply(`💼 သင့် WavePay Kpay လိပ်စာကို အောင်မြင်စွာ သတ်မှတ်လိုက်ပါသည် :-\n${ctx.message.text}`);
    }

    if (user.state === 'withdraw_phone') {
        if (!/^\d+$/.test(ctx.message.text)) return ctx.reply("⚠️ နံပါတ်သီးသန့်သာ ထည့်သွင်းပေးပါရန်။");
        user.tempData.phone = ctx.message.text;
        user.state = 'withdraw_name';
        user.markModified('tempData');
        await user.save();
        return ctx.reply("👤 Kpay/Wave အကောင့်နာမည်ကို ပို့ပေးပါ 👇");
    }

    if (user.state === 'withdraw_name') {
        user.tempData.name = ctx.message.text;
        user.state = 'withdraw_amount';
        user.markModified('tempData');
        await user.save();
        return ctx.reply("💵 ထုတ်ယူလိုသော ပမာဏကို ရိုက်ထည့်ပါ 👇");
    }

    if (user.state === 'withdraw_amount') {
        const amt = parseInt(ctx.message.text);
        if (isNaN(amt) || amt < 100000 || amt > user.balance) return ctx.reply("❌ ပမာဏ မှားယွင်းနေပါသည်");
        user.tempData.amt = amt;
        user.state = 'withdraw_nrc_front';
        user.markModified('tempData');
        await user.save();
        return ctx.reply("📸 မှတ်ပုံတင် 'အရှေ့ဘက်' ဓာတ်ပုံ ပို့ပေးပါ 👇");
    }

    if (user.state === 'withdraw_nrc_front' && ctx.message.photo) {
        user.tempData.front = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        user.state = 'withdraw_nrc_back';
        user.markModified('tempData');
        await user.save();
        return ctx.reply("📸 မှတ်ပုံတင် 'အနောက်ဘက်' ဓာတ်ပုံ ပို့ပေးပါ 👇");
    }

    if (user.state === 'withdraw_nrc_back' && ctx.message.photo) {
        const backId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        const data = user.tempData;
        const bal = user.balance;
        const refs = user.referralCount;

        user.balance -= data.amt;
        user.state = 'none';
        user.tempData = {};
        await user.save();

        ctx.reply("✅ မိတ်ဆွေရဲ့ပိုက်ဆံထုတ်ခြင်းအောင်မြင်ပါသည် မိတ်ဆွေရဲ့ငွေထုတ်စဉ်နံပါတ်ကို Admin ထံ ပို့ထားပါသည် ✨");

        const adminMsg = `🚨 <b>Withdrawal Request</b>\n🆔 ID: <code>${user.tgId}</code>\n👤 Name: ${data.name}\n📞 Phone: ${data.phone}\n💵 Amt: ${data.amt} MMK\n📊 Total Bal: ${bal}\n👫 Refs: ${refs}\n💳 Wallet: ${user.wallet}`;
        
        bot.telegram.sendMessage(LOG_GROUP_ID, adminMsg, { parse_mode: 'HTML' });
        bot.telegram.sendPhoto(LOG_GROUP_ID, data.front, { caption: "NRC Front" });
        bot.telegram.sendPhoto(LOG_GROUP_ID, backId, { caption: "NRC Back" });
    }
});

bot.action('back_to_menu', async (ctx) => {
    await ctx.deleteMessage();
    ctx.reply("🏡 မင်္ဂလာပါ! Main Menu မှာ ရွေးချယ်ပါ ✨", mainMenu);
});

bot.launch();
console.log("🚀 Super Admin Bot is running with Express Keep-Alive...");
