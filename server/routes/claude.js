import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const TYPE_LABEL = { rott: "Rött", vitt: "Vitt", rose: "Rosé", bubbel: "Mousserande", sott: "Sött", orange: "Orange" };

const Pairing = z.object({
  intro: z.string(),
  val: z.array(z.object({ id: z.number().int(), motivering: z.string() })),
});

const Label = z.object({
  found: z.boolean().describe("false om bilden inte visar en vinetikett"),
  type: z.enum(["rott", "vitt", "rose", "bubbel", "sott", "orange"]),
  name: z.string(),
  producer: z.string(),
  grapes: z.string(),
  vintage: z.string().describe("fyra siffror, eller tom sträng om årgång saknas"),
  country: z.string(),
  region: z.string(),
  style: z.string(),
  drink_from: z.number().int().nullable(),
  drink_to: z.number().int().nullable(),
  taste1: z.number().int(),
  taste2: z.number().int(),
  taste3: z.number().int(),
  note: z.string(),
});
// A composed dish: Claude first reads what drives the wine choice, then ranks bottles from the cellar.
const DetailedPairing = z.object({
  analys: z.string().describe("2–3 meningar om vad i rätten som styr vinvalet"),
  nycklar: z.array(z.string()).describe("2–4 korta nyckelord, t.ex. 'brynt smör kräver fyllighet'"),
  val: z.array(z.object({
    id: z.number().int(),
    motivering: z.string(),
    servering: z.string().describe("temperatur, eventuell luftning eller karaffering"),
  })),
  undvik: z.string().describe("en mening om vilken typ av vin som krockar med rätten"),
  saknas: z.string().describe("vilken stil som skulle passa ännu bättre om källaren saknar den, annars tom sträng"),
});
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const clamp = n => Math.min(12, Math.max(1, Math.round(n)));

