import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  MessageSquare, User, Settings, Paperclip, ArrowLeft,
  Search, Send, CheckCircle2, CircleDashed, X, Tag, Zap, Plus, Pencil, Trash2, RefreshCw
} from 'lucide-react';

const renderHighlightedText = (text: string, highlight: string) => {
  if (!highlight.trim() || !text) return text;
  const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) => 
        part.toLowerCase() === highlight.toLowerCase() ? <mark key={i} className="bg-yellow-200 rounded px-0.5 text-slate-900">{part}</mark> : <span key={i}>{part}</span>
      )}
    </span>
  );
};

interface WAContact {
  profile: { name: string };
  wa_id: string;
}

interface WAMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed' | 'pending' | string;
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type?: string };
  video?: { id: string; caption?: string; mime_type?: string };
  document?: { id: string; caption?: string; filename?: string; mime_type?: string };
  audio?: { id: string; mime_type?: string; voice?: boolean };
  reaction?: { message_id: string; emoji: string };
  reactions?: { emoji: string; fromMe: boolean }[];
  context?: { id: string; forwarded?: boolean };
  referral?: {
    source_url?: string;
    source_type?: string;
    source_id?: string;
    headline?: string;
    body?: string;
    media_type?: string;
    image_url?: string;
    video_url?: string;
    ctwa_clid?: string;
  };
}

