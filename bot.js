require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');

// --- Render Keep-Alive Server ---
// Render မှာ Web Service အဖြစ် Run ဖို့ Express server လေးထည့်ထားခြင်းဖြစ်သည်
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bitcoin Bot is Online and Running smoothly!'));
app.listen(port, () => console.log(`✅ Keep-Alive server running on port ${port}`));

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = String(process.env.ADMIN_ID).trim();

// --- Database Connection ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Database Connected Successfully!"))
    .catch(err => { 
        console.error("❌ MongoDB Connection Error:", err.message); 
        // DB မချိတ်နိုင်ရင် Bot ကို ဆက်မ run ဘဲ ရပ်ထားမည်
        process.exit(1); 
    });

// --- Database Schema ---
const userSchema = new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    balance: { type: Number, default: 0 },
    referredBy: { type: Number, default: null },
    referralCount: { type: Number, default: 0 },
    wallet: { type: String, default: "⛔ မသတ်မှတ်ရသေးပါ" },
    lastBonus: { type: Date, default: null },
    isBanned: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

const CHANNELS = ['@BitCoinMyannmar', '@BitCoinMyan'];

// --- Helper Function: Check Channel Join ---
async function isJoined(ctx) {
    for (const ch of CHANNELS) {
        try {
            const member = await ctx.telegram.getChatMember(ch, ctx.from.id);
            if (['left', 'kicked'].includes(member.status)) return false;
        } catch (e) { 
            console.log(`⚠️ Error checking channel ${ch} for user ${ctx.from.id}: ${e.message}`);
            return false; 
        }
    }
    return true;
}

// --- GLOBAL ERROR HANDLER ---
// အရေးကြီးဆုံးအပိုင်း - မမျှော်လင့်ထားတဲ့ Error တွေကြောင့် Bot ကြီး Crash မဖြစ်အောင် တားပေးသည်
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
        const refId = parseInt(ctx.payload); // Referral link ကနေ လာရင် ID ယူမည်

        if (!user) {
            user = new User({ tgId: ctx.from.id, username: ctx.from.first_name || 'User' });
            // ကိုယ့်ကိုယ်ကို Refer ပြန်လုပ်တာမျိုး မဖြစ်အောင် တားဆီးခြင်း
            if (refId && refId !== ctx.from.id) {
                user.referredBy = refId;
            }
            await user.save();
        }

        if (user.isBanned) {
            return ctx.reply("🚫 သင်သည် စည်းကမ်းဖောက်ဖျက်မှုကြောင့် အသုံးပြုခွင့် ပိတ်ပင်ခံထားရပါသည်။").catch(e => console.log("Failed to send ban msg:", e.message));
        }

        const msg = `👋 မင်္ဂလာပါ ${ctx.from.first_name}\n\nBOT ကိုသုံးပြီးငွေရှာချင်တယ် မိတ်ဆွေ\nအောက်က Channel နှစ်ခုကို မJoin ထားရင် \nငွေထုတ်ရမည်မဟုတ်ပါ❌\n\nBot ကို အသုံးပြုဖို့အတွက် အောက်ပါ Channel ၂ခုကို join လုပ်ပါ👇\n\n1️⃣ @BitCoinMyannmar\n2️⃣ @BitCoinMyan\n\nJoin ပြီးရင် ✅ Joined ဆိုတဲ့ခလုတ်ကိုနှိပ်ပါ။\n\n🟡 Bitcoin ငွေရှာ BOT အသစ် 🟡🔋\nနေ့စဉ်ငွေရပြီး ငွေတန်းထုတ်နိုင်တယ်! 💯\nမြန်မာနိုင်ငံတရားဝင် Bitcoin Bot !\n\n🔥🎁 လူ 1 ယောက်ခေါ် → +5000ကျပ်\n🎁 လူ 10 ယောက်ခေါ် → +50000ကျပ်\n\n🔥 Start လုပ်ပြီးရင် Menu မှာ 👇\n👫 ဖိတ်ခေါ်ရန် 👈 ကိုနှိပ်ပါ\nBot ပေးတဲ့ Link ကို သူငယ်ချင်းအခြား GP မှာတင်ပြီး ငွေရှာမယ်💸💰`;

        await ctx.reply(msg, Markup.inlineKeyboard([
            [Markup.button.url('📲 Channel 1 ကို Join ပါ', 'https://t.me/BitCoinMyannmar')],
            [Markup.button.url('📲 Channel 2 ကို Join ပါ', 'https://t.me/BitCoinMyan')],
            [Markup.button.callback('✅ Joined', 'check_join')]
        ])).catch(e => console.log("Failed to send start msg:", e.message));
        
    } catch (e) { 
        console.error("🔴 Start Command Error:", e); 
    }
});

