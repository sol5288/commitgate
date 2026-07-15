/** 타입 선언 — `bin/dispatch.mjs`(런타임은 tsx 없이 로드돼야 하므로 순수 .mjs로 유지)의 타입. */
export declare const VERB_MODULES: Record<string, string>

export type DispatchDecision = { entry: string; rest: string[] } | { unknown: string }

export declare function resolveDispatch(argv: string[]): DispatchDecision
