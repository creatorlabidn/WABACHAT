import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ limits: { fileSize: 16 * 1024 * 1024 } }); // 16MB limit

// In-memory store for messages and events
const webhooks: any[] = [];
const clients: express.Response[] = [];

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // SEND MESSAGE ENDPOINT
  app.post("/api/send", async (req, res) => {
    try {
      const { to, message, token, phoneId, type, mediaId } = req.body;
      
      let data: any = {
        messaging_product: "whatsapp",
        to,
      };

      if (type === "image" && mediaId) {
        data.type = "image";
        data.image = {
          id: mediaId,
          caption: message || ""
        };
      } else {
        data.type = "text";
        data.text = { body: message };
      }

      const response = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json" // Use JSON for text or sending media by ID
        },
        body: JSON.stringify(data)
      });
      
      const result = await response.json();
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

      // Convert buffer to Blob for native fetch FormData
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

      const result = await response.json();
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
