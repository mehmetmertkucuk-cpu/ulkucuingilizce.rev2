import { NextResponse } from "next/server"
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

const DifficultySchema = z.enum(["Intermediate", "Advanced", "Academic"])

const GenerateRequestSchema = z.object({
  // Optional: if omitted, route randomizes for “infinite” variation.
  difficulty: DifficultySchema.optional(),
  topic: z.string().min(2).max(40).optional(),
  provider: z.enum(["openai", "anthropic"]).optional(),
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
    difficulty: DifficultySchema,
    topic: z.string().min(2),
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
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed)
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) throw new Error("Model did not return JSON")
  return JSON.parse(trimmed.slice(start, end + 1))
}

function randomPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
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

const TOPICS = [
  "Economy",
  "Biology",
  "Space",
  "Climate Policy",
  "Public Health",
  "Artificial Intelligence",
  "Psychology",
  "Energy",
  "Education",
  "Sociology",
  "History of Science",
  "Urban Planning",
  "Genetics",
  "Astronomy",
  "Technology Ethics",
] as const

function demoGenerate(params: { difficulty: z.infer<typeof DifficultySchema>; topic: string }) {
  const { difficulty, topic } = params
  const now = Date.now()
  const title = `${topic}: Evidence, Trade-offs, and Policy`

  const passage =
    `In contemporary debates about ${topic.toLowerCase()}, researchers often disagree not only about outcomes but also about which indicators deserve priority. ` +
    `While some frameworks emphasize efficiency, others stress equity and long-term resilience, a tension that becomes more pronounced as institutions operate under constraints.\n\n` +
    `Nevertheless, the accumulation of empirical studies has clarified at least one point: context matters. Interventions that succeed in one setting may fail elsewhere because of demographic, cultural, or infrastructural differences. ` +
    `As a result, analysts increasingly argue for transparent evaluation methods and cautious generalization.\n\n` +
    `Accordingly, recent proposals call for incremental reforms rather than sweeping transformations. By combining rigorous measurement with adaptive governance, policymakers can respond to new evidence without undermining public trust. ` +
    `Yet the literature suggests that durable progress depends on aligning incentives across stakeholders, not merely on adopting a single best practice.`

  const keyVocabulary = [
    { word: "framework", pos: "noun", meaningTr: "çerçeve, yapı", example: "A clear framework helps interpret complex findings." },
    { word: "equity", pos: "noun", meaningTr: "hakkaniyet, eşitlik", example: "Equity is often central to public policy debates." },
    { word: "resilience", pos: "noun", meaningTr: "dayanıklılık", example: "Resilience can determine how systems respond to shocks." },
    { word: "constraints", pos: "noun", meaningTr: "kısıtlar", example: "Budget constraints limit the scope of interventions." },
    { word: "empirical", pos: "adjective", meaningTr: "deneysel, gözleme dayalı", example: "Empirical evidence is required to support the claim." },
    { word: "transparent", pos: "adjective", meaningTr: "şeffaf", example: "Transparent methods improve credibility." },
    { word: "incremental", pos: "adjective", meaningTr: "kademeli", example: "Incremental change can be more sustainable." },
    { word: "stakeholders", pos: "noun", meaningTr: "paydaşlar", example: "Stakeholders may have competing priorities." },
  ]

  const questions = [
    {
      id: "q1",
      question: "What is the main idea of the passage?",
      options: [
        "Indicators are universally applicable across contexts",
        "Context-sensitive evaluation is essential when discussing complex issues",
        "Sweeping reforms always outperform incremental changes",
        "Public trust is irrelevant to policy implementation",
      ],
      correctAnswer: 1,
    },
    {
      id: "q2",
      question: "According to the passage, why might an intervention fail in a different setting?",
      options: [
        "Because demographic and infrastructural factors can differ",
        "Because transparency is always harmful",
        "Because institutions have unlimited resources",
        "Because efficiency never matters",
      ],
      correctAnswer: 0,
    },
    {
      id: "q3",
      question: "The word 'incremental' in the third paragraph is closest in meaning to:",
      options: ["sudden", "gradual", "uncertain", "temporary"],
      correctAnswer: 1,
    },
    {
      id: "q4",
      question: "Which of the following is implied about policy decisions?",
      options: [
        "They require aligning incentives among stakeholders",
        "They should ignore empirical studies",
        "They must always be identical across countries",
        "They are determined solely by cultural preferences",
      ],
      correctAnswer: 0,
    },
    {
      id: "q5",
      question: "What does the author suggest about evaluation methods?",
      options: [
        "They should be transparent and cautious in generalization",
        "They should focus only on a single indicator",
        "They are unnecessary if outcomes look positive",
        "They should avoid measurement to reduce bias",
      ],
      correctAnswer: 0,
    },
  ]

  return GenerateResponseSchema.parse({
    id: `demo-${now}-${Math.floor(Math.random() * 1_000_000)}`,
    title,
    passage,
    questions,
    keyVocabulary,
    meta: { difficulty, topic, estimatedMinutes: 12, source: "demo" },
  })
}

