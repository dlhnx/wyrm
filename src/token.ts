export const KEYWORDS = [ "and", "else", "false", "fn", "if", "let", "nil", "or", "print", "return", "true", "while" ] as const;

export type Keyword = (typeof KEYWORDS)[number];

export type TokenType =  "(" | ")" | "{" | "}" | "," | ";" | "+" | "-" | "*" | "/" | "!" | "!=" | "=" | "<" | "<=" | ">" | ">=" | "identifier" | "string" | "number" | Keyword | "eof";

export type Literal = number | string | null;

export interface Token {
  readonly type: TokenType;
  readonly lexeme: string;
  readonly literal: Literal;
  readonly line: number,
  readonly col: number;
}

const KEYWORD_SET: ReadonlySet<string> = new Set(KEYWORDS);

export function isKeyword(word: string): word is Keyword {
  return KEYWORD_SET.has(word);
}