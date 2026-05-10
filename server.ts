import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ limits: { fileSize: 16 * 1024 * 1024 } }); // 16MB limit

// In-memory store for messages and events
const webhooks: any[] = [];   // pesan masuk
const outgoing: any[] = [];   // pesan keluar
const clients: express.Response[] = [];

// ─── Google Sheets JWT helper ─────────────────────────────────────────────────

async function getGoogleAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const base64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const headerB64 = base64url(header);
  const payloadB64 = base64url(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import private key using Node.js crypto (built-in, no extra deps)
  const { createSign } = await import("crypto");
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign
    .sign(privateKey, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenData: any = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Gagal mendapatkan Google token: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

async function fetchCustomerFromSheets(
  phone: string,
  spreadsheetId: string,
  sheetName: string,
  clientEmail: string,
  privateKey: string
): Promise<any[]> {
  const accessToken = await getGoogleAccessToken(clientEmail, privateKey);

  // Ambil semua data dari sheet (kolom A-F)
  const range = encodeURIComponent(`${sheetName}!A:F`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data: any = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || "Gagal mengambil data dari Google Sheets");
  }

  const rows: string[][] = data.values || [];
  if (rows.length === 0) return [];

  // Normalisasi nomor telepon: hapus +, 0, 62 di awal lalu bandingkan akhiran
  const normalize = (p: string) => p.replace(/\D/g, "").replace(/^(62|0)/, "");
  const searchPhone = normalize(phone);

  // Filter baris yang cocok nomor telepon (kolom C = index 2)
  // Kolom: A=Nama, B=Email, C=Phone, D=Order ID, E=Produk, F=Total
  const matched = rows
    .slice(1) // skip header
    .filter((row) => {
      const rowPhone = normalize(row[2] || "");
      return rowPhone === searchPhone;
    })
    .map((row) => ({
      nama: row[0] || "-",
      email: row[1] || "-",
      phone: row[2] || "-",
      orderId: row[3] || "-",
      produk: row[4] || "-",
      total: row[5] || "-",
    }));

  return matched;
}

// ─── Express server ───────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // CUSTOMER ORDERS ENDPOINT
  app.get("/api/customer-orders", async (req, res) => {
    try {
      const { phone, spreadsheetId, sheetName, clientEmail, privateKey } = req.query as Record<string, string>;

      if (!phone || !spreadsheetId || !sheetName || !clientEmail || !privateKey) {
        return res.status(400).json({ error: "Parameter tidak lengkap" });
      }

      const orders = await fetchCustomerFromSheets(
        phone,
        spreadsheetId,
        sheetName,
        clientEmail,
        decodeURIComponent(privateKey)
      );

      res.json({ orders });
    } catch (e: any) {
      console.error("Customer orders error:", e);
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // SEND MESSAGE ENDPOINT
  app.post("/api/send", async (req, res) => {
    try {
      const { to, message, token, phoneId, type, mediaId, filename, replyToId } = req.body;
      
      let data: any = {
        messaging_product: "whatsapp",
        to,
      };

      // Support reply (context)
      if (replyToId) {
        data.context = { message_id: replyToId };
      }

      if (type === "image" && mediaId) {
        data.type = "image";
        data.image = { id: mediaId, caption: message || "" };
      } else if (type === "video" && mediaId) {
        data.type = "video";
        data.video = { id: mediaId, caption: message || "" };
      } else if (type === "document" && mediaId) {
        data.type = "document";
        data.document = { id: mediaId, caption: message || "", filename: filename || "document.pdf" };
      } else {
        data.type = "text";
        data.text = { body: message };
      }

      const response = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
      });
      
      const result: any = await response.json();

      // Simpan pesan keluar ke in-memory store jika berhasil
      if (response.ok && result.messages && result.messages.length > 0) {
        const realMessageId = result.messages[0].id;
        const outgoingEntry = {
          object: "whatsapp_business_account",
          entry: [{
            changes: [{
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: phoneId },
                messages: [{
                  from: "me",
                  id: realMessageId,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: type || "text",
                  ...(type === "text" || !type ? { text: { body: message } } : {}),
                  ...(type === "image" && mediaId ? { image: { id: mediaId, caption: message || "" } } : {}),
                  ...(type === "video" && mediaId ? { video: { id: mediaId, caption: message || "" } } : {}),
                  ...(type === "document" && mediaId ? { document: { id: mediaId, caption: message || "", filename: filename || "document.pdf" } } : {}),
                  ...(replyToId ? { context: { id: replyToId } } : {}),
                }],
                contacts: [{ profile: { name: "Me" }, wa_id: phoneId }],
              },
              field: "messages"
            }]
          }],
          _outgoing: true,
          _to: to,
        };
        outgoing.push(outgoingEntry);
        if (outgoing.length > 200) outgoing.shift();
      }

      res.status(response.status).json(result);
    } catch (e) {
      console.error("Failed to send message:", e);
      res.status(500).json({ error: String(e) });
    }
  });

  // UPLOAD MEDIA ENDPOINT
  app.post("/api/upload-media", upload.single("file"), async (req, res) => {
    try {
      const { token, phoneId } = req.body;
      const file = req.file;

      if (!file || !token || !phoneId) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const blob = new Blob([file.buffer], { type: file.mimetype });
      
      const formData = new globalThis.FormData();
      formData.append('file', blob, file.originalname);
      formData.append('messaging_product', 'whatsapp');

      const response = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/media`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        },
        body: formData as any
      });

      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseErr) {
        console.error("Facebook API returned non-JSON:", responseText);
        return res.status(response.status).json({ error: "Invalid response from Facebook", details: responseText });
      }

      if (!response.ok) {
        console.error("WhatsApp Media Upload Error:", result);
      }

      res.status(response.status).json(result);
    } catch (e) {
      console.error("Failed to upload media:", e);
      res.status(500).json({ error: String(e) });
    }
  });

  // SSE setup for real-time updates to frontend
  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    clients.push(res);
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    req.on("close", () => {
      const idx = clients.indexOf(res);
      if (idx !== -1) {
        clients.splice(idx, 1);
      }
    });
  });

  // Fetch all stored webhook events (incoming + outgoing)
  app.get("/api/webhooks", (req, res) => {
    const getTimestamp = (payload: any): number => {
      try {
        const ts = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.timestamp;
        return ts ? parseInt(ts) : 0;
      } catch { return 0; }
    };
    const all = [...webhooks, ...outgoing].sort((a, b) => getTimestamp(a) - getTimestamp(b));
    res.json(all);
  });

  // WhatsApp Webhook Verification
  app.get("/api/webhook", (req, res) => {
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "my-verify-token";
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("WEBHOOK_VERIFIED");
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    } else {
      res.sendStatus(400);
    }
  });

  // WhatsApp Webhook Reception
  app.post("/api/webhook", (req, res) => {
    console.log("Received Webhook:", JSON.stringify(req.body, null, 2));
    
    if (req.body.object) {
      if (
        req.body.entry &&
        req.body.entry[0].changes &&
        req.body.entry[0].changes[0]
      ) {
        webhooks.push(req.body);
        
        clients.forEach(client => {
          client.write(`data: ${JSON.stringify({ type: 'new_message', payload: req.body })}\n\n`);
        });
      }
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();