import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpExa from "./mcp-exa"
import DESCRIPTION from "./websearch.txt"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "网络搜索查询词" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "返回的搜索结果数量（默认：8）",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "实时抓取模式 —— 'fallback'：若缓存内容不可用则使用实时抓取作为后备；'preferred'：优先使用实时抓取（默认：'fallback'）",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "搜索类型 —— 'auto'：平衡型搜索（默认）；'fast'：快速结果；'deep'：全面搜索",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "面向 LLM 优化的上下文字符串最大字符数（默认：10000）",
  }),
})

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
              contextMaxCharacters: params.contextMaxCharacters,
            },
          })

          const result = yield* McpExa.call(
            http,
            "web_search_exa",
            McpExa.SearchArgs,
            {
              query: params.query,
              type: params.type || "auto",
              numResults: params.numResults || 8,
              livecrawl: params.livecrawl || "fallback",
              contextMaxCharacters: params.contextMaxCharacters,
            },
            "25 seconds",
          )

          return {
            output: result ?? "未找到搜索结果。请尝试更换查询词。",
            title: `Web search: ${params.query}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
