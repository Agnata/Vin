import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const TYPE_LABEL = { rott: "Rött", vitt: "Vitt", rose: "Rosé", bubbel: "Mousserande", orange: "Orange" };

const Pairing = z.object({
  intro: z.string(),
  val: z.array(z.object({ id: z.number().int(), motivering: z.string() })),
});

// Only mounted when CLAUDE_ENABLED=true and ANTHROPIC_API_KEY is set.
export function claudeRouter(db, config) {
  const r = Router();
  const client = new Anthropic();
  const list = db.prepare("SELECT * FROM wines WHERE quantity > 0 ORDER BY id");

  r.post("/pair", async (req, res) => {
    const dish = String(req.body?.dish || "").trim().slice(0, 300);
    if (!dish) return res.status(400).json({ error: "Skriv vad ni ska äta." });

    const year = new Date().getFullYear();
    const wines = list.all().map(w => {
      const win = w.drink_from ? `${w.drink_from}–${w.drink_to}` : "-";
      return [w.id, TYPE_LABEL[w.type], w.name, w.producer, w.grapes, w.vintage || "-", w.country, w.region, win, w.opened ? "öppnad" : ""].join("|");
    }).join("\n");

    try {
      const response = await client.messages.parse({
        model: config.claude.model,
        max_tokens: 4000,
        output_config: { effort: "low", format: zodOutputFormat(Pairing) },
        system: "Du är en erfaren sommelier som svarar på svenska.",
        messages: [{
          role: "user",
          content: `Vi ska äta: "${dish}". Året är ${year}.
Välj 3 till 5 viner som passar bäst, ENDAST ur listan nedan (format: id|typ|namn|producent|druva|årgång|land|region|drickfönster|status). Välj gärna olika stilar och undvik viner vars drickfönster inte har börjat. Öppnade flaskor är ett plus.
"intro" är en mening om vad som är viktigt för rätten. "motivering" är högst 18 ord.

${wines}`,
        }],
      });
      if (response.stop_reason === "refusal" || !response.parsed_output) {
        return res.status(502).json({ error: "Claude kunde inte svara på den frågan." });
      }
      const ids = new Set(list.all().map(w => w.id));
      const val = response.parsed_output.val.filter(v => ids.has(v.id));
      res.json({ intro: response.parsed_output.intro, val });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "För många frågor just nu. Försök igen om en stund." });
      if (error instanceof Anthropic.AuthenticationError) console.error("Claude: ogiltig API-nyckel");
      else console.error("Claude:", error);
      res.status(502).json({ error: "Det gick inte att få svar från Claude." });
    }
  });

  return r;
}