// --- Check Join Action ---
bot.action('check_join', async (ctx) => {
    try {
        if (await isJoined(ctx)) {
            const user = await User.findOne({ tgId: ctx.from.id });
            
            // Referral အတွက် Bonus ပေးခြင်း
            if (user && user.referredBy) {
                const refUser = await User.findOne({ tgId: user.referredBy });
                if (refUser) {
                    refUser.balance += 5000;
                    refUser.referralCount += 1;
                    await refUser.save();
                    
                    // ဖိတ်ခေါ်သူဆီ စာပို့ခြင်း (သူက Bot ကို Block ထားရင်တောင် Error မတက်အောင် .catch ထည့်ထားသည်)
                    bot.telegram.sendMessage(refUser.tgId, `🎉 ဂုဏ်ယူပါတယ်! လူသစ်တစ်ယောက်ဖိတ်ခေါ်မှုအောင်မြင်ပြီး 5000 ကျပ် ရရှိပါသည်!`)
                        .catch(err => console.log(`Failed to send ref bonus msg to ${refUser.tgId}:`, err.message));
                }
                user.referredBy = null; // Bonus ပေးပြီးရင် null ပြန်ပြောင်းမည်
                await user.save();
            }
            
            // Message ဖျက်ရာတွင် Error မတက်စေရန်
            await ctx.deleteMessage().catch(err => console.log("Message delete ignored:", err.message));
            
            await ctx.reply("🏡 မင်္ဂလာပါ! Main Menu မှာ ရွေးချယ်ပါ ✨", mainMenu)
                .catch(err => console.log("Main menu reply error:", err.message));
                
        } else {
            await ctx.answerCbQuery("⚠️ Channel (၂) ခုလုံးကို Join ရပါမည်!", { show_alert: true })
                .catch(err => console.log("Answer callback error:", err.message));
        }
    } catch (e) { 
        console.error("🔴 Check Join Action Error:", e); 
    }
});

// --- Main Menu Buttons ---
bot.hears('💰 လက်ကျန်ငွေ', async (ctx) => {
    try {
        const user = await User.findOne({ tgId: ctx.from.id });
        if (!user) return; // User မရှိရင် ဘာမှမလုပ်ပါ
        
        await ctx.reply(`🙌🏻 အသုံးပြုသူ = ${user.username}\n💰 လက်ကျန်ငွေ = ${user.balance.toLocaleString()} ကျပ်\n\n🪢 ပိုပြီး ရနိုင်ရန် မိတ်ဆွေ ဖိတ်ပါ ✨`)
            .catch(err => console.log("Balance reply error:", err.message));
            
    } catch (e) { 
        console.error("🔴 Balance Button Error:", e); 
    }
});

// ကျန်တဲ့ Button တွေ (ဥပမာ - 👫 ဖိတ်ခေါ်ရန်, 🗂 Wallet စသည်တို့) ကို ဒီအောက်မှာ ဆက်ရေးလို့ရပါတယ်။

// --- Bot Launch ---
bot.launch().then(() => console.log("🚀 Bot is running flawlessly!"));

// --- Graceful Stop ---
// Render က Bot ကို Restart ချတဲ့အခါ Error အနီတွေ မပြဘဲ သေသေချာချာ ရပ်သွားစေရန်
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
