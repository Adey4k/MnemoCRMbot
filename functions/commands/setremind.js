const {Markup} = require("telegraf");
const {db} = require("../firebase");

// Описуємо всі можливі опції нагадувань
const REMINDER_OPTIONS = [
  {key: "same_day", label: "День у день"},
  {key: "day_before", label: "За день"},
  {key: "three_days_before", label: "За 3 дні"},
  {key: "week_before", label: "За тиждень"},
  {key: "two_weeks_before", label: "За 2 тижні"},
  {key: "month_before", label: "За місяць"},
  {key: "two_months_before", label: "За 2 місяці"},
];

const getSettingsDocRef = (userId) =>
  db.collection(`contacts_user_${userId}`).doc("reminders_settings");

// Отримуємо налаштування користувача з його особистої колекції
const getUserSettings = async (userId) => {
  const docRef = getSettingsDocRef(userId);
  const doc = await docRef.get();

  if (!doc.exists) {
    const defaultSettings = {};
    REMINDER_OPTIONS.forEach((opt) => {
      defaultSettings[opt.key] = false;
    });
    return defaultSettings;
  }
  return doc.data();
};

// Зберігаємо налаштування користувача в його особистій колекції
const updateUserSettings = async (userId, settings) => {
  const docRef = getSettingsDocRef(userId);
  await docRef.set(settings);
};

// Будуємо клавіатуру на основі поточних налаштувань
const buildRemindKeyboard = (settings) => {
  const buttons = REMINDER_OPTIONS.map((option) => {
    const isEnabled = settings[option.key] === true;
    const label = `${isEnabled ? "✅" : "⬜️"} ${option.label}`;
    const callbackData = `remind:toggle:${option.key}`;
    return Markup.button.callback(label, callbackData);
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  rows.push([Markup.button.callback("⬅️ Закрити", "remind:close")]);

  return Markup.inlineKeyboard(rows);
};


module.exports = (bot) => {
  const getUserId = (ctx) => String(ctx.from?.id || "");

  // Команда /setremind
  bot.command("setremind", async (ctx) => {
    try {
      const userId = getUserId(ctx);
      const settings = await getUserSettings(userId);
      const keyboard = buildRemindKeyboard(settings);
      const message = "🔔 Налаштуйте, коли отримувати нагадування:";
      await ctx.reply(message, keyboard);
    } catch (err) {
      console.error("❌ setremind command error:", err);
      await ctx.reply("❌ Не вдалося завантажити налаштування.");
    }
  });

  // Обробник для перемикання опцій
  bot.action(/^remind:toggle:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const userId = getUserId(ctx);
      const keyToToggle = ctx.match[1];

      const settings = await getUserSettings(userId);
      settings[keyToToggle] = !settings[keyToToggle];

      await updateUserSettings(userId, settings);

      const updatedKeyboard = buildRemindKeyboard(settings);
      await ctx.editMessageReplyMarkup(updatedKeyboard.reply_markup);
    } catch (err) {
      console.error("❌ remind toggle error:", err);
      await ctx.answerCbQuery("Помилка збереження!", {show_alert: true});
    }
  });

  bot.action("remind:close", async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.deleteMessage();
    } catch (e) {
      // error
    }
  });
};
