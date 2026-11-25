import { describe, expect, it } from "vitest";
import { isValidWordFormat, normalizeWord } from "../src/normalize";
import { HINT_WORDS, ROUND1, ROUND2, WRONG_GUESS, WRONG_GUESS_2 } from "./helpers";

describe("normalizeWord", () => {
  it("folds width, case and punctuation before judging", () => {
    expect(normalizeWord(" 醫 生 ")).toBe("醫生");
    expect(normalizeWord("醫-生")).toBe("醫生");
    expect(normalizeWord("醫生！！")).toBe("醫生");
    expect(normalizeWord("醫　生")).toBe("醫生"); // ideographic space
    expect(normalizeWord("ＡＢＣ")).toBe("ABC");
  });

  it("converts Simplified characters to Traditional", () => {
    expect(normalizeWord("医院")).toBe("醫院");
    expect(normalizeWord("医生")).toBe("醫生");
    expect(normalizeWord("护士")).toBe("護士");
    expect(normalizeWord("苹果")).toBe("蘋果");
    expect(normalizeWord("护士长")).toBe("護士長");
  });

  it("leaves Traditional text untouched and is idempotent", () => {
    for (const raw of ["醫院", "蘋果", "護士長"]) {
      expect(normalizeWord(raw)).toBe(raw);
      expect(normalizeWord(normalizeWord(raw))).toBe(normalizeWord(raw));
    }
  });

  it("returns an empty string when nothing is left", () => {
    expect(normalizeWord("")).toBe("");
    expect(normalizeWord("   ")).toBe("");
    expect(normalizeWord("!!!???")).toBe("");
  });

  it("keeps every scripted word stable", () => {
    for (const word of [...ROUND1.flat(), ...ROUND2.flat(), ...HINT_WORDS]) {
      expect(normalizeWord(word)).toBe(word);
    }
    expect(normalizeWord(WRONG_GUESS)).toBe(WRONG_GUESS);
    expect(normalizeWord(WRONG_GUESS_2)).toBe(WRONG_GUESS_2);
  });
});

describe("isValidWordFormat", () => {
  it("accepts 1..maxLen Han characters", () => {
    expect(isValidWordFormat("醫", 6)).toBe(true);
    expect(isValidWordFormat("醫生", 6)).toBe(true);
    expect(isValidWordFormat("一二三四五六", 6)).toBe(true);
  });

  it("rejects empty, too long, and non-Han words", () => {
    expect(isValidWordFormat("", 6)).toBe(false);
    expect(isValidWordFormat("一二三四五六七", 6)).toBe(false);
    expect(isValidWordFormat("醫生!", 6)).toBe(false);
    expect(isValidWordFormat("doctor", 6)).toBe(false);
    expect(isValidWordFormat("醫 生", 6)).toBe(false);
    expect(isValidWordFormat("123", 6)).toBe(false);
  });

  it("honours the configured cap", () => {
    expect(isValidWordFormat("醫生", 1)).toBe(false);
    expect(isValidWordFormat("醫", 1)).toBe(true);
  });
});
