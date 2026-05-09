import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory store for messages and events
const webhooks: any[] = [];
const clients: express.Response[] = [];

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // SSE setup for real-time updates to frontend
  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    clients.push(res);

    // Send initial state (optional, we could just send connection ack)
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    req.on("close", () => {
      const idx = clients.indexOf(res);
      if (idx !== -1) {
        clients.splice(idx, 1);
      }
    });
  });

  // Fetch all stored webhook events
  app.get("/api/webhooks", (req, res) => {
    res.json(webhooks);
  });

  // Proxy Media
  app.get("/api/media", async (req, res) => {
    const { id, token } = req.query;
    if (!id || !token) return res.status(400).send("Missing id or token");
    try {
      const urlRes = await fetch(`https://graph.facebook.com/v17.0/${id}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const urlData: any = await urlRes.json();
      if (!urlData.url) return res.status(404).send("Media not found");

      const mediaRes = await fetch(urlData.url, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const arrayBuffer = await mediaRes.arrayBuffer();
      res.setHeader('Content-Type', mediaRes.headers.get('content-type') || 'application/octet-stream');
      res.send(Buffer.from(arrayBuffer));
    } catch (e: any) {
      res.status(500).send(e.message);
    }
  });

  // Send Message
  app.post("/api/send", async (req, res) => {
    const { to, message, token, phoneId } = req.body;
    try {
      const response = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: {
            preview_url: false,
            body: message
          }
        })
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e: any) {
      res.status(500).json({ error: { message: e.message } });
    }
  });

  // Send Image
  app.post("/api/send_image", async (req, res) => {
    console.log("Receive /send_image request body size:", JSON.stringify(req.body).length);
    const { to, base64Image, mimeType, caption, token, phoneId } = req.body;
    try {
      if (!base64Image) {
        throw new Error("Base64 image is empty");
      }
      return await sendImageImplementation(req, res);
    } catch (err: any) {
      console.error("Outer try/catch err:", err.message);
      res.status(500).json({ error: { message: err.message } });
    }
  });

  async function sendImageImplementation(req: any, res: any) {
    const { to, base64Image, mimeType, caption, token, phoneId } = req.body;
    try {
      // 1. Upload to /media
      const buffer = Buffer.from(base64Image, 'base64');
      const blob = new Blob([buffer], { type: mimeType });
      const formData = new FormData();
      formData.append('file', blob, `image.${mimeType.split('/')[1] || 'jpg'}`);
      formData.append('messaging_product', 'whatsapp');

      console.log("Uploading media...");
      const uploadRes = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/media`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: formData
      });
      const uploadData: any = await uploadRes.json();
      console.log("Upload media res:", uploadRes.ok, uploadData);
      if (!uploadRes.ok) return res.status(uploadRes.status).json(uploadData);
      const mediaId = uploadData.id;

      // 2. Send message
      console.log("Sending message with mediaId:", mediaId);
      const sendRes = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "image",
          image: {
            id: mediaId,
            caption: caption || ""
          }
        })
      });
      const sendData = await sendRes.json();
      console.log("Send res:", sendRes.ok, sendData);
      res.status(sendRes.status).json(sendData);
    } catch (e: any) {
      console.error("Inner try/catch err:", e);
      res.status(500).json({ error: { message: e.message } });
    }
  }

  // React to Message
  app.post("/api/react", async (req, res) => {
    const { to, message_id, emoji, token, phoneId } = req.body;
    try {
      const response = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "reaction",
          reaction: {
            message_id,
            emoji
          }
        })
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e: any) {
      res.status(500).json({ error: { message: e.message } });
    }
  });

  // Mark Read
  app.post("/api/read", async (req, res) => {
    const { messageId, token, phoneId } = req.body;
    try {
      const response = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId
        })
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e: any) {
      res.status(500).json({ error: { message: e.message } });
    }
  });

  // WhatsApp Webhook Verification
  app.get("/api/webhook", (req, res) => {
    // The verify token you specify in the App Dashboard
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "my-verify-token";

    // Parse params from the webhook verification request
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // Check if a token and mode were sent
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
    
    // Check if this is an event from a WhatsApp API
    if (req.body.object) {
      if (
        req.body.entry &&
        req.body.entry[0].changes &&
        req.body.entry[0].changes[0] &&
        req.body.entry[0].changes[0].value.messages &&
        req.body.entry[0].changes[0].value.messages[0]
      ) {
        webhooks.push(req.body);
        
        // Notify all connected clients
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