async function generateWithOpenAI(prompt: string) {
  const apiKey = env("OPENAI_API_KEY")
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set")
  const client = new OpenAI({ apiKey })
  const model = env("OPENAI_MODEL") ?? "gpt-4.1-mini"
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.85,
    messages: [
      {
        role: "system",
        content:
          "You generate YDS/YÖKDİL-style English reading passages. Output must be valid JSON only, no markdown, no extra text.",
      },
      { role: "user", content: prompt },
    ],
  })
  return resp.choices?.[0]?.message?.content ?? ""
}

async function generateWithAnthropic(prompt: string) {
  const apiKey = env("ANTHROPIC_API_KEY")
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const client = new Anthropic({ apiKey })
  const model = env("ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest"
  const resp = await client.messages.create({
    model,
    temperature: 0.85,
    max_tokens: 1800,
    system: "You generate YDS/YÖKDİL-style English reading passages. Output must be valid JSON only, no markdown, no extra text.",
    messages: [{ role: "user", content: prompt }],
  })
  const text = resp.content.find((c) => c.type === "text")?.text
  return text ?? ""
}

export async function POST(req: Request) {
  try {
    const body = GenerateRequestSchema.parse(await req.json().catch(() => ({})))

    const difficulty = body.difficulty ?? randomPick(["Intermediate", "Advanced", "Academic"] as const)
    const topic = body.topic ?? randomPick(TOPICS)
    const provider = pickProvider(body.provider)

    const variation = [
      "Include at least one contrast marker (however/nevertheless) and one addition marker (moreover/furthermore).",
      "Use a slightly different rhetorical structure than typical textbook writing (but stay academic).",
      "Avoid repeating the same sentence openings; vary cadence and clause structure.",
      "Prefer passive voice only when natural; keep clarity high.",
      "No lists, no bullet points, no dialogue.",
    ]

    const prompt = JSON.stringify(
      {
        task: "Generate a YDS/YÖKDİL-style English reading passage with 5 MCQs and a key vocabulary list.",
        variation: {
          instruction:
            "Vary the topic and difficulty across generations. Do NOT reuse the same examples; make the passage unique.",
          chosenDifficulty: difficulty,
          chosenTopic: topic,
          extraRules: variation,
        },
        passage: {
          paragraphs: 3,
          lengthWords: difficulty === "Intermediate" ? "180-220" : difficulty === "Advanced" ? "220-270" : "250-320",
          style: "academic, cohesive, exam-like (YDS/YÖKDİL); no headings inside the passage",
        },
        questions: {
          count: 5,
          optionsEach: 4,
          mix: ["main idea", "detail", "inference", "vocabulary-in-context", "reference/author purpose"],
          rule: "Only one correct option; plausible distractors.",
        },
        keyVocabulary: {
          count: "8-12",
          rule: "Select difficult academic words that appear in the passage; include pos, Turkish meaning, and an example sentence.",
        },
        output: {
          format: "JSON only",
          shape: {
            id: "string",
            title: "string",
            passage: "string with paragraphs separated by \\n\\n",
            questions: [{ id: "string", question: "string", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "optional" }],
            keyVocabulary: [{ word: "string", pos: "noun|verb|adjective|adverb|preposition", meaningTr: "string", example: "string" }],
            meta: { difficulty, topic, estimatedMinutes: 12, source: "llm" },
          },
        },
      },
      null,
      2,
    )

    if (provider === "demo") {
      return NextResponse.json(demoGenerate({ difficulty, topic }))
    }

    const raw =
      provider === "openai" ? await generateWithOpenAI(prompt) : await generateWithAnthropic(prompt)

    const candidate = extractJson(raw)
    const validated = GenerateResponseSchema.parse({
      ...candidate,
      meta: {
        ...(typeof (candidate as any)?.meta === "object" && (candidate as any)?.meta ? (candidate as any).meta : {}),
        difficulty,
        topic,
        estimatedMinutes: (candidate as any)?.meta?.estimatedMinutes ?? 12,
        source: "llm",
      },
    })

    return NextResponse.json(validated)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json(
      {
        error: "GENERATE_READING_FAILED",
        message,
        hint:
          "Set OPENAI_API_KEY or ANTHROPIC_API_KEY (and optionally LLM_PROVIDER/OPENAI_MODEL/ANTHROPIC_MODEL).",
      },
      { status: 500 },
    )
  }
}

