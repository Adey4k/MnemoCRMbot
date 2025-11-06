// Налаштування залежностей
const {Telegraf} = require("telegraf");
const {onRequest} = require("firebase-functions/v2/https");
const express = require("express");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Ініціалізація бота
const bot = new Telegraf(process.env.BOT_TOKEN);

const commandsPath = path.join(__dirname, "commands");
fs.readdirSync(commandsPath).forEach((file) => {
  if (file.endsWith(".js")) {
    const commandModule = require(path.join(commandsPath, file));
    if (typeof commandModule === "function") {
      commandModule(bot);
    } else {
      console.warn(`⚠️ Команда ${file} не експортує функцію!`);
    }
  }
});

// Express сервер
const app = express();
app.use(express.json());

// Підключення webhook
app.use(bot.webhookCallback("/webhook"));

// Експорт функції для Firebase
exports.bot = onRequest(app);
const scheduler = require("./reminderScheduler");
exports.sendBirthdayReminders = scheduler.sendBirthdayReminders;

