/* eslint-disable max-len */
// залежності
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {Telegraf} = require("telegraf");
const {db} = require("./firebase");

const bot = new Telegraf(process.env.BOT_TOKEN);

// заготовки
const REMINDER_CONFIG = {
  same_day: {days: 0, label: "Сьогодні день народження у"},
  day_before: {days: 1, label: "Завтра день народження у"},
  three_days_before: {days: 3, label: "Через 3 дні день народження у"},
  week_before: {days: 7, label: "Через тиждень день народження у"},
  two_weeks_before: {days: 14, label: "Через 2 тижні день народження у"},
  month_before: {days: 30, label: "Через місяць день народження у"},
  two_months_before: {days: 60, label: "Через 2 місяці день народження у"},
};

// для виводу по хронологічному порядку
const CHRONOLOGICAL_KEYS = [
  "same_day",
  "day_before",
  "three_days_before",
  "week_before",
  "two_weeks_before",
  "month_before",
  "two_months_before",
];

exports.sendBirthdayReminders = onSchedule({
  schedule: "every day 07:00",
  timeZone: "Europe/Kiev",
}, async () => {
  console.log("start reminderScheduler");

  // Отримуємо всі колекції
  const collections = await db.listCollections();
  const userIds = collections
      .map((col) => col.id) // Отримуємо назви всіх колекцій
      .filter((id) => id.startsWith("contacts_user_")) // Фільтруємо ті, що відповідають нашому патерну
      .map((id) => id.replace("contacts_user_", "")); // Витягуємо ID користувача

  if (userIds.length === 0) {
    console.log("👥 Користувацькі колекції не знайдені. Перевірку завершено.");
    return;
  }

  console.log(`👥 Знайдено ${userIds.length} користувачів для перевірки.`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Нагадування для кожного користувача
  const tasks = userIds.map(async (userId) => {
    try {
      const settingsRef = db.collection(`contacts_user_${userId}`).doc("reminders_settings");
      const settingsDoc = await settingsRef.get();
      if (!settingsDoc.exists) return;

      const settings = settingsDoc.data();
      const activeReminders = Object.keys(settings).filter((key) => settings[key] === true);
      if (activeReminders.length === 0) return;

      const contactsSnapshot = await db.collection(`contacts_user_${userId}`).get();
      if (contactsSnapshot.empty) return;

      const remindersBySector = {};

      contactsSnapshot.forEach((doc) => {
        if (doc.id === "reminders_settings" || !doc.data().birthday) return;

        const contact = doc.data();
        const birthdayParts = contact.birthday.match(/^(\d{2})\.(\d{2})/);
        if (!birthdayParts) return;

        const birthDay = parseInt(birthdayParts[1], 10);
        const birthMonth = parseInt(birthdayParts[2], 10) - 1;

        activeReminders.forEach((reminderKey) => {
          const config = REMINDER_CONFIG[reminderKey];
          if (!config) return;

          const targetDate = new Date(today);
          targetDate.setDate(today.getDate() + config.days);

          if (targetDate.getDate() === birthDay && targetDate.getMonth() === birthMonth) {
            if (!remindersBySector[reminderKey]) {
              remindersBySector[reminderKey] = [];
            }
            remindersBySector[reminderKey].push(contact.name);
          }
        });
      });


      if (Object.keys(remindersBySector).length > 0) {
        let message = "🎂 *Нагадування про дні народження!*\n\n";
        let hasContent = false;

        CHRONOLOGICAL_KEYS.forEach((key) => {
          const names = remindersBySector[key];

          if (names && names.length > 0) {
            hasContent = true;
            const config = REMINDER_CONFIG[key];

            message += `*${config.label}:*\n`;
            names.forEach((name) => {
              message += `🎉 *${name}*\n`;
            });
            message += "\n";
          }
        });

        if (hasContent) {
          message += "Не забудьте привітати! 😉";
          await bot.telegram.sendMessage(userId, message, {parse_mode: "Markdown"});
          console.log(`✅ Сповіщення надіслано користувачу ${userId}`);
        }
      }
    } catch (error) {
      if (error.response && error.response.error_code === 403) {
        console.warn(`⚠️ Користувач ${userId} заблокував бота. Пропускаємо.`);
      } else {
        console.error(`❌ Помилка обробки користувача ${userId}:`, error);
      }
    }
  });

  await Promise.all(tasks);
  console.log("✅ Перевірку днів народження успішно завершено.");
});
