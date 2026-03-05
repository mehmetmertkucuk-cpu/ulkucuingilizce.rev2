import { NextResponse } from "next/server"
import { z } from "zod"

const LevelSchema = z.enum(["Intermediate", "Advanced", "Academic"])
const TopicSchema = z.enum(["Science", "Social Studies", "Health", "History", "Technology"])
const ProviderSchema = z.enum(["openai", "anthropic"]).optional()

const GenerateRequestSchema = z.object({
  level: LevelSchema,
  topic: TopicSchema,
  provider: ProviderSchema,
})

const QuestionSchema = z.object({
  id: z.string(),
  question: z.string().min(8),
  options: z.array(z.string().min(1)).length(4),
  correctAnswer: z.number().int().min(0).max(3),
  explanation: z.string().optional(),
})

const KeyVocabSchema = z.object({
  word: z.string().min(2),
  pos: z.enum(["noun", "verb", "adjective", "adverb", "preposition"]),
  meaningTr: z.string().min(1),
  example: z.string().min(8),
})

const GenerateResponseSchema = z.object({
  id: z.string().min(3),
  title: z.string().min(3),
  passage: z.string().min(80),
  questions: z.array(QuestionSchema).length(5),
  keyVocabulary: z.array(KeyVocabSchema).min(6).max(14),
  meta: z.object({
    level: LevelSchema,
    topic: TopicSchema,
    estimatedMinutes: z.number().int().min(5).max(25),
    source: z.enum(["llm", "demo"]),
  }),
})

export const runtime = "nodejs"

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : undefined
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed)
  }
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return JSON")
  }
  return JSON.parse(trimmed.slice(start, end + 1))
}

async function callOpenAI(jsonPrompt: string): Promise<string> {
  const apiKey = env("OPENAI_API_KEY")
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set")

  const model = env("OPENAI_MODEL") ?? "gpt-4.1-mini"
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content:
            "You generate YDS/YÖKDİL-style English reading passages and multiple-choice questions. Output must be valid JSON only, no extra text.",
        },
        { role: "user", content: jsonPrompt },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI error: ${res.status} ${body}`)
  }

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
      max_tokens: 1600,
      temperature: 0.8,
      messages: [{ role: "user", content: jsonPrompt }],
      system:
        "You generate YDS/YÖKDİL-style English reading passages and multiple-choice questions. Output must be valid JSON only, no extra text.",
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic error: ${res.status} ${body}`)
  }

  const data = (await res.json()) as any
  const text: string | undefined = data?.content?.find?.((c: any) => c?.type === "text")?.text
  if (!text) throw new Error("Anthropic response missing text")
  return text
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

function demoGenerate(params: { level: z.infer<typeof LevelSchema>; topic: z.infer<typeof TopicSchema> }) {
  const { level, topic } = params
  const now = Date.now()
  const seed = now % 10_000
  const connectors = ["Moreover", "Nevertheless", "Consequently", "By contrast", "In addition", "Accordingly"]
  const academicNouns = [
    "framework",
    "trajectory",
    "constraint",
    "correlation",
    "mechanism",
    "intervention",
    "hypothesis",
    "implication",
    "paradigm",
    "magnitude",
  ]
  const topicLexicon: Record<string, string[]> = {
    Science: ["empirical", "methodology", "replicate", "variables", "data", "laboratory", "measurement"],
    "Social Studies": ["institutions", "inequality", "governance", "norms", "collective", "policy", "demographics"],
    Health: ["prevention", "outcomes", "clinical", "risk", "adherence", "treatment", "public health"],
    History: ["archival", "chronicle", "interpretation", "legacy", "reform", "transition", "context"],
    Technology: ["automation", "infrastructure", "algorithm", "privacy", "efficiency", "deployment", "innovation"],
  }

  const difficulty =
    level === "Intermediate" ? "clear but formal" : level === "Advanced" ? "dense academic" : "highly academic"

  const lex = topicLexicon[topic]
  const c = (i: number) => connectors[(seed + i) % connectors.length]
  const n = (i: number) => academicNouns[(seed + i) % academicNouns.length]
  const t = (i: number) => lex[(seed + i) % lex.length]

  const title = `${topic} and the Limits of ${n(2)[0].toUpperCase()}${n(2).slice(1)}`
  const p1 = `In contemporary discussions of ${topic.toLowerCase()}, researchers increasingly emphasize how a single ${n(
    0,
  )} can shape both short-term outcomes and long-term trends. While the core ideas are often presented in accessible terms, the underlying ${t(
    0,
  )} is typically more complex than it appears. This passage adopts a ${difficulty} register to mirror YDS/YÖKDİL standards.`
  const p2 = `${c(1)}, when analysts focus narrowly on one indicator, they may overlook confounding factors and misinterpret the overall ${n(
    1,
  )}. For instance, improvements in ${t(2)} may coincide with unintended trade-offs in ${t(
    3,
  )}, particularly when resources are limited. Such patterns suggest that effective evaluation requires both careful measurement and a willingness to revise an initial ${n(
    3,
  )}.`
  const p3 = `${c(
    2,
  )}, recent work proposes modest interventions that can reduce these risks without undermining progress. By integrating ${t(
    4,
  )} with transparent decision-making, institutions can strengthen trust and produce more durable results. Even so, the evidence indicates that there is no single solution; rather, success depends on aligning goals, constraints, and incentives within a coherent ${n(
    4,
  )}.`

  const passage = [p1, p2, p3].join("\n\n")

  const keyVocabulary = [
    { word: "contemporary", pos: "adjective", meaningTr: "çağdaş, güncel", example: "Contemporary research often challenges older assumptions." },
    { word: "emphasize", pos: "verb", meaningTr: "vurgulamak", example: "The author emphasizes the need for careful evaluation." },
    { word: "underlying", pos: "adjective", meaningTr: "altta yatan", example: "The underlying mechanism is not fully understood." },
    { word: "overlook", pos: "verb", meaningTr: "gözden kaçırmak", example: "Policymakers may overlook secondary consequences." },
    { word: "confounding", pos: "adjective", meaningTr: "kafa karıştırıcı (değişken)", example: "Confounding variables can distort conclusions." },
    { word: "revise", pos: "verb", meaningTr: "gözden geçirmek, değiştirmek", example: "Researchers revise the hypothesis when new data emerges." },
    { word: "transparent", pos: "adjective", meaningTr: "şeffaf", example: "Transparent reporting improves credibility." },
    { word: "durable", pos: "adjective", meaningTr: "kalıcı, dayanıklı", example: "Durable solutions require long-term planning." },
  ].slice(0, 8)

  const questions = [
    {
      id: "q1",
      question: "What is the main purpose of the passage?",
      options: [
        "To argue that simple indicators always predict long-term trends",
        "To describe why evaluation in the field requires careful, context-aware analysis",
        "To prove that resources are unlimited in institutional settings",
        "To claim that recent work has eliminated all trade-offs",
      ],
      correctAnswer: 1,
      explanation: "The passage stresses complexity, confounders, and context-aware evaluation.",
    },
    {
      id: "q2",
      question: "According to the passage, what risk arises from focusing narrowly on one indicator?",
      options: [
        "It guarantees more accurate measurement",
        "It may lead to overlooking confounding factors",
        "It increases transparency in reporting",
        "It eliminates unintended trade-offs",
      ],
      correctAnswer: 1,
      explanation: "The second paragraph explicitly mentions overlooking confounding factors.",
    },
    {
      id: "q3",
      question: "Which idea is supported by the passage?",
      options: [
        "Effective evaluation often requires revising initial assumptions",
        "Institutions should avoid integrating decision-making with measurement",
        "There is always a single best solution in complex systems",
        "Trade-offs occur only when resources are abundant",
      ],
      correctAnswer: 0,
      explanation: "The text mentions revising an initial framework/paradigm when needed.",
    },
    {
      id: "q4",
      question: "In the passage, the word 'transparent' is closest in meaning to:",
      options: ["hidden", "uncertain", "open and clear", "temporary"],
      correctAnswer: 2,
      explanation: "Transparent decision-making means open and clear.",
    },
    {
      id: "q5",
      question: "What can be inferred about the author’s view of recent interventions?",
      options: [
        "They are irrelevant to progress",
        "They may reduce risks but do not guarantee a universal solution",
        "They always undermine trust",
        "They eliminate the need for long-term planning",
      ],
      correctAnswer: 1,
      explanation: "The passage notes modest interventions help, but no single solution exists.",
    },
  ]

  const id = `demo-${now}-${Math.floor(Math.random() * 1_000_000)}`
  return GenerateResponseSchema.parse({
    id,
    title,
    passage,
    questions,
    keyVocabulary,
    meta: { level, topic, estimatedMinutes: 12, source: "demo" },
  })
}

