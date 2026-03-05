import { NextResponse } from "next/server"
import { z } from "zod"

const AnalyzeRequestSchema = z.object({
  sentence: z.string().min(4).max(800),
  provider: z.enum(["openai", "anthropic"]).optional(),
})

const AnalyzeResponseSchema = z.object({
  sentence: z.string(),
  subject: z.string().min(1),
  verb: z.string().min(1),
  object: z.string().min(1),
  notes: z.array(z.string()).optional(),
})

export const runtime = "nodejs"

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : undefined
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed)
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) throw new Error("Model did not return JSON")
  return JSON.parse(trimmed.slice(start, end + 1))
}

function pickProvider(requested?: "openai" | "anthropic"): "openai" | "anthropic" | "demo" {
  if (requested === "openai") return env("OPENAI_API_KEY") ? "openai" : "demo"
  if (requested === "anthropic") return env("ANTHROPIC_API_KEY") ? "anthropic" : "demo"
  if (env("LLM_PROVIDER") === "anthropic" && env("ANTHROPIC_API_KEY")) return "anthropic"
  if (env("LLM_PROVIDER") === "openai" && env("OPENAI_API_KEY")) return "openai"
  if (env("OPENAI_API_KEY")) return "openai"
  if (env("ANTHROPIC_API_KEY")) return "anthropic"
  return "demo"
}

async function callOpenAI(jsonPrompt: string): Promise<string> {
  const apiKey = env("OPENAI_API_KEY")
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set")
  const model = env("OPENAI_MODEL") ?? "gpt-4.1-mini"
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You do grammatical analysis for English sentences. Output must be valid JSON only, no extra text.",
        },
        { role: "user", content: jsonPrompt },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as any
  const content: string | undefined = data?.choices?.[0]?.message?.content
  if (!content) throw new Error("OpenAI response missing content")
  return content
}

async function callAnthropic(jsonPrompt: string): Promise<string> {
  const apiKey = env("ANTHROPIC_API_KEY")
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const model = env("ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest"
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      temperature: 0.2,
      system: "You do grammatical analysis for English sentences. Output must be valid JSON only, no extra text.",
      messages: [{ role: "user", content: jsonPrompt }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as any
  const text: string | undefined = data?.content?.find?.((c: any) => c?.type === "text")?.text
  if (!text) throw new Error("Anthropic response missing text")
  return text
}

function demoAnalyze(sentence: string) {
  // Very naive fallback: subject = text before first verb-like token; verb = first verb-like token; object = rest.
  const tokens = sentence.replace(/\s+/g, " ").trim().split(" ")
  const verbLike = new Set([
    "is",
    "are",
    "was",
    "were",
    "be",
    "being",
    "been",
    "has",
    "have",
    "had",
    "do",
    "does",
    "did",
    "can",
    "could",
    "will",
    "would",
    "should",
    "may",
    "might",
    "must",
  ])
  let verbIdx = tokens.findIndex((t) => verbLike.has(t.toLowerCase().replace(/[.,;:!?()"']/g, "")))
  if (verbIdx === -1) verbIdx = Math.min(1, tokens.length - 1)
  const subject = tokens.slice(0, verbIdx).join(" ") || tokens[0] || "—"
  const verb = tokens[verbIdx] || "—"
  const object = tokens.slice(verbIdx + 1).join(" ") || "—"
  return AnalyzeResponseSchema.parse({
    sentence,
    subject,
    verb,
    object,
    notes: ["Demo mode analysis (heuristic). Add an API key for more accurate parsing."],
  })
}

export async function POST(req: Request) {
  try {
    const parsedReq = AnalyzeRequestSchema.parse(await req.json())
    const provider = pickProvider(parsedReq.provider)

    if (provider === "demo") {
      return NextResponse.json(demoAnalyze(parsedReq.sentence))
    }

    const jsonPrompt = JSON.stringify(
      {
        task: "Extract Subject-Verb-Object for the given sentence (English).",
        constraints: [
          "Return JSON only, no extra keys beyond: sentence, subject, verb, object, notes (optional).",
          "subject/verb/object should be surface spans from the sentence (not lemmas).",
          "If passive voice: treat grammatical subject as subject; include main verb phrase as verb; object can be agent phrase or '—' if none.",
          "If complex: choose the main clause SVO and mention ambiguities in notes.",
        ],
        sentence: parsedReq.sentence,
        outputShape: {
          sentence: "string",
          subject: "string",
          verb: "string",
          object: "string",
          notes: ["string (optional)"],
        },
      },
      null,
      2,
    )

    const raw = provider === "openai" ? await callOpenAI(jsonPrompt) : await callAnthropic(jsonPrompt)
    const candidate = extractJson(raw)
    const validated = AnalyzeResponseSchema.parse(candidate)
    return NextResponse.json(validated)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json(
      {
        error: "SENTENCE_ANALYSIS_FAILED",
        message,
        hint:
          "Set OPENAI_API_KEY or ANTHROPIC_API_KEY (and optionally LLM_PROVIDER/OPENAI_MODEL/ANTHROPIC_MODEL) to enable full sentence analysis.",
      },
      { status: 500 },
    )
  }
}