// Only mounted when CLAUDE_ENABLED=true and ANTHROPIC_API_KEY is set.
export function claudeRouter(db, config) {
  const r = Router();
  const client = config.claude.client || new Anthropic(); // tests pass a stand-in client
  const list = db.prepare("SELECT * FROM wines WHERE quantity > 0 ORDER BY id");
  const cellar = () => list.all().map(w => {
    const win = w.drink_from ? `${w.drink_from}–${w.drink_to}` : "-";
    return [w.id, TYPE_LABEL[w.type], w.name, w.producer, w.grapes, w.vintage || "-", w.country, w.region, win, w.opened ? "öppnad" : ""].join("|");
  }).join("\n");
  const failed = (res, error) => {
    if (error instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "För många frågor just nu. Försök igen om en stund." });
    if (error instanceof Anthropic.AuthenticationError) console.error("Claude: ogiltig API-nyckel");
    else console.error("Claude:", error);
    res.status(502).json({ error: "Det gick inte att få svar från Claude." });
  };

  r.post("/pair", async (req, res) => {
    const dish = String(req.body?.dish || "").trim().slice(0, 300);
    if (!dish) return res.status(400).json({ error: "Skriv vad ni ska äta." });

    const year = new Date().getFullYear();
    const wines = cellar();

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
    } catch (error) { failed(res, error); }
  });

  // A fuller description of a composed dish (preparation, sauce, sides, spices) gets a more careful answer.
  r.post("/pair/detail", async (req, res) => {
    const dish = String(req.body?.dish || "").trim().slice(0, 1000);
    if (!dish) return res.status(400).json({ error: "Beskriv rätten." });
    const year = new Date().getFullYear();
    try {
      const response = await client.messages.parse({
        model: config.claude.model,
        max_tokens: 6000,
        output_config: { effort: "medium", format: zodOutputFormat(DetailedPairing) },
        system: "Du är en erfaren sommelier som svarar på svenska. Du är konkret och utgår från rättens alla delar, inte bara huvudråvaran.",
        messages: [{
          role: "user",
          content: `Vi ska äta en komponerad rätt. Året är ${year}. Beskrivning:
"""
${dish}
"""
Gå igenom rätten innan du väljer: vilken del som dominerar smakmässigt (ofta såsen eller tillagningen snarare än råvaran), fett, syra, sälta, sötma, beska, hetta och rökighet, och hur tillbehören påverkar.
Välj sedan 1 till 4 viner, ENDAST ur listan nedan (format: id|typ|namn|producent|druva|årgång|land|region|drickfönster|status), bäst först. Undvik viner vars drickfönster inte har börjat eller har passerat. Öppnade flaskor är ett plus om de passar lika bra.
- "analys": 2–3 meningar om vad som styr vinvalet.
- "nycklar": 2–4 korta nyckelord om rättens delar och vad de kräver av vinet.
- "motivering": högst 40 ord om varför just det vinet fungerar med rättens delar.
- "servering": kort, t.ex. "16 °C, gärna luftat en halvtimme".
- "undvik": en mening om vilken typ av vin som krockar.
- "saknas": om inget vin i listan passar riktigt bra, vilken stil som skulle passa bättre; annars tom sträng.

${cellar()}`,
        }],
      });
      const out = response.parsed_output;
      if (response.stop_reason === "refusal" || !out) return res.status(502).json({ error: "Claude kunde inte svara på den frågan." });
      const ids = new Set(list.all().map(w => w.id));
      res.json({ ...out, nycklar: out.nycklar.slice(0, 4), val: out.val.filter(v => ids.has(v.id)).slice(0, 4) });
    } catch (error) { failed(res, error); }
  });

  // Reads a photo of a label and suggests values for the "Lägg till vin" form.
  r.post("/label", async (req, res) => {
    const { image, media_type: mediaType } = req.body || {};
    if (typeof image !== "string" || !IMAGE_TYPES.includes(mediaType) || image.length > 7_000_000) {
      return res.status(400).json({ error: "Skicka en bild (JPEG, PNG eller WebP) på högst 5 MB." });
    }
    const year = new Date().getFullYear();
    try {
      const response = await client.messages.parse({
        model: config.claude.model,
        max_tokens: 4000,
        output_config: { effort: "medium", format: zodOutputFormat(Label) },
        system: "Du är en erfaren sommelier som läser vinetiketter och svarar på svenska.",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: `Läs etiketten och fyll i uppgifterna om vinet. Året är ${year}.
- type: rott, vitt, rose, bubbel (allt mousserande), sott (dessertviner och starkviner som Sauternes, Tokaji Aszú, portvin, isvin, Pedro Ximénez) eller orange.
- name: vinets namn som det står på etiketten, utan producent om det går. producer: producenten.
- grapes: druvorna på svenska, t.ex. "Sangiovese och Merlot". Om de inte står på etiketten, ange de typiska för appellationen.
- country och region på svenska, t.ex. Frankrike, Bourgogne; Italien, Toscana.
- style: t.ex. Riserva, Grand Cru, Brut, Cava, eller tom sträng.
- drink_from och drink_to: ditt uppskattade drickfönster (årtal) utifrån stil, druva, ursprung och årgång; null om årgång saknas.
- taste1–taste3 på skalan 1–12: för rött och orange fyllighet, strävhet, fruktsyra; för vitt, rosé, mousserande och sött fyllighet, sötma, fruktsyra.
- note: en kort mening om vinet, högst 20 ord.
Gissa inte uppgifter som varken syns eller rimligen följer av etiketten; lämna dem tomma. Sätt found=false om bilden inte visar en vinetikett.` },
          ],
        }],
      });
      const out = response.parsed_output;
      if (response.stop_reason === "refusal" || !out) return res.status(502).json({ error: "Claude kunde inte läsa bilden." });
      if (!out.found) return res.status(422).json({ error: "Det ser inte ut som en vinetikett. Försök med en skarpare bild av framsidan." });
      res.json({
        ...out,
        vintage: /^\d{4}$/.test(out.vintage) ? out.vintage : "",
        taste_kind: ["rott", "orange"].includes(out.type) ? "r" : "w",
        taste1: clamp(out.taste1), taste2: clamp(out.taste2), taste3: clamp(out.taste3),
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "För många frågor just nu. Försök igen om en stund." });
      console.error("Claude (etikett):", error instanceof Anthropic.APIError ? error.message : error);
      res.status(502).json({ error: "Det gick inte att få svar från Claude." });
    }
  });

  return r;
}
