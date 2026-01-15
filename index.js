import express from "express";
import { Telegraf } from "telegraf";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Для webhook нужен публичный URL вашего Render-сервиса (без слеша на конце)
const PUBLIC_URL = process.env.PUBLIC_URL; 
// Например: https://v-norme-bot.onrender.com

if (!TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!PUBLIC_URL) throw new Error("Missing PUBLIC_URL");

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Простейшая память в RAM (быстро, но сбросится при рестарте/деплое)
const memory = new Map(); // chatId -> [{role, content}, ...]

function getHistory(chatId) {
  if (!memory.has(chatId)) memory.set(chatId, []);
  return memory.get(chatId);
}

bot.start(async (ctx) => {
  await ctx.reply("Привет. Опишите ситуацию: цель, ограничения, что именно сейчас не получается.");
});

bot.on("text", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const userText = ctx.message.text;

  const history = getHistory(chatId);

  // ограничим историю, чтобы не раздувать токены
  const trimmed = history.slice(-20);

  const messages = [
    { role: "system", content: "Вы - ассистент по питанию, весу и самочувствию. Без диагнозов и лечения. Отвечайте конкретно и безопасно." },
    ...trimmed,
    { role: "user", content: userText },
  ];

  try {
    await ctx.reply("Секунду, думаю...");

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.5,
    });

    const answer = resp.choices?.[0]?.message?.content?.trim() || "Не смог сформировать ответ. Попробуйте переформулировать.";

    // сохраняем диалог
    history.push({ role: "user", content: userText });
    history.push({ role: "assistant", content: answer });

    await ctx.reply(answer);
  } catch (e) {
    console.error(e);
    await ctx.reply("Ошибка на сервере. Попробуйте ещё раз через минуту.");
  }
});

// webhook endpoint
app.post("/telegram-webhook", (req, res) => {
  bot.handleUpdate(req.body);
  res.sendStatus(200);
});

// healthcheck
app.get("/", (req, res) => {
  res.send("v-norme-bot is alive");
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  // Устанавливаем webhook при старте
  const webhookUrl = `${PUBLIC_URL}/telegram-webhook`;
  await bot.telegram.setWebhook(webhookUrl);
  console.log("Webhook set to:", webhookUrl);
});