export async function POST(req: Request) {
  try {
    const parsedReq = GenerateRequestSchema.parse(await req.json())
    const provider = pickProvider(parsedReq.provider)

    const jsonPrompt = JSON.stringify(
      {
        task: "Generate a YDS/YÖKDİL-style English reading practice as JSON.",
        constraints: {
          level: parsedReq.level,
          topic: parsedReq.topic,
          passage: {
            words: parsedReq.level === "Intermediate" ? "180-220" : parsedReq.level === "Advanced" ? "220-270" : "250-320",
            paragraphs: 3,
            style: "academic; cohesive; no bullet points; no lists; no dialogue",
          },
          questions: {
            count: 5,
            optionsEach: 4,
            includeTypes: ["main idea", "detail", "inference", "vocabulary-in-context", "reference/author’s purpose"],
          },
          keyVocabulary: {
            count: "8-12",
            rule: "Choose difficult academic words that appear in the passage. Provide pos, Turkish meaning, and an example sentence.",
          },
          output: "Return JSON only with keys: id, title, passage, questions, keyVocabulary, meta.",
        },
        outputShape: {
          id: "string",
          title: "string",
          passage: "string (paragraphs separated by \\n\\n)",
          questions: [
            { id: "string", question: "string", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "optional string" },
          ],
          keyVocabulary: [{ word: "string", pos: "noun|verb|adjective|adverb|preposition", meaningTr: "string", example: "string" }],
          meta: { level: parsedReq.level, topic: parsedReq.topic, estimatedMinutes: 12, source: "llm" },
        },
      },
      null,
      2,
    )

    if (provider === "demo") {
      return NextResponse.json(demoGenerate({ level: parsedReq.level, topic: parsedReq.topic }))
    }

    const raw =
      provider === "openai" ? await callOpenAI(jsonPrompt) : await callAnthropic(jsonPrompt)

    const candidate = extractJson(raw)
    const validated = GenerateResponseSchema.parse({
      ...candidate,
      meta: {
        ...(typeof (candidate as any)?.meta === "object" && (candidate as any)?.meta ? (candidate as any).meta : {}),
        level: parsedReq.level,
        topic: parsedReq.topic,
        estimatedMinutes: (candidate as any)?.meta?.estimatedMinutes ?? 12,
        source: "llm",
      },
    })

    return NextResponse.json(validated)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json(
      {
        error: "READING_GENERATION_FAILED",
        message,
        hint:
          "Set OPENAI_API_KEY or ANTHROPIC_API_KEY (and optionally LLM_PROVIDER/OPENAI_MODEL/ANTHROPIC_MODEL) to enable full AI generation.",
      },
      { status: 500 },
    )
  }
}

