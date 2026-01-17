
import { GoogleGenAI } from "@google/genai";
import { POCTRecord, TargetLanguage } from "../types";

export class MedicalAIService {
  constructor() {}

  /**
   * Translates all text fields in a batch of records while preserving IDs and numeric data.
   */
  async translateBatch(
    records: POCTRecord[],
    targetLang: TargetLanguage
  ): Promise<POCTRecord[]> {
    const prompt = `
      Act as a specific Medical Data Translator.
      Translate the values in the JSON array to ${targetLang}.

      STRICT TRANSLATION RULES:
      1. **DETECT & TRANSLATE**: Scan every string value. If a value contains ANY words in a language other than ${targetLang} (especially Chinese/Asian characters), YOU MUST TRANSLATE IT.
      2. **MIXED CONTENT**: If a cell contains a code mixed with text (e.g., "NST#升高" or "WBC High"), KEEP the code/number (e.g., "NST#", "WBC") but TRANSLATE the descriptive text (e.g., "Elevated").
      3. **NUMBERS & IDs**: Do strictly preserve pure IDs (e.g., "A123"), UUIDs, and pure numbers.
      4. **TERMINOLOGY**: Use professional medical terminology (e.g., "Elevated" instead of "High" for blood results, "Positive" for "+").
      5. **COMPLETENESS**: Do not leave any source language characters in the output unless they are proper nouns or untranslatable codes.

      OUTPUT FORMAT:
      - Return a JSON Array of exactly ${records.length} objects.
      - Keep all object Keys (column names) exactly the same.
      - Maintain 1:1 index mapping.

      INPUT DATA:
      ${JSON.stringify(records)}
    `;

    try {
      const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 }
        }
      });

      const text = response.text;
      if (!text) throw new Error("API returned an empty response.");
      
      const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleanedText);
      
      if (!Array.isArray(parsed)) {
        throw new Error("API did not return a JSON array.");
      }
      
      return parsed;
    } catch (error) {
      console.error("Batch translation error:", error);
      throw error;
    }
  }
}
