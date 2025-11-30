import { GoogleGenAI } from "@google/genai";

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
};

// Fallback content in Chinese
const FALLBACK_BOOKS = [
  { title: "被诅咒的年鉴", lore: "在有风的夜晚，书页会自己翻动。" },
  { title: "虚空低语", lore: "盯着文字看久了，眼睛会流血。" },
  { title: "恶魔百科全书", lore: "书皮的触感像极了人类的皮肤。" },
  { title: "无声颂歌", lore: "这本歌谱会吸收周围所有的声音。" },
  { title: "暗影几何", lore: "书中描绘的形状在三维空间中根本不存在。" },
];

export const generateBookLore = async (): Promise<{ title: string; lore: string }> => {
  const client = getClient();
  if (!client) {
    return FALLBACK_BOOKS[Math.floor(Math.random() * FALLBACK_BOOKS.length)];
  }

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "生成一个关于维多利亚时代恐怖图书馆的古老诅咒书籍标题和一句话描述。请用中文回答。 JSON 格式: { \"title\": \"...\", \"lore\": \"...\" }",
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) throw new Error("No text returned");
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini API Error:", error);
    return FALLBACK_BOOKS[Math.floor(Math.random() * FALLBACK_BOOKS.length)];
  }
};

export const generateWhisper = async (context: string): Promise<string> => {
  const client = getClient();
  if (!client) return "你听到了微弱的抓挠声...";

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `你是图书馆的幽灵实体。根据以下情境给玩家一个简短、模糊、恐怖的低语提示（中文，5-10个字）：${context}。不要使用引号。`,
    });
    return response.text || "有什么东西在看着你...";
  } catch (error) {
    return "阴影正在拉长...";
  }
};

export const generateEndGameStory = async (won: boolean, role: string, survivors: number): Promise<string> => {
    const client = getClient();
    if (!client) return won ? "你活过了这一夜。" : "图书馆吞噬了另一个灵魂。";
  
    try {
      const response = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `为一款恐怖游戏写一个2句话的结局。玩家角色是 ${role}。结果：${won ? "胜利" : "失败"}。幸存者人数：${survivors}。风格：洛夫克拉夫特/维多利亚恐怖。请用中文回答。`,
      });
      return response.text || "长夜终尽，但噩梦永存。";
    } catch (error) {
      return "图书馆的大门永远关闭了。";
    }
  };