interface QuickReply {
  id: string;
  title: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────
// Conversation disimpan ke localStorage TANPA field `name`.
// Nama selalu diambil dari n8n (orderHistories) saat runtime.
// ─────────────────────────────────────────────────────────────
interface Conversation {
  id: string;
  /** Nama sementara dari WhatsApp contact object — hanya dipakai
   *  sebagai fallback jika n8n belum merespons. Tidak dipersist. */
  name: string;
  phone: string;
  messages: WAMessage[];
  lastMessageTime: string;
  unreadCount?: number;
  labels?: string[];
}

// ─────────────────────────────────────────────────────────────
// Respons n8n Webhook
// ─────────────────────────────────────────────────────────────
interface N8nOrder {
  row_number: number;
  order_id: string;
  nama: string;
  email: string;
  phone: number;
  product: string;
  tanggal: string;
  revenue: string;
}

interface N8nProfile {
  found: boolean;
  phone: string;
  name: string;
  total_orders: number;
  orders: N8nOrder[];
}

// ─────────────────────────────────────────────────────────────
// Helper: nama terbaik untuk sebuah kontak
// Prioritas: n8n name → n8n orders[0].nama → WA contact name → +phone
// ─────────────────────────────────────────────────────────────
const resolveName = (
  chatId: string,
  fallbackName: string,
  profile?: N8nProfile
): string => {
  if (profile?.name && profile.name.trim() !== '') return profile.name;
  if (profile?.orders?.[0]?.nama && profile.orders[0].nama.trim() !== '') return profile.orders[0].nama;
  if (fallbackName && fallbackName !== chatId && fallbackName !== 'Me' && !fallbackName.startsWith('+')) return fallbackName;
  return `+${chatId}`;
};

export default function App() {
  // ── Conversations (messages & metadata — no names persisted) ──
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const saved = localStorage.getItem('wa_conversations');
      if (saved) {
        const parsed: Conversation[] = JSON.parse(saved);
        // Saat load, set name ke phone sebagai placeholder —
        // akan diisi ulang dari n8n setelah fetch selesai.
        return parsed.map(c => ({
          ...c,
          name: `+${c.id}`, // placeholder sampai n8n merespons
        }));
      }
    } catch (e) {
      console.error('Failed to parse conversations from localStorage', e);
    }
    return [];
  });

  // Simpan ke localStorage — TANPA nama (name selalu +phone sebagai placeholder)
  useEffect(() => {
    // Simpan semua field kecuali `name` agar tidak ada stale name di storage
    const toStore = conversations.map(({ name: _name, ...rest }) => ({
      ...rest,
      name: `+${rest.id}`, // simpan placeholder agar tetap konsisten
    }));
    localStorage.setItem('wa_conversations', JSON.stringify(toStore));
  }, [conversations]);

  // ── Order histories dari n8n — TIDAK disimpan ke localStorage ──
  // Key: phone ID (tanpa +), Value: N8nProfile
  const [orderHistories, setOrderHistories] = useState<Record<string, N8nProfile>>({});
  const orderHistoriesRef = useRef(orderHistories);
  useEffect(() => { orderHistoriesRef.current = orderHistories; }, [orderHistories]);

  // ── Helper: update nama kontak di conversations setelah n8n merespons ──
  const applyProfileToConversations = (phoneId: string, profile: N8nProfile) => {
    const resolvedName = resolveName(phoneId, `+${phoneId}`, profile);
    setConversations(prev => prev.map(c =>
      c.id === phoneId ? { ...c, name: resolvedName } : c
    ));
  };

  // ─────────────────────────────────────────────────────────────
  // fetchProfile — panggil n8n webhook untuk satu nomor
  // ─────────────────────────────────────────────────────────────
  const fetchingRef = useRef<Set<string>>(new Set());

  const fetchProfile = async (phoneId: string, fallbackName?: string, silent = false): Promise<N8nProfile | null> => {
    if (!phoneId) return null;
    // Cegah duplikat request bersamaan untuk nomor yang sama
    if (fetchingRef.current.has(phoneId)) return orderHistoriesRef.current[phoneId] ?? null;
    fetchingRef.current.add(phoneId);

    if (!silent) setIsRefreshingProfile(true);
    try {
      const payload = { phone: phoneId, name: fallbackName ?? `+${phoneId}` };
      const response = await fetch(
        'https://n8n-wexrffsqeapb.sate.sumopod.my.id/webhook/f157c575-2739-4573-86ce-624d784ee088',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) return null;

      let data: any;
      try {
        const text = await response.text();
        data = JSON.parse(text);
        if (typeof data === 'string') data = JSON.parse(data);
      } catch {
        return null;
      }

      // n8n bisa mengembalikan array atau object
      const profile: N8nProfile = Array.isArray(data) ? data[0] : data;
      if (!profile) return null;

      // Simpan ke state
      setOrderHistories(prev => ({ ...prev, [phoneId]: profile }));
      // Update nama di conversations
      applyProfileToConversations(phoneId, profile);

      return profile;
    } catch (err) {
      console.error('fetchProfile error:', err);
      return null;
    } finally {
      fetchingRef.current.delete(phoneId);
      if (!silent) setIsRefreshingProfile(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // BULK FETCH saat halaman pertama dimuat:
  // fetch SEMUA nomor yang ada di localStorage secara paralel
  // (dibatasi concurrency agar tidak overwhelm n8n)
  // ─────────────────────────────────────────────────────────────
  const initialBulkFetchDone = useRef(false);

  useEffect(() => {
    if (initialBulkFetchDone.current) return;
    initialBulkFetchDone.current = true;

    const allConvos = conversationsRef.current;
    if (allConvos.length === 0) return;

    const CONCURRENCY = 3; // max request bersamaan ke n8n
    const queue = [...allConvos.map(c => c.id)];

    const runNext = async () => {
      if (queue.length === 0) return;
      const phoneId = queue.shift()!;
      await fetchProfile(phoneId, undefined, true);
      await new Promise(r => setTimeout(r, 300)); // jeda kecil antar request
      runNext();
    };

    // Mulai sejumlah CONCURRENCY worker sekaligus
    for (let i = 0; i < Math.min(CONCURRENCY, allConvos.length); i++) {
      runNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Fetch profile saat user membuka chat (selalu fresh)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeChatId) return;
    const chat = conversationsRef.current.find(c => c.id === activeChatId);
    if (chat) fetchProfile(chat.id, chat.name, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);

  // ── Notification permission ──
  useEffect(() => {
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNowMillis(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [nowMillis, setNowMillis] = useState(Date.now());
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [reactingToMessageId, setReactingToMessageId] = useState<string | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<WAMessage | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [config, setConfig] = useState({
    phoneNumberId: localStorage.getItem('wa_phone_number_id') || '',
    accessToken: localStorage.getItem('wa_access_token') || '',
  });
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [showLabelMenu, setShowLabelMenu] = useState(false);
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoverPos, setHoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const labelMenuRef = useRef<HTMLDivElement>(null);
  const [isRefreshingProfile, setIsRefreshingProfile] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);

  // Quick Reply state
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>(() => {
    try {
      const saved = localStorage.getItem('wa_quick_replies');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [
      { id: '1', title: 'Salam pembuka', message: 'Halo {{nama}}, terima kasih telah menghubungi kami! Ada yang bisa kami bantu?' },
      { id: '2', title: 'Konfirmasi pesanan', message: 'Baik {{nama}}, pesanan Anda sedang kami proses. Mohon ditunggu ya 🙏' },
      { id: '3', title: 'Minta info lebih', message: 'Boleh kami minta info lebih lanjut {{nama}}? Agar kami bisa membantu dengan lebih baik.' },
    ];
  });
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplySearch, setQuickReplySearch] = useState('');
  const [isQuickReplySettingsOpen, setIsQuickReplySettingsOpen] = useState(false);
  const [editingQuickReply, setEditingQuickReply] = useState<QuickReply | null>(null);
  const [qrForm, setQrForm] = useState({ title: '', message: '' });
  const quickReplyPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('wa_quick_replies', JSON.stringify(quickReplies));
  }, [quickReplies]);

  const saveQuickReply = () => {
    if (!qrForm.title.trim() || !qrForm.message.trim()) return;
    if (editingQuickReply) {
      setQuickReplies(prev => prev.map(qr => qr.id === editingQuickReply.id ? { ...qr, ...qrForm } : qr));
    } else {
      setQuickReplies(prev => [...prev, { id: Date.now().toString(), ...qrForm }]);
    }
    setEditingQuickReply(null);
    setQrForm({ title: '', message: '' });
  };

  const deleteQuickReply = (id: string) => {
    setQuickReplies(prev => prev.filter(qr => qr.id !== id));
  };

  // ── Helper nama untuk quick reply template ──
  const getContactDisplayName = (chatId: string, chatName: string): string => {
    const profile = orderHistoriesRef.current[chatId];
    return profile?.orders?.[0]?.nama || profile?.name || (chatName !== `+${chatId}` ? chatName : '');
  };

  const applyQuickReply = (qr: QuickReply) => {
    if (!activeChat) return;
    const sapaan = getContactDisplayName(activeChat.id, activeChat.name);
    const msg = qr.message.replace(/\{\{nama\}\}/gi, sapaan);
    setInputText(msg);
    setShowQuickReplies(false);
    setQuickReplySearch('');
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (labelMenuRef.current && !labelMenuRef.current.contains(event.target as Node)) {
        setShowLabelMenu(false);
      }
      if (quickReplyPanelRef.current && !quickReplyPanelRef.current.contains(event.target as Node)) {
        setShowQuickReplies(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setActiveChatId(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const AVAILABLE_LABELS = ['Prospek', 'Selesai', 'Komplain'];

  const toggleLabel = (chatId: string, label: string) => {
    setConversations(prev => prev.map(c => {
      if (c.id === chatId) {
        const labels = c.labels || [];
        return labels.includes(label)
          ? { ...c, labels: labels.filter(l => l !== label) }
          : { ...c, labels: [...labels, label] };
      }
      return c;
    }));
  };

  const activeChat = activeChatId ? conversations.find(c => c.id === activeChatId) : null;
  const activeProfile = activeChatId ? orderHistories[activeChatId] : undefined;

  // Nama yang ditampilkan di header & list — selalu pakai n8n jika tersedia
  const getDisplayName = (chat: Conversation): string => {
    const profile = orderHistories[chat.id];
    return resolveName(chat.id, chat.name, profile);
  };

  const scrollToBottom = (instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? "auto" : "smooth" });
  };

  const prevChatIdRef = useRef(activeChatId);
  useEffect(() => {
    if (prevChatIdRef.current !== activeChatId) {
      scrollToBottom(true);
      prevChatIdRef.current = activeChatId;
    } else {
      scrollToBottom(false);
    }
  }, [activeChat?.messages.length, activeChatId]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
    setReplyingToMessage(null);
    setConversations(prev => prev.map(c => c.id === activeChatId ? { ...c, unreadCount: 0 } : c));
  }, [activeChatId]);

  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);

  // Mark messages as read
  useEffect(() => {
    if (!activeChat) return;
    const unreadMessages = activeChat.messages.filter(m => m.from !== 'me' && m.status !== 'read_by_me');
    if (unreadMessages.length > 0 && config.phoneNumberId && config.accessToken) {
      unreadMessages.forEach(async (msg) => {
        try {
          await fetch('/api/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messageId: msg.id,
              phoneId: config.phoneNumberId,
              token: config.accessToken
            })
          });
          setConversations(prev => prev.map(chat => {
            if (chat.id === activeChat.id) {
              return {
                ...chat,
                messages: chat.messages.map(m => m.id === msg.id ? { ...m, status: 'read_by_me' } : m)
              };
            }
            return chat;
          }));
        } catch (e) {
          console.error("Failed to mark as read", e);
        }
      });
    }
  }, [activeChat, config.phoneNumberId, config.accessToken]);

  const isInitialFetchRef = useRef(true);

  // ── Polling webhook ──
  useEffect(() => {
    const processedMsgIds = new Set<string>();

    const fetchWebhooks = async () => {
      try {
        const phoneId = configRef.current.phoneNumberId;
        if (!phoneId) return;

        const res = await fetch(`/api/webhooks?t=${Date.now()}&phoneId=${encodeURIComponent(phoneId)}`, {
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (!res.ok) return;
        const webhooks: any[] = await res.json();

        webhooks.forEach((payload: any) => {
          if (payload.error) { console.error(payload.message); return; }
          if (!payload.entry?.[0]?.changes?.[0]) return;

          const value = payload.entry[0].changes[0].value;

          // Status updates
          if (value.statuses) {
            value.statuses.forEach((statusUpdate: any) => {
              const key = `${statusUpdate.id}_${statusUpdate.status}`;
              if (processedMsgIds.has(key)) return;
              processedMsgIds.add(key);

              setConversations(prev => prev.map(chat => {
                if (!chat.messages.some(m => m.id === statusUpdate.id)) return chat;
                return {
                  ...chat,
                  messages: chat.messages.map(m => {
                    if (m.id !== statusUpdate.id) return m;
                    const weights: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };
                    const currentW = weights[m.status || 'pending'] ?? 0;
                    const newW = weights[statusUpdate.status] ?? 0;
                    return newW > currentW ? { ...m, status: statusUpdate.status } : m;
                  })
                };
              }));
            });
          }

          // New messages
          if (value.messages) {
            const contacts = value.contacts as WAContact[];
            const messages = value.messages as WAMessage[];
            if (!messages || messages.length === 0) return;

            const newMsg = messages[0];
            if (processedMsgIds.has(newMsg.id)) return;
            processedMsgIds.add(newMsg.id);

            const contact = contacts?.[0];
            const isOutgoing = payload._outgoing === true;
            const phone = isOutgoing ? payload._to : newMsg.from;

            // Nama fallback dari WA contact object (bukan dari localStorage)
            let fallbackName = `+${phone}`;
            if (!isOutgoing && contact?.profile?.name && contact.profile.name !== 'Me') {
              fallbackName = contact.profile.name;
            }

            // Trigger fetch profil untuk nomor baru (silent)
            if (phone && !orderHistoriesRef.current[phone]) {
              fetchProfile(phone, fallbackName, true);
            }

            // Desktop notification
            if (!isOutgoing && !isInitialFetchRef.current && Notification.permission === "granted") {
              const isCurrentlyActive = phone === activeChatIdRef.current;
              if (!isCurrentlyActive || document.hidden) {
                const body = newMsg.type === 'text' ? newMsg.text?.body
                  : newMsg.type === 'image' ? (newMsg.image?.caption || '[Gambar]')
                  : newMsg.type === 'video' ? (newMsg.video?.caption || '[Video]')
                  : newMsg.type === 'audio' ? (newMsg.audio?.voice ? '[Pesan Suara]' : '[Audio]')
                  : `[${newMsg.type}]`;

                // Gunakan nama dari n8n jika sudah tersedia
                const displayName = resolveName(phone, fallbackName, orderHistoriesRef.current[phone]);
                const notification = new Notification(`Pesan baru dari ${displayName}`, { body: body ?? '' });
                notification.onclick = () => window.focus();
              }
            }

            setConversations(prev => {
              // Handle reactions
              if (newMsg.type === 'reaction' && newMsg.reaction) {
                const targetMessageId = newMsg.reaction.message_id;
                return prev.map(chat => {
                  if (chat.id !== phone) return chat;
                  return {
                    ...chat,
                    messages: chat.messages.map(m => {
                      if (m.id !== targetMessageId) return m;
                      const currentReactions = m.reactions || [];
                      const newEmoji = newMsg.reaction?.emoji || "";
                      const otherReactions = currentReactions.filter(r => r.fromMe !== false);
                      const newReactions = newEmoji ? [...otherReactions, { emoji: newEmoji, fromMe: false }] : otherReactions;
                      return { ...m, reactions: newReactions };
                    })
                  };
                });
              }

              const existingChat = prev.find(c => c.id === phone);
              if (existingChat?.messages.some(m => m.id === newMsg.id)) return prev;

              const isCurrentlyActive = phone === activeChatIdRef.current;
              const isInitial = isInitialFetchRef.current;

              if (existingChat) {
                const updatedChat = {
                  ...existingChat,
                  // Nama TIDAK diupdate dari WA contact — tunggu n8n
                  messages: [...existingChat.messages, newMsg],
                  lastMessageTime: new Date(parseInt(newMsg.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  unreadCount: isOutgoing ? (existingChat.unreadCount || 0)
                    : isCurrentlyActive ? 0
                    : isInitial ? (existingChat.unreadCount || 0)
                    : (existingChat.unreadCount || 0) + 1
                };
                return [updatedChat, ...prev.filter(c => c.id !== phone)];
              } else {
                const newChat: Conversation = {
                  id: phone,
                  name: fallbackName, // placeholder — akan diupdate oleh fetchProfile
                  phone: `+${phone}`,
                  messages: [newMsg],
                  lastMessageTime: new Date(parseInt(newMsg.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  unreadCount: isOutgoing || isCurrentlyActive || isInitial ? 0 : 1
                };
                return [newChat, ...prev];
              }
            });
          }
        });
        isInitialFetchRef.current = false;
      } catch (err) {
        console.error('Error fetching webhooks:', err);
      }
    };

    fetchWebhooks();
    const interval = setInterval(fetchWebhooks, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatTimestamp = (ts: string) => {
    const date = new Date(parseInt(ts) * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() && !attachment) return;
    if (!activeChat) return;

    if (!config.phoneNumberId || !config.accessToken) {
      alert('Mohon isi Phone Number ID dan Access Token di Pengaturan (Settings) terlebih dahulu.');
      setIsSettingsOpen(true);
      return;
    }

    setIsUploading(true);
    try {
      let mediaId: string | undefined;

      if (attachment) {
        const formData = new FormData();
        formData.append("file", attachment);
        formData.append("token", config.accessToken);
        formData.append("phoneId", config.phoneNumberId);

        const uploadRes = await fetch("/api/upload-media", { method: "POST", body: formData });
        const uploadText = await uploadRes.text();
        let uploadData: any;
        try { uploadData = JSON.parse(uploadText); } catch (e) {
          throw new Error(`Upload response invalid JSON (Status: ${uploadRes.status}): ${uploadText.slice(0, 150)}`);
        }
        if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
        mediaId = uploadData.id;
        if (!mediaId) throw new Error("Failed to get media ID from WhatsApp API");
      }

      const messageToSend = inputText;
      const cachedAttachment = attachment;
      const isVideo = cachedAttachment?.type.startsWith('video/');
      const isDocument = cachedAttachment?.type === 'application/pdf';
      const msgType = mediaId ? (isVideo ? 'video' : isDocument ? 'document' : 'image') : 'text';
      const replyToMsg = replyingToMessage;
      setReplyingToMessage(null);

      const newMsg: WAMessage = {
        from: "me",
        id: `local_${Date.now()}`,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        type: msgType as any,
        status: "pending",
        text: mediaId ? undefined : { body: messageToSend },
        image: mediaId && msgType === 'image' ? { id: mediaId, caption: messageToSend } : undefined,
        video: mediaId && msgType === 'video' ? { id: mediaId, caption: messageToSend } : undefined,
        document: mediaId && msgType === 'document' ? { id: mediaId, caption: messageToSend, filename: cachedAttachment?.name } : undefined,
        context: replyToMsg ? { id: replyToMsg.id } : undefined
      };

      setConversations(prev => prev.map(chat =>
        chat.id === activeChatId
          ? { ...chat, messages: [...chat.messages, newMsg], lastMessageTime: formatTimestamp(newMsg.timestamp) }
          : chat
      ));

      setInputText("");
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: activeChat.id,
          message: messageToSend,
          token: config.accessToken,
          phoneId: config.phoneNumberId,
          type: msgType,
          mediaId,
          filename: cachedAttachment?.name,
          replyToId: replyToMsg?.id
        })
      });
      const data: any = await res.json();
      if (!res.ok) {
        alert(`Gagal mengirim pesan: ${data.error?.message || JSON.stringify(data)}`);
      } else if (data.messages?.[0]?.id) {
        const realId = data.messages[0].id;
        setConversations(prev => prev.map(chat =>
          chat.id === activeChatId
            ? { ...chat, messages: chat.messages.map(m => m.id === newMsg.id ? { ...m, id: realId, status: 'sent' } : m) }
            : chat
        ));
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Gagal mengirim pesan, periksa koneksi Anda.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    if (!activeChat) return;
    if (!config.phoneNumberId || !config.accessToken) {
      alert('Mohon isi Phone Number ID dan Access Token di Pengaturan (Settings) terlebih dahulu.');
      return;
    }

    setConversations(prev => prev.map(chat => {
      if (chat.id !== activeChatId) return chat;
      return {
        ...chat,
        messages: chat.messages.map(m => {
          if (m.id !== messageId) return m;
          const otherReactions = (m.reactions || []).filter(r => r.fromMe !== true);
          return { ...m, reactions: emoji ? [...otherReactions, { emoji, fromMe: true }] : otherReactions };
        })
      };
    }));

    try {
      const res = await fetch('/api/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: activeChat.id,
          message_id: messageId,
          emoji,
          token: config.accessToken,
          phoneId: config.phoneNumberId
        })
      });
      const data: any = await res.json();
      if (!res.ok) alert(`Gagal memberi reaksi: ${data.error?.message || JSON.stringify(data)}`);
    } catch (err) {
      alert('Gagal memberi reaksi, periksa koneksi Anda.');
    }
  };

  const activeChatWindow = useMemo(() => {
    if (!activeChat) return { isOpen: false, text: "" };
    const lastUserMsg = activeChat.messages.slice().reverse().find(m => m.from !== 'me');
    if (!lastUserMsg) return { isOpen: false, text: "Sesi belum dimulai" };
    const lastTime = parseInt(lastUserMsg.timestamp) * 1000;
    const msRemaining = lastTime + 24 * 60 * 60 * 1000 - nowMillis;
    if (msRemaining > 0) {
      const hours = Math.floor(msRemaining / (1000 * 60 * 60));
      const minutes = Math.floor((msRemaining % (1000 * 60 * 60)) / (1000 * 60));
      return { isOpen: true, text: `Sisa waktu sesi: ${hours}j ${minutes}m` };
    }
    return { isOpen: false, text: "Sesi 24 jam telah berakhir" };
  }, [activeChat, nowMillis]);

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-slate-50 font-sans">
      {/* Sidebar */}
      <aside className="hidden md:flex w-16 bg-slate-900 flex-col items-center py-6 space-y-8 text-slate-400 shrink-0">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-xl">B</div>
        <div className="flex flex-col space-y-6">
          <div className="p-2 bg-slate-800 text-white rounded-lg cursor-pointer"><MessageSquare className="w-6 h-6" /></div>
          <div className="p-2 hover:text-white cursor-pointer transition-colors"><User className="w-6 h-6" /></div>
          <div onClick={() => setIsSettingsOpen(true)} className="p-2 hover:text-white cursor-pointer transition-colors"><Settings className="w-6 h-6" /></div>
        </div>
        <div className="mt-auto pb-4">
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs text-white cursor-pointer">A</div>
        </div>
      </aside>

      {/* Conversations List */}
      <nav className={`${activeChatId ? 'hidden md:flex' : 'flex'} w-full md:w-80 bg-white border-r border-slate-200 flex-col shrink-0`}>
        <div className="p-4 border-b border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-xl font-bold text-slate-800">Inbox</h1>
              <p className="text-xs text-slate-500 uppercase tracking-widest mt-1">Business API Dashboard</p>
            </div>
            <button onClick={() => setIsSettingsOpen(true)} className="md:hidden p-2 text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
              <Settings className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-4 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              placeholder="Cari obrolan atau pesan..."
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
              className="w-full bg-slate-100 border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.filter(chat => {
            if (!globalSearchQuery) return true;
            const q = globalSearchQuery.toLowerCase();
            const displayName = getDisplayName(chat).toLowerCase();
            return displayName.includes(q) || chat.messages.some(m =>
              m.text?.body?.toLowerCase().includes(q) ||
              m.image?.caption?.toLowerCase().includes(q) ||
              m.video?.caption?.toLowerCase().includes(q)
            );
          }).map(chat => {
            const lastMsg = chat.messages[chat.messages.length - 1];
            const isActive = chat.id === activeChatId;
            const displayName = getDisplayName(chat);
            return (
              <div
                key={chat.id}
                onClick={() => {
                  setActiveChatId(chat.id);
                  if (chat.unreadCount) setConversations(prev => prev.map(c => c.id === chat.id ? { ...c, unreadCount: 0 } : c));
                }}
                onMouseEnter={(e) => {
                  if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                  const target = e.currentTarget as HTMLElement;
                  hoverTimeoutRef.current = setTimeout(() => {
                    if (chat.unreadCount && chat.unreadCount > 0) {
                      const rect = target.getBoundingClientRect();
                      const popupWidth = 288;
                      const popupMaxHeight = 340;
                      let leftPos = rect.right + 8;
                      if (leftPos + popupWidth > window.innerWidth - 8) leftPos = rect.left - popupWidth - 8;
                      let topPos = rect.top;
                      if (topPos + popupMaxHeight > window.innerHeight - 16) topPos = Math.max(16, window.innerHeight - popupMaxHeight - 16);
                      setHoverPos({ top: topPos, left: leftPos });
                      setHoveredChatId(chat.id);
                    }
                  }, 400);
                }}
                onMouseLeave={() => {
                  if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                  setHoveredChatId(null);
                }}
                className={`group relative p-4 border-l-4 cursor-pointer transition-colors ${isActive ? 'bg-indigo-50 border-indigo-600' : 'hover:bg-slate-50 border-transparent'}`}
              >
                <div className="flex justify-between items-start">
                  <span className={`font-semibold truncate pr-2 ${chat.unreadCount ? 'text-slate-900 font-bold' : 'text-slate-900'}`}>
                    {displayName}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setChatToDelete(chat.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded transition-all"
                      title="Hapus Obrolan"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <span className={`text-xs whitespace-nowrap ${isActive ? 'text-indigo-600 font-medium' : chat.unreadCount ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
                      {chat.lastMessageTime}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <p className={`text-sm truncate flex-1 pr-2 ${chat.unreadCount ? 'text-slate-800 font-medium' : 'text-slate-600'}`}>
                    {lastMsg?.type === 'text' ? lastMsg.text?.body
                      : lastMsg?.type === 'image' ? (lastMsg.image?.caption || '[Gambar]')
                      : lastMsg?.type === 'video' ? (lastMsg.video?.caption || '[Video]')
                      : lastMsg?.type === 'document' ? (lastMsg.document?.caption || lastMsg.document?.filename || '[Dokumen]')
                      : lastMsg?.type === 'audio' ? (lastMsg.audio?.voice ? '🎤 [Pesan Suara]' : '🎵 [Audio]')
                      : lastMsg?.type === 'unsupported' ? ''
                      : `[${lastMsg?.type}]`}
                  </p>
                  {!!chat.unreadCount && chat.unreadCount > 0 && (
                    <span className="shrink-0 flex items-center justify-center w-5 h-5 bg-indigo-600 text-white rounded-full text-[10px] font-bold">
                      {chat.unreadCount}
                    </span>
                  )}
                </div>
                {chat.labels && chat.labels.length > 0 && (
                  <div className="mt-2 flex space-x-1 flex-wrap gap-y-1">
                    {chat.labels.map(label => {
                      const color = label === 'Prospek' ? 'bg-blue-100 text-blue-700'
                        : label === 'Selesai' ? 'bg-emerald-100 text-emerald-700'
                        : label === 'Komplain' ? 'bg-rose-100 text-rose-700'
                        : 'bg-slate-100 text-slate-700';
                      return <span key={label} className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${color}`}>{label}</span>;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Hover preview popup */}
        {hoveredChatId && (() => {
          const hoveredChat = conversations.find(c => c.id === hoveredChatId);
          if (!hoveredChat) return null;
          const unreadMsgs = hoveredChat.messages.filter(m => m.from !== 'me' && m.status !== 'read_by_me').slice(-10);
          if (unreadMsgs.length === 0) return null;
          return createPortal(
            <div
              className="fixed w-72 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden pointer-events-none"
              style={{ top: hoverPos.top, left: hoverPos.left, zIndex: 2147483647, maxHeight: 'calc(100vh - 32px)' }}
            >
              <div className="px-4 py-2.5 bg-indigo-600 flex items-center justify-between">
                <span className="text-white text-xs font-bold">{getDisplayName(hoveredChat)}</span>
                <span className="text-indigo-200 text-[10px]">{unreadMsgs.length} pesan belum dibaca</span>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                {unreadMsgs.map(msg => (
                  <div key={msg.id} className="px-4 py-2.5">
                    <p className="text-[10px] text-slate-400 mb-0.5">
                      {new Date(parseInt(msg.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {msg.referral && (
                      <div className="flex items-center gap-1 text-[10px] text-indigo-500 mb-1">
                        📢 <span>Pesan dari iklan: <span className="font-semibold">{msg.referral.headline}</span></span>
                      </div>
                    )}
                    <p className="text-sm text-slate-700 break-words">
                      {msg.type === 'text' ? msg.text?.body
                        : msg.type === 'image' ? `🖼️ ${msg.image?.caption || '[Gambar]'}`
                        : msg.type === 'video' ? `🎥 ${msg.video?.caption || '[Video]'}`
                        : msg.type === 'document' ? `📄 ${msg.document?.filename || '[Dokumen]'}`
                        : msg.type === 'audio' ? (msg.audio?.voice ? '🎤 [Pesan Suara]' : '🎵 [Audio]')
                        : `[${msg.type}]`}
                    </p>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 bg-slate-50 text-center">
                <span className="text-[10px] text-slate-400">Klik untuk membuka chat</span>
              </div>
            </div>,
            document.body
          );
        })()}
      </nav>

      {/* Chat View */}
      <main className={`${!activeChatId ? 'hidden md:flex' : 'flex'} flex-1 flex-col bg-[#F8FAFC] min-w-0 relative`}>
        {activeChat ? (
          <>
            <header className="sticky top-0 z-20 h-16 bg-white border-b border-slate-200 flex items-center px-4 md:px-6 justify-between shrink-0">
              <div className="flex items-center space-x-2 md:space-x-3 flex-1 min-w-0">
                <button onClick={() => setActiveChatId(null)} className="md:hidden p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg shrink-0 -ml-2">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="w-10 h-10 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-500 font-medium shrink-0">
                  {getDisplayName(activeChat).charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-slate-900 flex items-center gap-1.5 md:gap-2 w-full">
                    <span className="truncate">{getDisplayName(activeChat)}</span>
                    <div className="hidden sm:flex items-center gap-1 shrink-0">
                      {activeChat.labels?.map(label => {
                        const color = label === 'Prospek' ? 'bg-blue-100 text-blue-700'
                          : label === 'Selesai' ? 'bg-emerald-100 text-emerald-700'
                          : label === 'Komplain' ? 'bg-rose-100 text-rose-700'
                          : 'bg-slate-100 text-slate-700';
                        return <span key={label} className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${color} whitespace-nowrap`}>{label}</span>;
                      })}
                    </div>
                  </h2>
                  <p className="text-[10px] md:text-xs flex items-center font-medium mt-0.5 w-full truncate text-slate-500">
                    <span className="text-green-600 flex items-center shrink-0">
                      <span className="w-1.5 h-1.5 md:w-2 md:h-2 bg-green-500 rounded-full mr-1.5" /> Online
                    </span>
                    <span className="mx-1.5 md:mx-2 text-slate-300 shrink-0">|</span>
                    <span className={`${activeChatWindow.isOpen ? 'text-indigo-600' : 'text-rose-500'} truncate`}>
                      {activeChatWindow.text}
                    </span>
                  </p>
                </div>
              </div>
              <div ref={labelMenuRef} className="flex items-center space-x-1 sm:space-x-2 relative shrink-0">
                <button onClick={() => setShowLabelMenu(!showLabelMenu)} className="p-1.5 sm:p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors" title="Tag / Label Obrolan">
                  <Tag className="w-5 h-5" />
                </button>
                {showLabelMenu && (
                  <div className="absolute top-12 right-0 w-48 bg-white border border-slate-200 shadow-xl rounded-xl z-50 overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500">Label Obrolan</div>
                    <div className="p-1">
                      {AVAILABLE_LABELS.map(label => {
                        const hasLabel = activeChat.labels?.includes(label);
                        return (
                          <button key={label} onClick={() => toggleLabel(activeChat.id, label)} className="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-slate-50 rounded-lg transition-colors group">
                            <div className={`w-4 h-4 mr-3 flex items-center justify-center rounded border ${hasLabel ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 group-hover:border-indigo-400'}`}>
                              {hasLabel && <CheckCircle2 className="w-3 h-3 text-white" />}
                            </div>
                            <span className="text-slate-700 font-medium">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <button onClick={() => setChatToDelete(activeChat.id)} className="p-1.5 sm:p-2 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 transition-colors" title="Hapus Obrolan">
                  <Trash2 className="w-5 h-5" />
                </button>
                <button onClick={() => setActiveChatId(null)} className="hidden md:block p-1.5 sm:p-2 ml-1 sm:ml-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors" title="Tutup Obrolan (Esc)">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </header>

            <section className="flex-1 p-4 md:p-6 space-y-4 overflow-y-auto flex flex-col">
              <div className="flex justify-center mb-2">
                <span className="px-3 py-1 bg-slate-200 text-slate-500 text-[10px] font-bold rounded-full uppercase tracking-tighter">Hari Ini</span>
              </div>

              {activeChat.messages.filter(msg => {
                if (!globalSearchQuery) return true;
                const q = globalSearchQuery.toLowerCase();
                return msg.text?.body?.toLowerCase().includes(q)
                  || msg.image?.caption?.toLowerCase().includes(q)
                  || msg.video?.caption?.toLowerCase().includes(q);
              }).slice().sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp)).map((msg) => {
                if (msg.type === 'unsupported') return null;
                const isMe = msg.from === "me";
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%] md:max-w-lg ${isMe ? 'self-end' : 'self-start'} group relative`}>
                    <div className={`p-3 rounded-2xl shadow-sm overflow-hidden relative ${isMe ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none border border-slate-200'}`}>
                      {msg.context?.id && (() => {
                        const repliedMsg = activeChat.messages.find(m => m.id === msg.context?.id);
                        return (
                          <div className={`mb-2 pl-3 py-1.5 pr-2 rounded relative before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:rounded-l ${isMe ? 'bg-indigo-700/30 before:bg-indigo-300 text-indigo-100' : 'bg-slate-100 before:bg-indigo-400 text-slate-600'}`}>
                            <p className="text-xs font-semibold mb-0.5 opacity-80">{repliedMsg?.from === 'me' ? 'Anda' : getDisplayName(activeChat)}</p>
                            <p className="text-xs truncate">
                              {repliedMsg?.type === 'text' ? repliedMsg.text?.body
                                : repliedMsg?.type === 'image' ? (repliedMsg.image?.caption || '[Gambar]')
                                : repliedMsg?.type === 'video' ? (repliedMsg.video?.caption || '[Video]')
                                : repliedMsg?.type === 'document' ? (repliedMsg.document?.filename || '[Dokumen]')
                                : 'Pesan tidak ditemukan'}
                            </p>
                          </div>
                        );
                      })()}
                      {msg.referral && (
                        <a href={msg.referral.source_url} target="_blank" rel="noopener noreferrer"
                          className={`block mb-2 rounded-lg overflow-hidden border ${isMe ? 'border-indigo-400/40' : 'border-slate-200'} hover:opacity-90 transition-opacity`}>
                          {msg.referral.image_url && (
                            <img src={msg.referral.image_url} alt={msg.referral.headline || 'Iklan'}
                              className="w-full max-h-40 object-cover"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          )}
                          <div className={`px-3 py-2 ${isMe ? 'bg-indigo-700/30' : 'bg-slate-100'}`}>
                            <div className={`flex items-center gap-1 text-[10px] mb-1 ${isMe ? 'text-indigo-300' : 'text-slate-400'}`}>📢 Kirim pesan melalui iklan</div>
                            {msg.referral.headline && <p className={`text-xs font-semibold leading-tight ${isMe ? 'text-indigo-100' : 'text-slate-700'}`}>{msg.referral.headline}</p>}
                            {msg.referral.body && <p className={`text-[11px] mt-0.5 line-clamp-2 ${isMe ? 'text-indigo-200' : 'text-slate-500'}`}>{msg.referral.body}</p>}
                            {msg.referral.source_url && <p className={`text-[10px] mt-1 truncate ${isMe ? 'text-indigo-300' : 'text-slate-400'}`}>🔗 {msg.referral.source_url}</p>}
                          </div>
                        </a>
                      )}
                      {msg.type === 'text' && <p className="text-sm whitespace-pre-wrap break-words [word-break:break-word]">{globalSearchQuery ? renderHighlightedText(msg.text?.body || '', globalSearchQuery) : msg.text?.body}</p>}
                      {msg.type === 'image' && (
                        <div className="flex flex-col">
                          <img src={`/api/media?id=${msg.image?.id}&token=${config.accessToken}`} alt={msg.image?.caption || "Gambar"}
                            className="max-w-[240px] sm:max-w-xs rounded-xl max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            loading="lazy"
                            onClick={() => setFullscreenImage(`/api/media?id=${msg.image?.id}&token=${config.accessToken}`)}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }} />
                          <div className="hidden text-sm italic opacity-80 p-2 bg-slate-100 rounded-lg text-slate-500 mt-2">Gagal memuat gambar.</div>
                          {msg.image?.caption && <p className="text-sm mt-2">{globalSearchQuery ? renderHighlightedText(msg.image.caption, globalSearchQuery) : msg.image.caption}</p>}
                        </div>
                      )}
                      {msg.type === 'video' && (
                        <div className="flex flex-col">
                          <video src={`/api/media?id=${msg.video?.id}&token=${config.accessToken}`} controls
                            className="max-w-[240px] sm:max-w-xs rounded-xl max-h-64 bg-black object-contain"
                            onError={(e) => { (e.target as HTMLVideoElement).style.display = 'none'; (e.target as HTMLVideoElement).nextElementSibling?.classList.remove('hidden'); }} />
                          <div className="hidden text-sm italic opacity-80 p-2 bg-slate-100 rounded-lg text-slate-500 mt-2">Gagal memuat video.</div>
                          {msg.video?.caption && <p className="text-sm mt-2">{globalSearchQuery ? renderHighlightedText(msg.video.caption, globalSearchQuery) : msg.video.caption}</p>}
                        </div>
                      )}
                      {msg.type === 'document' && (
                        <div className="flex flex-col">
                          <a href={`/api/media?id=${msg.document?.id}&token=${config.accessToken}`} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 p-3 bg-slate-100/50 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200/50">
                            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded flex items-center justify-center shrink-0"><Paperclip className="w-5 h-5" /></div>
                            <div className="flex flex-col overflow-hidden">
                              <span className="text-sm font-medium text-slate-700 truncate">{msg.document?.filename || 'Dokumen'}</span>
                              <span className="text-xs text-slate-500 uppercase">PDF • {msg.document?.caption || 'lampiran'}</span>
                            </div>
                          </a>
                          {msg.document?.caption && <p className="text-sm mt-2">{globalSearchQuery ? renderHighlightedText(msg.document.caption, globalSearchQuery) : msg.document.caption}</p>}
                        </div>
                      )}
                      {msg.type === 'audio' && (
                        <div className="flex flex-col min-w-[200px]">
                          <div className={`flex items-center gap-2 mb-2 text-xs font-semibold ${isMe ? 'text-indigo-200' : 'text-slate-500'}`}>
                            <span>{msg.audio?.voice ? '🎤 Pesan Suara' : '🎵 Audio'}</span>
                          </div>
                          <audio controls className="w-full max-w-[280px] rounded-lg" style={{ height: '36px' }}
                            onError={(e) => { (e.target as HTMLAudioElement).style.display = 'none'; (e.target as HTMLAudioElement).nextElementSibling?.classList.remove('hidden'); }}>
                            <source src={`/api/media?id=${msg.audio?.id}&token=${config.accessToken}`} />
                            Browser Anda tidak mendukung audio.
                          </audio>
                          <div className="hidden text-sm italic opacity-80 p-2 bg-slate-100 rounded-lg text-slate-500 mt-2">Gagal memuat audio.</div>
                        </div>
                      )}
                      {msg.type !== 'text' && msg.type !== 'image' && msg.type !== 'video' && msg.type !== 'document' && msg.type !== 'audio' && msg.type !== 'unsupported' && (
                        <p className="text-sm italic opacity-80">[Pesan tipe {msg.type} belum didukung]</p>
                      )}
                      <div className={`flex flex-row justify-between items-end mt-1 ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {msg.reactions && msg.reactions.length > 0 ? (
                          <div className={`flex flex-wrap gap-1 px-1 py-0.5 rounded-full ${isMe ? 'bg-indigo-700/50' : 'bg-slate-100'} mt-1`}>
                            {msg.reactions.map((r, i) => <span key={i} className="text-[12px]">{r.emoji}</span>)}
                          </div>
                        ) : <div />}
                        <span className="text-[10px] whitespace-nowrap ml-2">
                          {formatTimestamp(msg.timestamp)}{' '}
                          {isMe && (msg.status === 'read' ? '• Dilihat' : msg.status === 'delivered' ? '• Terkirim' : msg.status === 'sent' ? '• Dikirim' : msg.status === 'failed' ? '• Gagal' : msg.status === 'pending' ? '• Mengirim...' : '')}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className={`absolute top-1/2 -translate-y-1/2 ${isMe ? '-left-[80px]' : '-right-[80px]'} w-[76px] opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-1 px-1`}>
                      <button className="p-1.5 flex items-center justify-center bg-white border border-slate-200 rounded-full text-slate-400 hover:text-indigo-600 shadow-sm" title="Balas pesan" onClick={() => setReplyingToMessage(msg)}>
                        <MessageSquare className="w-4 h-4" />
                      </button>
                      <button className="p-1.5 flex items-center justify-center bg-white border border-slate-200 rounded-full text-slate-400 hover:text-indigo-600 shadow-sm" title="Beri reaksi" onClick={() => setReactingToMessageId(reactingToMessageId === msg.id ? null : msg.id)}>
                        <span className="text-sm leading-none block px-0.5 mt-0.5">😀</span>
                      </button>
                    </div>

                    {/* Reaction popup */}
                    {reactingToMessageId === msg.id && (
                      <div className={`absolute bottom-full mb-2 ${isMe ? 'right-0' : 'left-0'} z-10 bg-white border border-slate-200 shadow-xl rounded-full px-3 py-2 flex gap-2 animate-in fade-in slide-in-from-bottom-2`}>
                        {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                          <button key={emoji} className="text-xl hover:scale-125 transition-transform origin-bottom" onClick={() => { handleReaction(msg.id, emoji); setReactingToMessageId(null); }}>
                            {emoji}
                          </button>
                        ))}
                        {msg.reactions?.some(r => r.fromMe) && (
                          <button className="text-lg text-slate-400 hover:text-red-500 ml-1 border-l pl-2 border-slate-200" title="Hapus reaksi" onClick={() => { handleReaction(msg.id, ""); setReactingToMessageId(null); }}>
                            <X className="w-5 h-5 inline-block" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </section>

            <footer className="p-4 bg-white border-t border-slate-200 flex flex-col gap-2 relative">
              {replyingToMessage && (
                <div className="flex bg-slate-50 border border-slate-200 rounded-xl overflow-hidden relative">
                  <div className="w-1 bg-indigo-500"></div>
                  <div className="flex-1 p-3 pt-2">
                    <p className="text-xs font-semibold text-indigo-600 mb-0.5">{replyingToMessage.from === 'me' ? 'Anda' : getDisplayName(activeChat)}</p>
                    <p className="text-sm text-slate-600 line-clamp-1">
                      {replyingToMessage.type === 'text' ? replyingToMessage.text?.body
                        : replyingToMessage.type === 'image' ? (replyingToMessage.image?.caption || 'Foto')
                        : replyingToMessage.type === 'video' ? (replyingToMessage.video?.caption || 'Video')
                        : replyingToMessage.type === 'document' ? (replyingToMessage.document?.filename || 'Dokumen')
                        : 'Pesan'}
                    </p>
                  </div>
                  <button onClick={() => setReplyingToMessage(null)} className="p-3 text-slate-400 hover:text-red-500 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              )}
              {attachment && (
                <div className="flex items-center gap-3 p-2 bg-slate-50 border border-slate-200 rounded-xl relative">
                  {attachment.type.startsWith('image/') ? (
                    <img src={URL.createObjectURL(attachment)} alt="preview" className="w-16 h-16 object-cover rounded-lg" />
                  ) : (
                    <div className="w-16 h-16 bg-slate-200 rounded-lg flex items-center justify-center"><Paperclip className="w-8 h-8 text-slate-400" /></div>
                  )}
                  <div className="flex-1 truncate text-sm font-medium text-slate-700">{attachment.name}</div>
                  <button onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="p-1.5 bg-rose-100 text-rose-600 rounded-lg hover:bg-rose-200">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <div className="flex items-end space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 relative">
                <input type="file" ref={fileInputRef} className="hidden" disabled={!activeChatWindow.isOpen}
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) setAttachment(file); }}
                  accept="image/*,video/*,application/pdf" />
                <button onClick={() => fileInputRef.current?.click()} disabled={!activeChatWindow.isOpen}
                  className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 transition-colors mb-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent">
                  <Paperclip className="w-5 h-5" />
                </button>

                {/* Quick Reply Button */}
                <div ref={quickReplyPanelRef} className="relative mb-0.5">
                  <button onClick={() => { setShowQuickReplies(v => !v); setQuickReplySearch(''); }} disabled={!activeChatWindow.isOpen}
                    className={`p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${showQuickReplies ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:text-indigo-600 hover:bg-slate-100'}`} title="Balasan Cepat">
                    <Zap className="w-5 h-5" />
                  </button>
                  {showQuickReplies && (
                    <div className="absolute bottom-full mb-2 left-0 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden z-50">
                      <div className="px-3 py-2.5 bg-indigo-600 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-white">
                          <Zap className="w-4 h-4" />
                          <span className="text-sm font-bold">Balasan Cepat</span>
                        </div>
                        <button onClick={() => { setShowQuickReplies(false); setIsQuickReplySettingsOpen(true); setEditingQuickReply(null); setQrForm({ title: '', message: '' }); }}
                          className="text-indigo-200 hover:text-white transition-colors" title="Kelola template">
                          <Settings className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="p-2 border-b border-slate-100">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                          <input type="text" placeholder="Cari template..." value={quickReplySearch} onChange={e => setQuickReplySearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400" autoFocus />
                        </div>
                      </div>
                      <div className="max-h-60 overflow-y-auto divide-y divide-slate-50">
                        {quickReplies
                          .filter(qr => !quickReplySearch || qr.title.toLowerCase().includes(quickReplySearch.toLowerCase()) || qr.message.toLowerCase().includes(quickReplySearch.toLowerCase()))
                          .map(qr => (
                            <button key={qr.id} onClick={() => applyQuickReply(qr)} className="w-full text-left px-4 py-3 hover:bg-indigo-50 transition-colors group">
                              <p className="text-xs font-bold text-indigo-600 mb-0.5 flex items-center gap-1"><Zap className="w-3 h-3" /> {qr.title}</p>
                              <p className="text-sm text-slate-600 line-clamp-2 leading-snug">
                                {qr.message.replace(/\{\{nama\}\}/gi, getContactDisplayName(activeChat?.id || '', activeChat?.name || '') || '{{nama}}')}
                              </p>
                            </button>
                          ))}
                        {quickReplies.filter(qr => !quickReplySearch || qr.title.toLowerCase().includes(quickReplySearch.toLowerCase()) || qr.message.toLowerCase().includes(quickReplySearch.toLowerCase())).length === 0 && (
                          <div className="px-4 py-6 text-center text-slate-400 text-sm">Template tidak ditemukan</div>
                        )}
                      </div>
                      <div className="p-2 border-t border-slate-100">
                        <button onClick={() => { setShowQuickReplies(false); setIsQuickReplySettingsOpen(true); setEditingQuickReply(null); setQrForm({ title: '', message: '' }); }}
                          className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                          <Plus className="w-3.5 h-3.5" /> Tambah Template Baru
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <textarea value={inputText} disabled={!activeChatWindow.isOpen} onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && activeChatWindow.isOpen) { e.preventDefault(); handleSendMessage(); } }}
                  placeholder={activeChatWindow.isOpen ? "Ketik balasan Anda..." : "Sesi ditutup (Waktu 24 jam habis)"}
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2.5 px-2 focus:outline-none resize-none disabled:text-slate-400 disabled:cursor-not-allowed"
                  rows={Math.min(Math.max(inputText.split('\n').length, 1), 5)} />
                <button onClick={handleSendMessage} disabled={(!inputText.trim() && !attachment) || isUploading || !activeChatWindow.isOpen}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 flex flex-row items-center gap-2 mb-0.5">
                  {isUploading ? <CircleDashed className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {isUploading ? 'Mengirim...' : 'Kirim'}
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <p>Pilih percakapan untuk mulai membaca pesan.</p>
          </div>
        )}
      </main>

      {/* Customer Details Panel */}
      {activeChat && (
        <aside className="hidden lg:flex w-64 bg-white border-l border-slate-200 p-6 flex-col overflow-y-auto shrink-0">
          <div className="text-center">
            <div className="w-20 h-20 bg-slate-100 rounded-full mx-auto mb-4 border-2 border-slate-200 flex items-center justify-center text-slate-400 text-2xl font-bold">
              {getDisplayName(activeChat).charAt(0)}
            </div>
            <h3 className="font-bold text-slate-900">{getDisplayName(activeChat)}</h3>
            <p className="text-xs text-slate-500 mt-1">
              {activeProfile?.found === false ? 'Tidak ditemukan di database' : activeProfile ? 'Data dari sistem' : 'Memuat data...'}
            </p>
          </div>

          <div className="mt-8 space-y-6">
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Kontak Details</h4>
              <div className="space-y-2">
                <div className="text-sm text-slate-700 font-medium flex justify-between">
                  <span>Nama:</span>
                  <span className="text-slate-500 truncate ml-2" title={activeProfile?.orders?.[0]?.nama || activeProfile?.name || '-'}>
                    {activeProfile?.orders?.[0]?.nama || activeProfile?.name || '-'}
                  </span>
                </div>
                <div className="text-sm text-slate-700 font-medium flex justify-between">
                  <span>WhatsApp:</span>
                  <span className="text-slate-500">{activeChat.phone}</span>
                </div>
                <div className="text-sm text-slate-700 font-medium flex justify-between">
                  <span>Email:</span>
                  <span className="text-slate-500 truncate ml-2" title={activeProfile?.orders?.[0]?.email || '-'}>
                    {activeProfile?.orders?.[0]?.email || '-'}
                  </span>
                </div>
                {activeProfile && (
                  <div className="text-sm text-slate-700 font-medium flex justify-between">
                    <span>Total Order:</span>
                    <span className="text-indigo-600 font-bold">{activeProfile.total_orders ?? 0}</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Riwayat Pesanan</h4>
              <div className="space-y-3">
                {activeProfile?.orders && activeProfile.orders.length > 0 ? (
                  activeProfile.orders.map((order) => (
                    <div key={order.order_id} className="p-2 bg-slate-50 rounded border border-slate-100">
                      <p className="text-xs font-bold text-slate-800">Order #{order.order_id}</p>
                      <p className="text-[11px] font-medium text-slate-700 mt-1 line-clamp-1" title={order.product}>{order.product}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{order.tanggal} • Rp {parseFloat(order.revenue).toLocaleString('id-ID')}</p>
                    </div>
                  ))
                ) : (
                  <div className="p-4 bg-slate-50 rounded border border-slate-100 text-center">
                    <p className="text-xs text-slate-500">
                      {activeProfile ? (activeProfile.found ? 'Tidak ada pesanan.' : 'Kontak tidak ditemukan di database.') : 'Memuat data...'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-auto pt-4">
              <button
                onClick={() => activeChat && fetchProfile(activeChat.id, activeChat.name, false)}
                disabled={isRefreshingProfile}
                className="w-full flex items-center justify-center gap-2 border border-slate-200 text-slate-600 py-2 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRefreshingProfile ? <CircleDashed className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {isRefreshingProfile ? 'Memproses...' : 'Refresh'}
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">Pengaturan WhatsApp API</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <h3 className="text-sm font-bold text-slate-800 mb-2">Konfigurasi Webhook</h3>
                <p className="text-xs text-slate-500 mb-4">Gunakan konfigurasi ini di Meta App Dashboard (WhatsApp &gt; Configuration).</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Callback URL</label>
                    <div className="flex">
                      <input type="text" readOnly value={`${window.location.origin}/api/webhook`} className="w-full bg-white border border-slate-300 rounded-l-lg py-1.5 px-3 text-sm focus:outline-none" />
                      <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/webhook`)} className="bg-slate-200 text-slate-700 px-3 py-1.5 rounded-r-lg text-xs font-bold hover:bg-slate-300 border border-l-0 border-slate-300">Copy</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Verify Token</label>
                    <div className="flex">
                      <input type="text" readOnly value="my-verify-token" className="w-full bg-white border border-slate-300 rounded-l-lg py-1.5 px-3 text-sm focus:outline-none" />
                      <button onClick={() => navigator.clipboard.writeText("my-verify-token")} className="bg-slate-200 text-slate-700 px-3 py-1.5 rounded-r-lg text-xs font-bold hover:bg-slate-300 border border-l-0 border-slate-300">Copy</button>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 mb-2">Kredensial API</h3>
                <p className="text-xs text-slate-500 mb-4">Diperlukan untuk membalas/mengirim pesan.</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Phone Number ID</label>
                    <input type="text" value={config.phoneNumberId} onChange={e => setConfig({ ...config, phoneNumberId: e.target.value })} placeholder="Misal: 1059345267..." className="w-full bg-white border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Access Token / Permanent Token</label>
                    <input type="password" value={config.accessToken} onChange={e => setConfig({ ...config, accessToken: e.target.value })} placeholder="EAAL..." className="w-full bg-white border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-indigo-500" />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end space-x-2">
              <button onClick={() => setIsSettingsOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800">Batal</button>
              <button onClick={() => { localStorage.setItem('wa_phone_number_id', config.phoneNumberId); localStorage.setItem('wa_access_token', config.accessToken); setIsSettingsOpen(false); }} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700">Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Reply Settings Modal */}
      {isQuickReplySettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-indigo-600" />
                <h2 className="text-xl font-bold text-slate-800">Kelola Balasan Cepat</h2>
              </div>
              <button onClick={() => { setIsQuickReplySettingsOpen(false); setEditingQuickReply(null); setQrForm({ title: '', message: '' }); }} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                  {editingQuickReply ? '✏️ Edit Template' : '➕ Template Baru'}
                </h3>
                <div className="space-y-2">
                  <input type="text" placeholder="Nama shortcut (contoh: Salam pembuka)" value={qrForm.title} onChange={e => setQrForm(f => ({ ...f, title: e.target.value }))} className="w-full border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-indigo-500" />
                  <textarea placeholder="Isi pesan... (gunakan {{nama}} untuk nama kontak)" value={qrForm.message} onChange={e => setQrForm(f => ({ ...f, message: e.target.value }))} rows={3} className="w-full border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-indigo-500 resize-none" />
                  <div className="flex gap-2 justify-end">
                    {editingQuickReply && (
                      <button onClick={() => { setEditingQuickReply(null); setQrForm({ title: '', message: '' }); }} className="px-3 py-1.5 text-sm font-bold text-slate-500 hover:text-slate-700">Batal</button>
                    )}
                    <button onClick={saveQuickReply} disabled={!qrForm.title.trim() || !qrForm.message.trim()} className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                      <Plus className="w-4 h-4" />
                      {editingQuickReply ? 'Simpan Perubahan' : 'Tambah'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {quickReplies.length === 0 && <div className="px-6 py-10 text-center text-slate-400 text-sm">Belum ada template. Tambahkan di atas.</div>}
                {quickReplies.map(qr => (
                  <div key={qr.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-indigo-600 flex items-center gap-1 mb-0.5"><Zap className="w-3 h-3" /> {qr.title}</p>
                      <p className="text-sm text-slate-600 line-clamp-2">{qr.message}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 mt-0.5">
                      <button onClick={() => { setEditingQuickReply(qr); setQrForm({ title: qr.title, message: qr.message }); }} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => deleteQuickReply(qr.id)} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors" title="Hapus"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 text-center">
              <p className="text-[11px] text-slate-400">Gunakan <code className="bg-slate-200 px-1 rounded">{'{{nama}}'}</code> untuk menyisipkan nama kontak secara otomatis</p>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Image Modal */}
      {fullscreenImage && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] p-4 cursor-zoom-out" onClick={() => setFullscreenImage(null)}>
          <img src={fullscreenImage} alt="Fullscreen" className="max-w-full max-h-screen object-contain" />
          <button className="absolute top-4 right-4 text-white bg-black/50 p-2 rounded-full hover:bg-black/70 transition-colors" onClick={(e) => { e.stopPropagation(); setFullscreenImage(null); }}>
            <X className="w-6 h-6" />
          </button>
        </div>
      )}

      {/* Confirm Delete Chat Modal */}
      {chatToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col">
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4 text-rose-500">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Hapus Obrolan?</h3>
              <p className="text-sm text-slate-500">Apakah Anda yakin ingin menghapus obrolan ini? Tindakan ini tidak dapat dibatalkan.</p>
            </div>
            <div className="px-6 py-4 bg-slate-50 flex gap-2 justify-end">
              <button onClick={() => setChatToDelete(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800">Batal</button>
              <button onClick={() => { setConversations(prev => prev.filter(c => c.id !== chatToDelete)); if (activeChatId === chatToDelete) setActiveChatId(null); setChatToDelete(null); }} className="bg-rose-500 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-rose-600">Hapus</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}