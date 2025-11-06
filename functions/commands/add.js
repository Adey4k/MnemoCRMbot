/* eslint max-len: ["error", { "code": 180 }] */
const {Markup} = require("telegraf");
const {db, admin} = require("../firebase");

// Локальне тимчасове сховище станів користувачів
const userStates = new Map();

module.exports = (bot) => {
  //  === Утиліти  ===
  const getUserId = (ctx) => String(ctx.from?.id || "");

  const getState = (userId) => userStates.get(userId);
  const setState = (userId, state) => userStates.set(userId, state);
  const clearState = (userId) => userStates.delete(userId);

  const checkNameExists = async (userId, name) => {
    try {
      const userCollection = db.collection(`contacts_user_${userId}`);
      const snapshot = await userCollection.where("name", "==", name).limit(1).get();
      return !snapshot.empty;
    } catch (err) {
      console.error("❌ Firestore error (checkNameExists):", err);
      throw err;
    }
  };

  const saveContact = async (userId, state) => {
    const userCollection = db.collection(`contacts_user_${userId}`);
    const doc = {
      name: state.name,
      group: state.group,
      birthday: state.birthday,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (state.extraFields && Object.keys(state.extraFields).length > 0) {
      doc.extraFields = state.extraFields;
    }

    return userCollection.add(doc);
  };

  const buildMoreChoiceKeyboard = (state) =>
    Markup.inlineKeyboard([
      [Markup.button.callback("➡️ Так, додати поля", "add_more_fields")],
      [Markup.button.callback("✅ Ні, завершити", "finish_without_more")],
    ]);

  //  === Команди  ===
  bot.command("add", (ctx) => {
    const userId = getUserId(ctx);
    setState(userId, {step: "await_name"});

    return ctx.reply(
        "📝 Введіть ім’я для нового контакту (до 32 символів):\n(Або напишіть /cancel для скасування)",
    );
  });

  bot.command("cancel", (ctx) => {
    const userId = getUserId(ctx);
    if (getState(userId)) {
      clearState(userId);
      return ctx.reply("❌ Створення контакту скасовано.");
    }
    return ctx.reply("ℹ️ Немає активного процесу для скасування.");
  });

  bot.command("skip", (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);
    if (!state || state.step !== "await_birthday") {
      return ctx.reply("ℹ️ Нема що пропускати зараз.");
    }

    state.birthday = null;
    state.step = "await_more_choice";

    return ctx.reply(
        `🎂 День народження пропущено.\n\n👤 Ім’я: ${state.name}\n👥 Група: ${state.group}\n🎂 День народження: ${state.birthday || "Не вказано"}\n\nХочете додати ще щось?`,
        buildMoreChoiceKeyboard(state),
    );
  });

  bot.command("back", (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);

    if (!state) {
      return ctx.reply("ℹ️ Немає активного процесу для повернення.");
    }

    switch (state.step) {
      // 1. З кроку "введення імені" -> скасування
      case "await_name":
        clearState(userId);
        return ctx.reply("❌ Створення контакту скасовано.");

      // 2. З кроку "вибір групи" -> назад до "введення імені"
      case "await_group":
        state.name = undefined;
        state.step = "await_name";
        return ctx.reply(
            "📝 Введіть ім’я для нового контакту (до 32 символів):\n(Або напишіть /cancel для скасування)",
        );

      // 3. З кроку "введення ДН" -> назад до "вибору групи"
      case "await_birthday":
        state.group = undefined;
        state.step = "await_group";
        return ctx.reply(
            "👥 Оберіть групу для контакту:",
            Markup.inlineKeyboard([
              [Markup.button.callback("👫 Друзі", "group_friends"), Markup.button.callback("🏠 Сім’я", "group_family")],
              [Markup.button.callback("💼 Колеги", "group_colleagues"), Markup.button.callback("📁 Інше", "group_other")],
            ]),
        );

      // 4. З кроку "додати ще?" -> назад до "введення ДН"
      case "await_more_choice":
        state.birthday = undefined;
        state.step = "await_birthday";
        return ctx.reply(
            "🎂 Введіть день народження у форматі ДД.ММ або ДД.ММ.РРРР\nНаприклад, 11.01 або 11.01.2007\n(Або напишіть /skip для пропуску)\n",
        );

      // 5. З кроку "введення назви поля" -> назад до "додати ще?"
      case "await_field_name": {
        state.step = "await_more_choice";

        let replyText = `✅ Введено:\n\n👤 Ім’я: ${state.name}\n👥 Група: ${state.group}\n🎂 День народження: ${state.birthday || "Не вказано"}`;

        if (state.extraFields && Object.keys(state.extraFields).length > 0) {
          replyText += "\n\n📎 Додаткові поля:\n";
          for (const [k, v] of Object.entries(state.extraFields)) {
            replyText += `• ${k}: ${v}\n`;
          }
        }

        replyText += "\n\nХочете додати ще щось?";
        return ctx.reply(replyText, buildMoreChoiceKeyboard(state));
      }

      // 6. З кроку "введення значення поля" -> назад до "введення назви поля"
      case "await_field_value":
        state.currentFieldName = undefined;
        state.step = "await_field_name";
        return ctx.reply(`✍️ Введіть назву додаткового поля (наприклад, "Телефон", "Місто"):\n(Або /back для скасування)`);

      default:
        return ctx.reply("ℹ️ Немає куди повертатися звідси.");
    }
  });

  bot.action("add_more_fields", async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);
    await ctx.answerCbQuery().catch(() => {});

    if (!state || state.step !== "await_more_choice") {
      return ctx.reply("ℹ️ Ця дія недоступна зараз.");
    }

    state.step = "await_field_name";
    return ctx.reply(`✍️ Введіть назву додаткового поля (наприклад, "Телефон", "Місто"):\n(Або /back для скасування)`);
  });

  bot.action("finish_without_more", async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);
    await ctx.answerCbQuery().catch(() => {});

    if (!state || !["await_more_choice", "await_field_name", "await_field_value"].includes(state.step)) {
      return ctx.reply("ℹ️ Немає чого завершувати зараз.");
    }

    try {
      await saveContact(userId, state);

      let replyText =
        `✅ Контакт збережено:\n\n👤 Ім’я: ${state.name}\n👥 Група: ${state.group}\n🎂 День народження: ${state.birthday || "Не вказано"}`;

      if (state.extraFields) {
        replyText += "\n\n📎 Додаткові поля:\n";
        for (const [k, v] of Object.entries(state.extraFields)) {
          replyText += `• ${k}: ${v}\n`;
        }
      }

      await ctx.reply(replyText);
    } catch (err) {
      console.error("Firestore error (saveContact) ", err);
      await ctx.reply("❌ Помилка при збереженні контакту. Спробуйте пізніше.");
      return;
    } finally {
      clearState(userId);
    }
  });

  // Обробка тексту — основний майстер
  bot.on("text", async (ctx, next) => {
    const userId = getUserId(ctx);
    const state = getState(userId);
    if (!state) return next();

    const text = String(ctx.message?.text || "").trim();

    // === await_name ===
    if (state.step === "await_name") {
      if (!text) return ctx.reply("⚠️ Ім’я не може бути порожнім.");
      if (text.length > 32) return ctx.reply("⚠️ Ім’я надто довге.");

      try {
        const exists = await checkNameExists(userId, text);
        if (exists) {
          return ctx.reply(
              `⚠️ Контакт з ім’ям "${text}" вже існує.\nВведіть інше ім’я або /cancel для скасування.`,
          );
        }
      } catch (error) {
        return ctx.reply(`❌ Помилка при перевірці бази: ${error.message}`);
      }

      state.name = text;
      state.step = "await_group";

      return ctx.reply(
          "👥 Оберіть групу для контакту:",
          Markup.inlineKeyboard([
            [Markup.button.callback("👫 Друзі", "group_friends"), Markup.button.callback("🏠 Сім’я", "group_family")],
            [Markup.button.callback("💼 Колеги", "group_colleagues"), Markup.button.callback("📁 Інше", "group_other")],
          ]),
      );
    }

    // === await_birthday ===
    if (state.step === "await_birthday") {
      const dateMatch = text.match(/^(\d{2})\.(\d{2})(?:\.(\d{4}))?$/);
      if (!dateMatch) {
        return ctx.reply(
            "⚠️ Введіть дату у форматі ДД.ММ або ДД.ММ.РРРР (наприклад, 11.01 або 11.01.2007).\n(Або напишіть /skip для пропуску)",
        );
      }

      const day = Number(dateMatch[1]);
      const month = Number(dateMatch[2]);
      const year = dateMatch[3] ? Number(dateMatch[3]) : null;

      if (year) {
        const date = new Date(year, month - 1, day);
        const valid = date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
        if (!valid) return ctx.reply("⚠️ Такої дати не існує. Введіть ще раз:");

        const now = new Date();
        if (date > now) return ctx.reply("⚠️ Дата не може бути з майбутнього. Введіть іншу:");

        state.birthday = text;
      } else {
        if (month < 1 || month > 12 || day < 1 || day > 31) {
          return ctx.reply("⚠️ Такої дати не існує. Введіть ще раз:");
        }
        state.birthday = `${text}.????`;
      }

      state.step = "await_more_choice";

      return ctx.reply(
          `✅ Введено:\n\n👤 Ім’я: ${state.name}\n👥 Група: ${state.group}\n🎂 День народження: ${state.birthday}\n\nХочете додати ще щось?`,
          buildMoreChoiceKeyboard(state),
      );
    }

    // === await_field_name ===
    if (state.step === "await_field_name") {
      if (!text) return ctx.reply("⚠️ Назва не може бути порожньою. Введіть ще раз, або /back");
      if (text.length > 64) return ctx.reply("⚠️ Назва надто довга (макс 64 символи).");

      state.currentFieldName = text;
      state.step = "await_field_value";

      return ctx.reply(`🔑 Введіть значення для поля "${text}":`);
    }

    // === await_field_value ===
    if (state.step === "await_field_value") {
      const value = text;
      if (!state.extraFields) state.extraFields = {};
      state.extraFields[state.currentFieldName] = value;
      const addedName = state.currentFieldName;
      state.currentFieldName = undefined;

      state.step = "await_more_choice";


      let extrasPreview = "";
      for (const [k, v] of Object.entries(state.extraFields)) {
        extrasPreview += `• ${k}: ${v}\n`;
      }

      return ctx.reply(
          `✅ Поле додано: ${addedName}\n\n${extrasPreview ? `📎 Додаткові поля:\n${extrasPreview}\n` : ""}Хочете додати ще щось?`,
          buildMoreChoiceKeyboard(state),
      );
    }
    if (state.step === "await_more_choice") {
      return ctx.reply("ℹ️ Натисніть одну з кнопок під повідомленням, щоб вибрати опцію.");
    }
  });

  const groups = {
    friends: "Друзі",
    family: "Сім’я",
    colleagues: "Колеги",
    other: "Інше",
  };

  for (const [key, label] of Object.entries(groups)) {
    bot.action(`group_${key}`, async (ctx) => {
      const userId = getUserId(ctx);
      const state = getState(userId);
      if (!state || state.step !== "await_group") {
        await ctx.answerCbQuery("Ця дія недоступна зараз.").catch(() => {});
        return;
      }

      state.group = label;
      state.step = "await_birthday";
      await ctx.answerCbQuery().catch(() => {});

      return ctx.reply(
          "🎂 Введіть день народження у форматі ДД.ММ або ДД.ММ.РРРР\nНаприклад, 11.01 або 11.01.2007\n(Або напишіть /skip для пропуску)\n",
      );
    });
  }
};
