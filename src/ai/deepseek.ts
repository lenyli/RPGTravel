export const DEEPSEEK_MODEL = 'deepseek-flash';
export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

export type DeepSeekFailure =
  | 'unauthorized'
  | 'payment'
  | 'rate'
  | 'server'
  | 'network'
  | 'cors'
  | 'empty'
  | 'aborted';

export class DeepSeekError extends Error {
  code: DeepSeekFailure;
  constructor(code: DeepSeekFailure, message: string) {
    super(message);
    this.name = 'DeepSeekError';
    this.code = code;
  }
}

export type DeepSeekReply = {
  content: string;
  finishReason: string | null;
};

function safeDetail(text: string, apiKey: string): string {
  return text.replaceAll(apiKey, '').replace(/sk-[A-Za-z0-9_-]+/g, '').slice(0, 160);
}

export async function generateWithDeepSeek(options: {
  apiKey: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<DeepSeekReply> {
  const timeout = AbortSignal.timeout(90_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  let response: Response;
  try {
    response = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content:
              '你是旅章的现实旅行叙事设计师。严格按用户消息中的短标签模板输出，不输出 JSON、Schema 或额外解释。',
          },
          { role: 'user', content: options.prompt },
        ],
        stream: false,
        max_tokens: 6000,
        thinking: { type: 'disabled' },
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw new DeepSeekError('aborted', '已取消生成。');
    if (typeof navigator !== 'undefined' && navigator.onLine === false)
      throw new DeepSeekError(
        'network',
        '当前离线，无法调用 DeepSeek；可关闭 AI，改用复制 Prompt。已经保存的冒险仍可离线使用。',
      );
    throw new DeepSeekError(
      'cors',
      '浏览器未能完成对 DeepSeek 的请求。这是接入问题（常见于跨域或网络中断），不是 Key 错误。',
    );
  }
  if (!response.ok) {
    let detail = '';
    try {
      detail = safeDetail(await response.text(), options.apiKey);
    } catch {
      detail = '';
    }
    if (response.status === 401 || response.status === 403)
      throw new DeepSeekError(
        'unauthorized',
        'DeepSeek Key 无效、过期或没有权限。请修改 Key。',
      );
    if (response.status === 402 || /insufficient|balance|quota/i.test(detail))
      throw new DeepSeekError(
        'payment',
        'DeepSeek 账户余额或计费状态无法完成本次生成。请到 DeepSeek 账户里检查，应用不会更换模型。',
      );
    if (response.status === 429)
      throw new DeepSeekError(
        'rate',
        '请求过于频繁或服务限流。表单还在，可以稍后再试。',
      );
    if (response.status >= 500)
      throw new DeepSeekError(
        'server',
        'DeepSeek 服务暂时不可用。可以关闭 AI，改用复制 Prompt。',
      );
    throw new DeepSeekError(
      'server',
      `DeepSeek 返回了异常状态（${response.status}）。可以稍后重试，或关闭 AI 改用复制 Prompt。`,
    );
  }
  let payload: {
    choices?: { finish_reason?: string | null; message?: { content?: unknown } }[];
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new DeepSeekError('empty', 'DeepSeek 没有返回可读取的故事正文。');
  }
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim())
    throw new DeepSeekError('empty', 'DeepSeek 没有返回故事正文，没有创建冒险。');
  return { content, finishReason: choice?.finish_reason ?? null };
}
