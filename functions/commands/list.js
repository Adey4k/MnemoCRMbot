/* eslint max-len: ["error", { "code": 180 }] */
const {db} = require("../firebase");

module.exports = (bot) => {
  const PER_PAGE = 10;
  const MAX_GROUP_BTNS = 4;
  const CACHE_TTL_MS = 20 * 1000;

  const pendingDeletes = new Map();
  const contactsCache = new Map();

  const escapeHTML = (str = "") =>
    String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

  const formatContact = (c, displayIdx) => `   ${displayIdx + 1}. 👤 ${escapeHTML(c.name || "—")}`;
  const buildGroupToggleCallback = (group) => `list:toggle:${encodeURIComponent(group)}`;
  const buildPageCallback = (p) => `list:page:${p}`;
  const buildContactDetailsCallback = (globalIndex) => `list:details:${globalIndex}`;
  const buildDeleteCallback = (globalIndex) => `list:delete:${globalIndex}`;
  const buildCancelDeleteCallback = () => `list:cancel_delete`;

  //  === Утиліти  ===
  const loadContacts = async (userId, bypassCache = false) => {
    const now = Date.now();
    const cached = contactsCache.get(userId);
    if (!bypassCache && cached && (now - cached.ts) < CACHE_TTL_MS) {
      return cached.contacts;
    }

    const snapshot = await db.collection(`contacts_user_${userId}`).get({limit: 990});
    const contacts = snapshot.docs
        .filter((doc) => doc.id !== "reminders_settings")
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt ? doc.data().createdAt.toDate() : new Date(0),
        }));

    contactsCache.set(userId, {contacts, ts: now});
    return contacts;
  };

  const buildCountsAndGroups = (contacts) => {
    const countsByGroup = {};
    const groupsSet = new Set();
    contacts.forEach((c) => {
      const g = c.group || "Інше";
      groupsSet.add(g);
      countsByGroup[g] = (countsByGroup[g] || 0) + 1;
    });
    const uniqueGroups = Array.from(groupsSet).sort((a, b) => a.localeCompare(b, "uk"));
    return {countsByGroup, uniqueGroups};
  };

  const buildOrderedList = (contacts, selectedGroups = ["ALL"]) => {
    let filtered = contacts;
    if (!selectedGroups.includes("ALL")) filtered = filtered.filter((c) => selectedGroups.includes(c.group));

    const filteredSorted = filtered.slice().sort((a, b) => a.createdAt - b.createdAt);

    const groupsFull = {};
    filteredSorted.forEach((c) => {
      const g = c.group || "Інше";
      if (!groupsFull[g]) groupsFull[g] = [];
      groupsFull[g].push(c);
    });

    const orderedGroupNames = Object.keys(groupsFull).sort((a, b) => a.localeCompare(b, "uk"));

    const orderedList = [];
    for (const groupName of orderedGroupNames) {
      for (const c of groupsFull[groupName]) orderedList.push({contact: c, groupName});
    }

    return {orderedList, groupsFull, orderedGroupNames};
  };

  const buildKeyboard = (uniqueGroups, countsByGroup, selectedGroups, page, totalPages, visibleItems) => {
    const rows = [];

    const visibleGroups = uniqueGroups.slice(0, MAX_GROUP_BTNS);
    const groupButtons = visibleGroups.map((g) => {
      const isSelected = selectedGroups.includes("ALL") || selectedGroups.includes(g);
      const count = countsByGroup[g] || 0;
      const label = `${isSelected ? "✅" : "▫️"} ${g} (${count})`;
      return {text: label, callback_data: buildGroupToggleCallback(g)};
    });

    for (let i = 0; i < groupButtons.length; i += 2) rows.push(groupButtons.slice(i, i + 2));

    if (visibleItems && visibleItems.length) {
      const numButtons = visibleItems.map((item, i) => ({
        text: `${i + 1}`,
        callback_data: buildContactDetailsCallback(item.globalIdx),
      }));
      for (let i = 0; i < numButtons.length; i += 5) rows.push(numButtons.slice(i, i + 5));
    }

    if (totalPages > 1) {
      const pageRow = [];
      pageRow.push(page > 1 ? {text: "⬅️ Назад", callback_data: buildPageCallback(page - 1)} : {text: " ", callback_data: "noop"});
      pageRow.push({text: `Стр. ${page}/${totalPages}`, callback_data: "noop"});
      pageRow.push(page < totalPages ? {text: "Вперед ➡️", callback_data: buildPageCallback(page + 1)} : {text: " ", callback_data: "noop"});
      rows.push(pageRow);
    }

    return {inline_keyboard: rows};
  };

  const renderMessage = (contacts, selectedGroups, page, perPage) => {
    const {orderedList} = buildOrderedList(contacts, selectedGroups);

    const total = orderedList.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * perPage;

    const pageItems = [];
    for (let i = start; i < Math.min(start + perPage, orderedList.length); i += 1) {
      const entry = orderedList[i];
      pageItems.push({contact: entry.contact, groupName: entry.groupName, globalIdx: i});
    }

    if (total === 0) return {text: "ℹ️ Контактів не знайдено.", totalPages, safePage, visibleItems: [], start: 0};

    let text = `📇 Ваші контакти (показано ${pageItems.length} із ${total}):\n\n`;

    let lastGroup = null;
    for (let i = 0; i < pageItems.length; i += 1) {
      const item = pageItems[i];
      const displayIdx = i;
      if (item.groupName !== lastGroup) {
        text += `Група "${escapeHTML(item.groupName)}":\n`;
        lastGroup = item.groupName;
      }
      text += formatContact(item.contact, displayIdx) + "\n";
    }

    text += `\nОберіть групу або натисніть номер для деталей 👇`;

    return {text, totalPages, safePage, visibleItems: pageItems, start};
  };

  // Сама команда list
  bot.command("list", async (ctx) => {
    const userId = String(ctx.from.id);
    try {
      const contacts = await loadContacts(userId, false);
      if (!contacts || contacts.length === 0) return ctx.reply("ℹ️ У вас немає збережених контактів.\nНапишіть /add щоб додати контакти");

      const {countsByGroup, uniqueGroups} = buildCountsAndGroups(contacts);
      const selectedGroups = ["ALL"];
      const page = 1;

      const {text, totalPages, safePage, visibleItems} = renderMessage(contacts, selectedGroups, page, PER_PAGE);
      const keyboard = buildKeyboard(uniqueGroups, countsByGroup, selectedGroups, safePage, totalPages, visibleItems);

      return ctx.reply(text, {reply_markup: keyboard, parse_mode: "HTML"});
    } catch (err) {
      console.error("Firestore error:", err);
      return ctx.reply("❌ Помилка при отриманні контактів. Спробуйте пізніше.");
    }
  });

  bot.action("noop", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
  });

  //  === Обробка callback  ===
  bot.action(/^list:(.*)/, async (ctx) => {
    try {
      const data = ctx.callbackQuery && ctx.callbackQuery.data ? ctx.callbackQuery.data : "";
      const parts = data.split(":");
      if (parts.length < 2) {
        await ctx.answerCbQuery().catch(() => {});
        return;
      }
      const action = parts[1];
      const param = parts[2];

      const userId = String(ctx.from.id);
      await ctx.answerCbQuery().catch(() => {});

      const contacts = await loadContacts(userId, false);

      const {countsByGroup, uniqueGroups} = buildCountsAndGroups(contacts);

      let selectedGroups = [];
      const keyboardFromMsg = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard || [];
      keyboardFromMsg.forEach((row) =>
        row.forEach((btn) => {
          try {
            if (btn.callback_data?.startsWith("list:toggle:") && btn.text && btn.text.trim().startsWith("✅")) {
              const group = decodeURIComponent(btn.callback_data.split(":")[2]);
              selectedGroups.push(group);
            }
          } catch (e) {
            // error
          }
        }),
      );
      selectedGroups = Array.from(new Set(selectedGroups));
      if (selectedGroups.length === 0) selectedGroups = ["ALL"];

      const {orderedList} = buildOrderedList(contacts, selectedGroups);

      // Обробка дій
      if (action === "toggle") {
        const target = decodeURIComponent(param || "");
        if (selectedGroups.length === 1 && selectedGroups[0] === target) {
          selectedGroups = ["ALL"];
        } else if (selectedGroups.includes("ALL")) {
          selectedGroups = [target];
        } else {
          const idx = selectedGroups.indexOf(target);
          if (idx >= 0) selectedGroups.splice(idx, 1);
          else selectedGroups.push(target);
          if (!selectedGroups.length) selectedGroups = ["ALL"];
        }
      } else if (action === "page") {
        const num = parseInt(param, 10);
        if (!isNaN(num)) {
          const {text, totalPages, safePage, visibleItems} = renderMessage(contacts, selectedGroups, num, PER_PAGE);
          const newKeyboard = buildKeyboard(uniqueGroups, countsByGroup, selectedGroups, safePage, totalPages, visibleItems);
          try {
            await ctx.editMessageText(text, {reply_markup: newKeyboard, parse_mode: "HTML"});
          } catch (e) {
            try {
              await ctx.reply(text, {reply_markup: newKeyboard, parse_mode: "HTML"});
            } catch (_) {
              // error
            }
          }
          return;
        }
      } else if (action === "delete") {
        const idx = parseInt(param, 10);
        const entry = orderedList[idx];
        if (!entry) {
          await ctx.answerCbQuery("Контакт не знайдено", {show_alert: true});
          return;
        }

        const contact = entry.contact;
        pendingDeletes.set(userId, {
          contactId: contact.id,
          expectedName: String(contact.name || "").trim(),
          listChatId: ctx.callbackQuery.message?.chat?.id,
          listMessageId: ctx.callbackQuery.message?.message_id,
          requestedBy: userId,
        });

        // Відправка підтвердження
        const confirmText = `❗️ Ви впевнені що хочете видалити "<b>${escapeHTML(contact.name || "—")}</b>"?\n\n` +
          `Введіть ім'я контакту щоб підтвердити.`;
        const confirmKeyboard = {
          inline_keyboard: [
            [{text: "Скасувати", callback_data: buildCancelDeleteCallback()}],
          ],
        };

        await ctx.reply(confirmText, {reply_markup: confirmKeyboard, parse_mode: "HTML"});
        return;
      } else if (action === "cancel_delete") {
        const pd = pendingDeletes.get(userId);
        if (pd) {
          if (String(pd.requestedBy) === String(userId)) {
            pendingDeletes.delete(userId);
            await ctx.answerCbQuery("Видалення скасовано", {show_alert: false}).catch(() => {});
            await ctx.reply("❗️ Видалення скасовано.");
            return;
          }
        }
        await ctx.answerCbQuery("Немає активного запиту на видалення", {show_alert: true}).catch(() => {});
        return;
      } else if (action === "details") {
        const idx = parseInt(param, 10);
        const entry = orderedList[idx];
        if (!entry) {
          await ctx.answerCbQuery("Контакт не знайдено", {show_alert: true});
          return;
        }
        const contact = entry.contact;

        let detail = `📋 <b>Деталі контакту</b>\n\n`;
        detail += `👤 <b>Ім'я:</b> ${escapeHTML(contact.name || "—")}\n`;
        detail += `👥 <b>Група:</b> ${escapeHTML(contact.group || "—")}\n`;
        if (contact.birthday) detail += `🎂 <b>День народження:</b> ${escapeHTML(contact.birthday)}\n`;

        if (contact.extraFields && typeof contact.extraFields === "object") {
          const keys = Object.keys(contact.extraFields);
          if (keys.length) {
            detail += `\n📎 <b>Додаткові поля:</b>\n`;
            keys.forEach((k) => {
              const v = contact.extraFields[k];
              detail += `• ${escapeHTML(k)}: ${escapeHTML(v)}\n`;
            });
          }
        }

        if (contact.createdAt) {
          const createdAtStr = (contact.createdAt instanceof Date) ?
            contact.createdAt.toLocaleString("uk-UA") :
            String(contact.createdAt);
          detail += `\n🕒 <b>Створено:</b> ${escapeHTML(createdAtStr)}\n`;
        }

        const detailKeyboard = {
          inline_keyboard: [
            [
              {text: "Редагувати", callback_data: `edit:${contact.id}`},
              {text: "Видалити", callback_data: buildDeleteCallback(idx)},
            ],
          ],
        };

        await ctx.reply(detail, {reply_markup: detailKeyboard, parse_mode: "HTML"});
        return;
      }

      const {text, totalPages, safePage, visibleItems} = renderMessage(contacts, selectedGroups, 1, PER_PAGE);
      const newKeyboard = buildKeyboard(uniqueGroups, countsByGroup, selectedGroups, safePage, totalPages, visibleItems);

      try {
        await ctx.editMessageText(text, {reply_markup: newKeyboard, parse_mode: "HTML"});
      } catch (e) {
        try {
          await ctx.reply(text, {reply_markup: newKeyboard, parse_mode: "HTML"});
        } catch (_) {
          "Error";
        }
      }
    } catch (err) {
      console.error("Callback handler error:", err);
      try {
        await ctx.answerCbQuery("Помилка. Спробуйте пізніше.", {show_alert: false});
      } catch (_) {
        "Error";
      }
    }
  });

  bot.on("text", async (ctx, next) => {
    try {
      const userId = String(ctx.from.id);
      const pending = pendingDeletes.get(userId);
      if (!pending) return next();

      if (String(pending.requestedBy) !== userId) return next();

      const typed = String(ctx.message.text || "").trim();
      if (!typed) return;

      const expected = String(pending.expectedName || "").trim();

      if (typed.toLowerCase() === expected.toLowerCase()) {
        try {
          await db.collection(`contacts_user_${userId}`).doc(pending.contactId).delete();
          // Оновлюємо кеш щоб відобразити зміни при наступних діях
          contactsCache.delete(userId);
        } catch (err) {
          console.error("Delete error (confirm):", err);
          await ctx.reply("❌ Помилка при видаленні. Спробуйте пізніше.");
          pendingDeletes.delete(userId);
          return;
        }

        await ctx.reply(`✅ Контакт "<b>${escapeHTML(expected)}</b>" видалено.`, {parse_mode: "HTML"});

        try {
          const newContacts = await loadContacts(userId, true);
          const {countsByGroup: newCountsByGroup, uniqueGroups: newUniqueGroups} = buildCountsAndGroups(newContacts);
          const {text, totalPages, safePage, visibleItems} = renderMessage(newContacts, ["ALL"], 1, PER_PAGE);
          const newKeyboard = buildKeyboard(newUniqueGroups, newCountsByGroup, ["ALL"], safePage, totalPages, visibleItems);

          if (pending.listChatId && pending.listMessageId) {
            try {
              await ctx.telegram.editMessageText(pending.listChatId, pending.listMessageId, undefined, text, {reply_markup: newKeyboard, parse_mode: "HTML"});
            } catch (e) {
              // error
            }
          }
        } catch (e) {
          console.error("update list after confirm delete error:", e);
        }

        pendingDeletes.delete(userId);
        return;
      }

      await ctx.reply("Ім'я не співпадає. Надішліть точну назву контакту для підтвердження або натисніть «Скасувати».");
    } catch (err) {
      console.error("confirm delete handler error:", err);
    }
  });
};
