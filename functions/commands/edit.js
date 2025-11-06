/* eslint max-len: ["error", { "code": 180 }] */
const {Markup} = require("telegraf");
const {db} = require("../firebase");
const {FieldValue} = require("firebase-admin/firestore");

// Мапа станів: userId -> { step, contactId, currentKey, pendingExtraName, tokenMap }
const editStates = new Map();


const checkNameExistsForEdit = async (userId, newName, currentContactId) => {
  try {
    const userCollection = db.collection(`contacts_user_${userId}`);
    const snapshot = await userCollection.where("name", "==", newName).get();
    if (snapshot.empty) {
      return false;
    }
    for (const doc of snapshot.docs) {
      if (doc.id !== currentContactId) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error("❌ Firestore error (checkNameExistsForEdit):", err);
    throw err;
  }
};


module.exports = (bot) => {
  const getUserId = (ctx) => String(ctx.from?.id || "");

  const clearState = (userId) => editStates.delete(userId);
  const getState = (userId) => editStates.get(userId);
  const setState = (userId, st) => editStates.set(userId, st);

  const safe = (v) => (v === undefined || v === null ? "Не вказано" : String(v));

  const buildEditKeyboard = (contact) => {
    const rows = [
      [
        Markup.button.callback("✏️ Змінити ім'я", `edit:action:name:${contact.id}`),
        Markup.button.callback("👥 Змінити групу", `edit:action:group:${contact.id}`),
      ],
      [
        Markup.button.callback("🎂 Змінити день народження", `edit:action:birthday:${contact.id}`),
        Markup.button.callback("📎 Додаткові поля", `edit:action:extras:${contact.id}`),
      ],
      [
        Markup.button.callback("⬅️ Закрити", `edit:action:close:${contact.id}`),
      ],
    ];
    return Markup.inlineKeyboard(rows);
  };

  const formatContactDetails = (c) => {
    let detail = "📋 <b>Деталі контакту</b>\n\n";
    detail += `👤 <b>Ім'я:</b> ${safe(c.name)}\n`;
    detail += `👥 <b>Група:</b> ${safe(c.group)}\n`;
    detail += `🎂 <b>День народження:</b> ${safe(c.birthday)}\n`;
    if (c.extraFields && typeof c.extraFields === "object" && c.extraFields !== null) {
      const keys = Object.keys(c.extraFields);
      if (keys.length) {
        detail += "\n📎 <b>Додаткові поля:</b>\n";
        keys.forEach((k) => {
          detail += `• ${k}: ${safe(c.extraFields[k])}\n`;
        });
      }
    }
    return detail;
  };

  const replyContactDetails = async (ctx, userId, contactId, successMessage = null) => {
    try {
      const doc = await db.collection(`contacts_user_${userId}`).doc(contactId).get();
      if (!doc.exists) {
        return ctx.reply("⚠️ Контакт не знайдено або вже видалений.");
      }
      const contact = {...doc.data(), id: doc.id};
      let messageText = formatContactDetails(contact);
      if (successMessage) {
        messageText = `${successMessage}\n\n${messageText}`;
      }
      const keyboard = buildEditKeyboard(contact);
      const options = {parse_mode: "HTML", reply_markup: keyboard.reply_markup};

      if (ctx.callbackQuery) {
        await ctx.editMessageText(messageText, options).catch(() => ctx.reply(messageText, options));
      } else {
        await ctx.reply(messageText, options);
      }
    } catch (err) {
      console.error("❌ replyContactDetails error:", err);
      await ctx.reply("❌ Помилка при оновленні деталей контакту.").catch(() => {});
    }
  };

  // Утиліта: створити унікальний короткий токен для ключа
  const makeToken = (index = 0) => `tk_${Date.now().toString(36)}_${index}`;

  // Функція для показу меню додаткових полів
  const showExtrasMenu = async (ctx, userId, contactId) => {
    try {
      const doc = await db.collection(`contacts_user_${userId}`).doc(contactId).get();
      if (!doc.exists) return ctx.reply("⚠️ Контакт не знайдено.");

      const contactData = doc.data();
      let extra = {};
      if (contactData && typeof contactData.extraFields === "object" && contactData.extraFields !== null) {
        extra = contactData.extraFields;
      }

      const keys = Object.keys(extra);
      const rows = [];
      let text = "📎 Оберіть поле для редагування або додайте нове:";
      if (keys.length === 0) {
        text = "📎 У цього контакту немає додаткових полів.";
      }

      const tokenMap = {};
      keys.forEach((k, i) => {
        const token = makeToken(i);
        tokenMap[token] = k;
        rows.push([
          Markup.button.callback(`✏️ ${k}`, `edit:extra_edit:${contactId}:${token}`),
          Markup.button.callback(`🗑 ${k}`, `edit:extra_delete:${contactId}:${token}`),
        ]);
      });

      rows.push([Markup.button.callback("➕ Додати поле", `edit:action:add_extra:${contactId}`)]);
      rows.push([Markup.button.callback("⬅️ Назад", `edit:action:back:${contactId}`)]);

      // Зберігаємо tokenMap у стані
      setState(userId, {step: "idle", contactId, tokenMap});

      const keyboard = Markup.inlineKeyboard(rows);
      const options = {reply_markup: keyboard.reply_markup};

      if (ctx.callbackQuery) {
        return await ctx.editMessageText(text, options).catch(() => ctx.reply(text, options));
      } else {
        return await ctx.reply(text, options);
      }
    } catch (err) {
      console.error("❌ showExtrasMenu error:", err);
      await ctx.reply("❌ Помилка при показі меню 'Додаткові поля'.");
    }
  };


  bot.action(/^edit:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(() => {});
      const userId = getUserId(ctx);
      const data = ctx.match[1];
      const params = data.split(":");

      const command = params[0];

      if (params.length === 1 && command !== "action") {
        const contactId = command;
        setState(userId, {step: "idle", contactId});
        return await replyContactDetails(ctx, userId, contactId);
      }

      if (command === "action") {
        const action = params[1];
        const contactId = params[2];

        if (action === "name") {
          setState(userId, {step: "await_name", contactId});
          return ctx.reply("✍️ Введіть нове ім'я контакту:");
        }
        if (action === "birthday") {
          setState(userId, {step: "await_birthday", contactId});
          return ctx.reply("🎂 Введіть день народження у форматі ДД.ММ або ДД.ММ.РРРР (або /clear щоб видалити):");
        }
        if (action === "group") {
          setState(userId, {step: "idle", contactId});
          const rows = [
            [Markup.button.callback("👫 Друзі", `edit:set_group:${contactId}:Друзі`), Markup.button.callback("🏠 Сім'я", `edit:set_group:${contactId}:Сім'я`)],
            [Markup.button.callback("💼 Колеги", `edit:set_group:${contactId}:Колеги`), Markup.button.callback("📁 Інше", `edit:set_group:${contactId}:Інше`)],
          ];
          const text = "👥 Оберіть нову групу:";
          const keyboard = Markup.inlineKeyboard(rows);
          const options = {reply_markup: keyboard.reply_markup};
          return await ctx.editMessageText(text, options).catch(() => ctx.reply(text, options));
        }
        if (action === "extras") {
          return await showExtrasMenu(ctx, userId, contactId);
        }
        if (action === "add_extra") {
          const state = getState(userId) || {};
          setState(userId, {...state, step: "await_new_extra_name", contactId});
          await ctx.deleteMessage().catch(() => {});
          return ctx.reply("🔑 Введіть назву нового поля (наприклад, Телефон, Місто):");
        }
        if (action === "close") {
          clearState(userId);
          return await ctx.deleteMessage().catch(() => {});
        }
        if (action === "back") {
          clearState(userId);
          return await replyContactDetails(ctx, userId, contactId);
        }
      }

      if (command === "extra_edit") {
        const contactId = params[1];
        const token = params[2];
        const state = getState(getUserId(ctx)) || {};

        if (!state.tokenMap || !state.tokenMap[token]) {
          return await ctx.reply("❌ Помилка стану (tokenMap). Будь ласка, поверніться до контакту та спробуйте відкрити 'Додаткові поля' знову.");
        }
        const key = state.tokenMap[token];

        setState(userId, {step: "await_edit_extra_value", contactId, currentKey: key, tokenMap: state.tokenMap});
        await ctx.deleteMessage().catch(() => {});
        return await ctx.reply(`✍️ Введіть нове значення для поля "${key}":`);
      }
      if (command === "extra_delete") {
        const contactId = params[1];
        const token = params[2];
        const state = getState(getUserId(ctx)) || {};

        if (!state.tokenMap || !state.tokenMap[token]) {
          return await ctx.reply("❌ Помилка стану (tokenMap). Будь ласка, поверніться до контакту та спробуйте відкрити 'Додаткові поля' знову.");
        }
        const key = state.tokenMap[token];

        const docRef = db.collection(`contacts_user_${userId}`).doc(contactId);
        await docRef.update({[`extraFields.${key}`]: FieldValue.delete()});

        return await replyContactDetails(ctx, userId, contactId, `✅ Поле "${key}" видалено.`);
      }

      if (command === "set_group") {
        const contactId = params[1];
        const groupName = params[2];
        await db.collection(`contacts_user_${userId}`).doc(contactId).update({group: groupName});
        clearState(userId);
        return await replyContactDetails(ctx, userId, contactId, `✅ Групу змінено на "${groupName}".`);
      }
    } catch (err) {
      console.error("❌ edit action handler error:", err);
      await ctx.reply("❌ Помилка обробки дії. Спробуйте пізніше.").catch(() => {});
    }
  });


  bot.on("text", async (ctx, next) => {
    const userId = getUserId(ctx);
    const state = getState(userId);
    if (!state?.step?.startsWith("await_")) return next();

    const text = String(ctx.message?.text || "").trim();
    if (!text) return;

    try {
      const contactId = state.contactId;
      let successMessage = "";

      if (state.step === "await_name") {
        if (text.length > 64) return ctx.reply("⚠️ Ім'я надто довге (макс 64 символи).");
        const exists = await checkNameExistsForEdit(userId, text, contactId);
        if (exists) {
          return ctx.reply(
              `⚠️ Контакт з ім’ям "${text}" вже існує.\nВведіть інше ім’я.`,
          );
        }

        await db.collection(`contacts_user_${userId}`).doc(contactId).update({name: text});
        successMessage = `✅ Ім'я змінено на "${text}".`;
      } else if (state.step === "await_birthday") {
        if (text === "/clear") {
          await db.collection(`contacts_user_${userId}`).doc(contactId).update({birthday: FieldValue.delete()});
          successMessage = "✅ Дані про день народження видалено.";
        } else {
          const dateMatch = text.match(/^(\d{2})\.(\d{2})(?:\.(\d{4}))?$/);
          if (!dateMatch) return ctx.reply("⚠️ Невірний формат. Введіть ДД.ММ або ДД.ММ.РРРР.");
          await db.collection(`contacts_user_${userId}`).doc(contactId).update({birthday: text});
          successMessage = `✅ День народження оновлено: ${text}`;
        }
      } else if (state.step === "await_new_extra_name") {
        if (text.length > 64) return ctx.reply("⚠️ Назва поля надто довга (макс 64 символи).");
        setState(userId, {...state, step: "await_new_extra_value", pendingExtraName: text});
        return ctx.reply(`🔑 Введіть значення для поля "${text}":`);
      } else if (state.step === "await_new_extra_value" || state.step === "await_edit_extra_value") {
        const key = state.pendingExtraName || state.currentKey;
        if (!key) throw new Error("Внутрішня помилка: ключ поля відсутній");
        await db.collection(`contacts_user_${userId}`).doc(contactId).update({[`extraFields.${key}`]: text});
        successMessage = `✅ Поле "${key}" збережено.`;
      }

      clearState(userId);
      if (successMessage) {
        await replyContactDetails(ctx, userId, contactId, successMessage);
      }
    } catch (err) {
      console.error("❌ edit text handler error:", err);
      if (err.message && err.message.includes("Firestore error")) {
        await ctx.reply("❌ Помилка бази даних. Не вдалося зберегти. Спробуйте пізніше.");
      } else {
        await ctx.reply("❌ Помилка збереження. Спробуйте ще раз.");
      }
    }
  });
};
