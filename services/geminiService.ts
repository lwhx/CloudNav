import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AIConfig, AIOrganizeResult } from "../types";
import { normalizeTags } from "./appDataPersistence";

const extractJsonText = (value: string) => {
    const trimmed = value.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) return fenced[1].trim();
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
    return trimmed;
};

const parseOrganizeResult = (value: string): AIOrganizeResult => {
    try {
        const parsed = JSON.parse(extractJsonText(value));
        return {
            description: typeof parsed.description === 'string' ? parsed.description.trim() : undefined,
            categoryId: typeof parsed.categoryId === 'string' ? parsed.categoryId.trim() : undefined,
            tags: normalizeTags(parsed.tags),
        };
    } catch {
        return {};
    }
};

const callOpenAICompatible = async (config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> => {
    try {
        let baseUrl = config.baseUrl.replace(/\/$/, '');
        if (!baseUrl.includes('/chat/completions')) {
            if (baseUrl.endsWith('/v1')) baseUrl += '/chat/completions';
            else baseUrl += '/chat/completions';
        }

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.4
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error("OpenAI API Error:", err);
            return "";
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() || "";
    } catch (e) {
        console.error("OpenAI Call Failed", e);
        return "";
    }
};

export const generateLinkDescription = async (title: string, url: string, config: AIConfig): Promise<string> => {
  if (!config.apiKey) return "请在设置中配置 API Key";

  const prompt = `
      Title: ${title}
      URL: ${url}
      Please write a very short description (max 15 words) in Chinese (Simplified) that explains what this website is for. Return ONLY the description text. No quotes.
  `;

  try {
    if (config.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: config.apiKey });
        const modelName = config.model || 'gemini-2.5-flash';
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: modelName,
            contents: `I have a website bookmark. ${prompt}`,
        });
        return response.text ? response.text.trim() : "无法生成描述";
    }

    const result = await callOpenAICompatible(config, "You are a helpful assistant that summarizes website bookmarks.", prompt);
    return result || "生成描述失败";
  } catch (error) {
    console.error("AI generation error:", error);
    return "生成描述失败";
  }
};

export const suggestCategory = async (title: string, url: string, categories: {id: string, name: string}[], config: AIConfig): Promise<string | null> => {
    if (!config.apiKey) return null;

    const catList = categories.map(c => `${c.id}: ${c.name}`).join('\n');
    const prompt = `
        Website: "${title}" (${url})

        Available Categories:
        ${catList}

        Return ONLY the 'id' of the best matching category. If unsure, return 'common'.
    `;

    try {
        if (config.provider === 'gemini') {
            const ai = new GoogleGenAI({ apiKey: config.apiKey });
            const modelName = config.model || 'gemini-2.5-flash';
            const response: GenerateContentResponse = await ai.models.generateContent({
                model: modelName,
                contents: `Task: Categorize this website.\n${prompt}`,
            });
            return response.text ? response.text.trim() : null;
        }

        const result = await callOpenAICompatible(config, "You are an intelligent classification assistant. You only output the category ID.", prompt);
        return result || null;
    } catch (e) {
        console.error(e);
        return null;
    }
};

export const organizeLink = async (
    title: string,
    url: string,
    currentDescription: string | undefined,
    categories: { id: string; name: string }[],
    existingTags: string[],
    config: AIConfig,
): Promise<AIOrganizeResult> => {
    if (!config.apiKey) return {};

    const categoryList = categories.map(category => `${category.id}: ${category.name}`).join('\n');
    const tagPool = normalizeTags(existingTags).join('、') || '暂无';
    const prompt = `
请整理这个书签，并只返回 JSON，不要返回 markdown。

书签标题：${title}
书签 URL：${url}
现有描述：${currentDescription || '暂无'}
可选分类：
${categoryList}
已有标签池：${tagPool}

返回格式：
{
  "description": "15 个中文词以内的网站用途描述",
  "categoryId": "最匹配的分类 id，不确定则 common",
  "tags": ["最多 5 个中文短标签"]
}

规则：
- tags 必须简短、去重、不要带 #。
- categoryId 必须从可选分类中选择。
- 不要删除或合并任何数据。
`;

    try {
        let raw = '';
        if (config.provider === 'gemini') {
            const ai = new GoogleGenAI({ apiKey: config.apiKey });
            const modelName = config.model || 'gemini-2.5-flash';
            const response: GenerateContentResponse = await ai.models.generateContent({
                model: modelName,
                contents: prompt,
            });
            raw = response.text || '';
        } else {
            raw = await callOpenAICompatible(config, 'You are a bookmark organization assistant. You only return valid JSON.', prompt);
        }

        const result = parseOrganizeResult(raw);
        if (result.categoryId && !categories.some(category => category.id === result.categoryId)) {
            delete result.categoryId;
        }
        result.tags = normalizeTags(result.tags);
        return result;
    } catch (error) {
        console.error('AI organize error:', error);
        return {};
    }
};
