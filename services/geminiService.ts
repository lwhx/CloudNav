import { AIConfig, AIOrganizeResult, AICategorySuggestion, AIProviderConfig, LinkItem } from "../types";
import { normalizeTags } from "./appDataPersistence";
import { getActiveAIProvider } from "./aiConfigService";

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
    } catch (e) {
        console.warn('parseOrganizeResult failed:', e instanceof Error ? e.name : 'unknown',
            'raw length:', value.length, 'raw head:', value.slice(0, 80));
        return {};
    }
};

const parseCategorySuggestions = (value: string, validLinkIds: Set<string>): AICategorySuggestion[] => {
    try {
        const parsed = JSON.parse(extractJsonText(value));
        const rawSuggestions = Array.isArray(parsed) ? parsed : parsed.suggestions;
        if (!Array.isArray(rawSuggestions)) return [];
        return rawSuggestions
            .map(item => ({
                name: typeof item.name === 'string' ? item.name.trim().slice(0, 20) : '',
                icon: typeof item.icon === 'string' ? item.icon.trim() : 'Folder',
                reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 80) : undefined,
                linkIds: Array.isArray(item.linkIds)
                    ? (() => {
                        const linkIds = (item.linkIds as unknown[]).filter((id): id is string => typeof id === 'string' && validLinkIds.has(id));
                        return Array.from(new Set(linkIds));
                      })()
                    : [],
            }))
            .filter(item => item.name && item.linkIds.length > 0)
            .slice(0, 8);
    } catch (e) {
        console.warn('parseCategorySuggestions failed:', e instanceof Error ? e.name : 'unknown',
            'raw length:', value.length, 'raw head:', value.slice(0, 80));
        return [];
    }
};

// 默认模型：若 provider 未指定 model 则用此值，避免请求体缺 model 字段被网关拒绝。
const DEFAULT_MODEL = 'gpt-4o-mini';

const callOpenAICompatible = async (provider: AIProviderConfig, systemPrompt: string, userPrompt: string): Promise<string> => {
    try {
        let baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');

        // 协议校验：仅允许 https，或 http 但仅限本地 LLM。防止恶意配置外泄 API Key。
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(baseUrl);
        } catch {
            console.warn("OpenAI baseUrl 无效");
            return "";
        }
        const isLocalHost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
        if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && isLocalHost)) {
            console.warn("OpenAI baseUrl 协议被拒绝");
            return "";
        }

        // 合并冗余分支：两路原本都追加相同后缀。
        if (!baseUrl.includes('/chat/completions')) {
            baseUrl += '/chat/completions';
        }

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify({
                model: provider.model || DEFAULT_MODEL,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.4
            })
        });

        if (!response.ok) {
            // 仅记录状态码，不输出响应体（某些网关会回显 Authorization 头）。
            console.error("OpenAI API Error status:", response.status);
            return "";
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() || "";
    } catch (e) {
        console.error("OpenAI Call Failed:", e instanceof Error ? e.name : 'unknown');
        return "";
    }
};

export const generateLinkDescription = async (title: string, url: string, config: AIConfig): Promise<string> => {
  const provider = getActiveAIProvider(config);
  if (!provider.apiKey) return "请在设置中配置 API Key";

  const prompt = `
      Title: ${title}
      URL: ${url}
      Please write a very short description (max 15 words) in Chinese (Simplified) that explains what this website is for. Return ONLY the description text. No quotes.
  `;

  try {
    const result = await callOpenAICompatible(provider, "You are a helpful assistant that summarizes website bookmarks.", prompt);
    return result || "生成描述失败";
  } catch (error) {
    console.error("AI generation error:", error instanceof Error ? error.name : 'unknown');
    return "生成描述失败";
  }
};

