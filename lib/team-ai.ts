const fallbackModel = "gemini-3.1-flash-lite";

type GeminiInput = {
  system: string;
  prompt: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs?: number;
  schema?: Record<string, unknown>;
};

export function generateGeminiOutput(input: GeminiInput & { schema: Record<string, unknown> }, fetcher?: typeof fetch): Promise<unknown>;
export function generateGeminiOutput(input: GeminiInput & { schema?: undefined }, fetcher?: typeof fetch): Promise<string>;
export async function generateGeminiOutput({ system, prompt, apiKey, model, maxOutputTokens, timeoutMs = 30_000, schema }: GeminiInput, fetcher: typeof fetch = fetch): Promise<unknown | string> {
  const modelId = model.replace(/^models\//, "");
  if (!/^[a-zA-Z0-9._-]+$/.test(modelId)) throw new Error("AI_INVALID_MODEL");
  const models = modelId === fallbackModel ? [modelId] : [modelId, fallbackModel];

  let response: Response | undefined;
  let responseModel = modelId;
  for (let i = 0; i < models.length; i++) {
    responseModel = models[i];
    const isGemini3OrNewer = /^gemini-[34](?:[.-])/.test(responseModel);
    try {
      response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${responseModel}:generateContent`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens,
            ...(isGemini3OrNewer ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
            ...(schema ? { responseFormat: { text: { mimeType: "APPLICATION_JSON", schema } } } : {}),
          },
        }),
      });
    } catch (error) {
      const retryableTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (!retryableTimeout || i === models.length - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 700));
      continue;
    }
    if (response.status !== 503 || i === models.length - 1) break;
    if (response.body) await response.body.cancel().catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 700));
  }

  if (!response?.ok) {
    const status = response?.status ?? 502;
    let code = "";
    if (response) {
      try {
        const data = await response.json() as { error?: { status?: string } };
        code = data.error?.status || "";
      } catch { /* Keep the HTTP status when the provider body is not JSON. */ }
    }
    throw new Error(`AI_PROVIDER_ERROR:${status}:${responseModel}:${code}`);
  }

  const data = await response.json() as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  if (data.promptFeedback?.blockReason) throw new Error("AI_BLOCKED");
  const candidate = data.candidates?.[0];
  const output = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text ?? "").join("").trim();
  if (candidate?.finishReason !== "STOP" || !output) throw new Error(`AI_INCOMPLETE:${candidate?.finishReason || "NO_CANDIDATE"}`);
  return schema ? JSON.parse(output) as unknown : output;
}
