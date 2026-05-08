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

  app.use(express.json());

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