export const suggestCategory = async (title: string, url: string, categories: {id: string, name: string}[], config: AIConfig): Promise<string | null> => {
    const provider = getActiveAIProvider(config);
    if (!provider.apiKey) return null;

    const catList = categories.map(c => `${c.id}: ${c.name}`).join('\n');
    const prompt = `
        Website: "${title}" (${url})

        Available Categories:
        ${catList}

        Return ONLY the 'id' of the best matching category. If unsure, return 'common'.
    `;

    try {
        const result = await callOpenAICompatible(provider, "You are an intelligent classification assistant. You only output the category ID.", prompt);
        return result || null;
    } catch (e) {
        console.error("suggestCategory error:", e instanceof Error ? e.name : 'unknown');
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
    pageMeta?: { title?: string; description?: string },
): Promise<AIOrganizeResult> => {
    const provider = getActiveAIProvider(config);
    if (!provider.apiKey) return {};

    const categoryList = categories.map(category => `${category.id}: ${category.name}`).join('\n');
    const tagPool = normalizeTags(existingTags).join('、') || '暂无';
    // 页面正文线索：抓取到的 meta title/description 让模型对泛化标题（"首页"/"工具"）也能准确分类。
    const pageTitle = pageMeta?.title?.trim() || title;
    const pageDesc = pageMeta?.description?.trim();
    const prompt = `
请整理这个书签，并只返回 JSON，不要返回 markdown。

书签标题：${title}
书签 URL：${url}
页面标题：${pageTitle}
页面描述：${pageDesc || '（未抓取到）'}
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
        const raw = await callOpenAICompatible(provider, 'You are a bookmark organization assistant. You only return valid JSON.', prompt);
        const result = parseOrganizeResult(raw);
        if (result.categoryId && !categories.some(category => category.id === result.categoryId)) {
            delete result.categoryId;
        }
        result.tags = normalizeTags(result.tags);
        return result;
    } catch (error) {
        console.error('AI organize error:', error instanceof Error ? error.name : 'unknown');
        return {};
    }
};

export const suggestCategoryStructure = async (
    links: LinkItem[],
    categories: { id: string; name: string }[],
    config: AIConfig,
): Promise<AICategorySuggestion[]> => {
    const provider = getActiveAIProvider(config);
    if (!provider.apiKey) return [];

    const activeLinks = links.filter(link => !link.deletedAt).slice(0, 200);
    const validLinkIds = new Set(activeLinks.map(link => link.id));
    const categoryList = categories.map(category => `${category.id}: ${category.name}`).join('\n') || '暂无';
    const linkList = activeLinks.map(link => {
        const tags = normalizeTags(link.tags).join('、') || '无';
        return `- id: ${link.id}\n  title: ${link.title}\n  url: ${link.url}\n  description: ${link.description || '无'}\n  tags: ${tags}`;
    }).join('\n');

    const prompt = `
请分析这些书签，给出“建议新增分类”，只返回 JSON，不要返回 markdown。

现有分类：
${categoryList}

书签列表：
${linkList}

返回格式：
{
  "suggestions": [
    {
      "name": "分类名称，最多 10 个中文字符",
      "icon": "Lucide 图标名，例如 Code、Bot、BookOpen、Palette、Globe、Folder",
      "reason": "为什么建议这个分类，最多 30 字",
      "linkIds": ["要移动到这个新分类的链接 id"]
    }
  ]
}

规则：
- 最多返回 6 个建议分类。
- 不要返回现有分类同名分类。
- 每个建议至少包含 2 个链接。
- linkIds 必须来自书签列表。
- 只做建议，不要要求删除或合并数据。
`;

    try {
        const raw = await callOpenAICompatible(provider, 'You are a bookmark taxonomy assistant. You only return valid JSON.', prompt);
        const existingNames = new Set(categories.map(category => category.name.trim().toLowerCase()));
        return parseCategorySuggestions(raw, validLinkIds).filter(suggestion => !existingNames.has(suggestion.name.toLowerCase()));
    } catch (error) {
        console.error('AI category suggestion error:', error instanceof Error ? error.name : 'unknown');
        return [];
    }
};
