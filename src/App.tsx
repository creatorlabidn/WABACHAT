import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  MessageSquare, User, Settings, Phone, Video, Paperclip, 
  Search, Send, CheckCircle2, CircleDashed, X, Tag
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

interface Conversation {
  id: string;
  name: string;
  phone: string;
  messages: WAMessage[];
  lastMessageTime: string;
  unreadCount?: number;
  labels?: string[];
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const saved = localStorage.getItem('wa_conversations');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to parse conversations from local storage', e);
    }
    return [
      {
        id: "16315551234",
        name: "Budi Santoso",
        phone: "+62 812 3456 7890",
        messages: [
          {
            from: "16315551234",
            id: "msg1",
            timestamp: (Date.now() / 1000 - 300).toString(),
            type: "text",
            text: { body: "Halo, apakah pesanan saya sudah dikirim? Terima kasih" }
          },
          {
            from: "me",
            id: "msg2",
            timestamp: (Date.now() / 1000 - 120).toString(),
            type: "text",
            status: "read",
            text: { body: "Halo Pak Budi, pesanan #8829 sedang diproses oleh tim gudang kami dan akan dikirim sore ini." }
          },
          {
            from: "16315551234",
            id: "msg3",
            timestamp: (Date.now() / 1000 - 60).toString(),
            type: "text",
            text: { body: "Baik, bisa minta nomor resinya nanti kalau sudah ada?" }
          }
        ],
        lastMessageTime: new Date(Date.now() - 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        labels: ["Prospek"]
      },
      {
        id: "62899999999",
        name: "Siti Aminah",
        phone: "+62 899 9999 999",
        messages: [
          {
            from: "62899999999",
            id: "msg_siti1",
            timestamp: (Date.now() / 1000 - 86400).toString(),
            type: "text",
            text: { body: "Terima kasih atas bantuannya, layanannya sangat memuaskan!" }
          }
        ],
        lastMessageTime: "Kemarin"
      }
    ];
  });
  
  useEffect(() => {
    localStorage.setItem('wa_conversations', JSON.stringify(conversations));
  }, [conversations]);

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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (labelMenuRef.current && !labelMenuRef.current.contains(event.target as Node)) {
        setShowLabelMenu(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveChatId(null);
      }
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
        if (labels.includes(label)) {
          return { ...c, labels: labels.filter(l => l !== label) };
        } else {
          return { ...c, labels: [...labels, label] };
        }
      }
      return c;
    }));
  };

  const activeChat = activeChatId ? conversations.find(c => c.id === activeChatId) : null;

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
    
    // Clear unread count when switching chats
    setConversations(prev => prev.map(c => c.id === activeChatId ? { ...c, unreadCount: 0 } : c));
  }, [activeChatId]);

  // Mark all unread incoming messages as read
  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);
  
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

  useEffect(() => {
    // Track processed message IDs to avoid duplicates during polling
    const processedMsgIds = new Set<string>();

    const fetchWebhooks = async () => {
      try {
        const phoneId = configRef.current.phoneNumberId;
        const phoneIdParam = phoneId ? `&phoneId=${encodeURIComponent(phoneId)}` : '';
        const res = await fetch(`/api/webhooks?t=${Date.now()}${phoneIdParam}`, {
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        if (!res.ok) return;
        const webhooks: any[] = await res.json();
        
        webhooks.forEach((payload: any) => {
          if (payload.error) {
            console.error(payload.message);
            return;
          }
          if (
            payload.entry &&
            payload.entry[0].changes &&
            payload.entry[0].changes[0]
          ) {
            const value = payload.entry[0].changes[0].value;
            
            // Handle message status updates
            if (value.statuses) {
              const statusUpdates = value.statuses;
              statusUpdates.forEach((statusUpdate: any) => {
                const foundChat = conversationsRef.current.find(c => c.messages.some(m => m.id === statusUpdate.id));
                if (!foundChat) return;

                if (processedMsgIds.has(`${statusUpdate.id}_${statusUpdate.status}`)) return;
                processedMsgIds.add(`${statusUpdate.id}_${statusUpdate.status}`);
                
                setConversations(prev => {
                  return prev.map(chat => {
                    const hasMessage = chat.messages.some(m => m.id === statusUpdate.id);
                    if (hasMessage) {
                      return {
                        ...chat,
                        messages: chat.messages.map(m => {
                          if (m.id === statusUpdate.id) {
                            const weights: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };
                            const currentW = weights[m.status || 'pending'] ?? 0;
                            const newW = weights[statusUpdate.status] ?? 0;
                            if (newW > currentW) {
                              return { ...m, status: statusUpdate.status };
                            }
                          }
                          return m;
                        })
                      };
                    }
                    return chat;
                  });
                });
              });
            }

            // Handle new messages
            if (value.messages) {
              const contacts = value.contacts as WAContact[];
              const messages = value.messages as WAMessage[];
              
              if (!messages || messages.length === 0) return;
              
              const newMsg = messages[0];
              
              // Skip if already processed
              if (processedMsgIds.has(newMsg.id)) return;
              processedMsgIds.add(newMsg.id);

              const contact = contacts ? contacts[0] : null;
              const phone = newMsg.from;
              const defaultName = contact ? contact.profile.name : `+${phone}`;

              if (!isInitialFetchRef.current && Notification.permission === "granted") {
                const isCurrentlyActive = phone === activeChatIdRef.current;
                if (!isCurrentlyActive || document.hidden) {
                  const body = newMsg.type === 'text' ? newMsg.text?.body : newMsg.type === 'image' ? (newMsg.image?.caption || '[Gambar]') : newMsg.type === 'video' ? (newMsg.video?.caption || '[Video]') : `[${newMsg.type}]`;
                  const notification = new Notification(`Pesan baru dari ${defaultName}`, {
                    body: body,
                  });
                  notification.onclick = () => {
                    window.focus();
                  };
                }
              }

              setConversations(prev => {
                if (newMsg.type === 'reaction' && newMsg.reaction) {
                  const targetMessageId = newMsg.reaction.message_id;
                  const existingChat = prev.find(c => c.id === phone);
                  if (existingChat) {
                    const hasTargetMessage = existingChat.messages.some(m => m.id === targetMessageId);
                    if (hasTargetMessage) {
                      return prev.map(chat => {
                        if (chat.id === phone) {
                          return {
                            ...chat,
                            messages: chat.messages.map(m => {
                              if (m.id === targetMessageId) {
                                const currentReactions = m.reactions || [];
                                const newEmoji = newMsg.reaction?.emoji || "";
                                const fromMe = false;
                                const otherReactions = currentReactions.filter(r => r.fromMe !== fromMe);
                                const newReactions = newEmoji ? [...otherReactions, { emoji: newEmoji, fromMe }] : otherReactions;
                                return { ...m, reactions: newReactions };
                              }
                              return m;
                            })
                          };
                        }
                        return chat;
                      });
                    }
                  }
                  return prev;
                }

                // Avoid duplicates in state
                const existingChat = prev.find(c => c.id === phone);
                if (existingChat && existingChat.messages.some(m => m.id === newMsg.id)) {
                  return prev;
                }

                const isCurrentlyActive = phone === activeChatIdRef.current;
                const isInitial = isInitialFetchRef.current;

                if (existingChat) {
                  const updatedChat = {
                    ...existingChat,
                    messages: [...existingChat.messages, newMsg],
                    lastMessageTime: new Date(parseInt(newMsg.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    unreadCount: isCurrentlyActive ? 0 : isInitial ? (existingChat.unreadCount || 0) : (existingChat.unreadCount || 0) + 1
                  };
                  return [updatedChat, ...prev.filter(c => c.id !== phone)];
                } else {
                  const newChat: Conversation = {
                    id: phone,
                    name: defaultName,
                    phone: `+${phone}`,
                    messages: [newMsg],
                    lastMessageTime: new Date(parseInt(newMsg.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    unreadCount: isCurrentlyActive || isInitial ? 0 : 1
                  };
                  return [newChat, ...prev];
                }
              });
            }
          }
        });
        isInitialFetchRef.current = false;
      } catch (err) {
        console.error('Error fetching webhooks:', err);
      }
    };

    // Initial fetch
    fetchWebhooks();

    // Poll every 3 seconds
    const interval = setInterval(fetchWebhooks, 3000);
    return () => clearInterval(interval);
  }, []);

  const formatTimestamp = (ts: string) => {
    const date = new Date(parseInt(ts) * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() && !attachment) return;

    if (!config.phoneNumberId || !config.accessToken) {
      alert('Mohon isi Phone Number ID dan Access Token di Pengaturan (Settings) terlebih dahulu.');
      setIsSettingsOpen(true);
      return;
    }
    
    setIsUploading(true);

    try {
      let mediaId: string | undefined;

      // Handle file upload if there's an attachment
      if (attachment) {
        const formData = new FormData();
        formData.append("file", attachment);
        formData.append("token", config.accessToken);
        formData.append("phoneId", config.phoneNumberId);

        const uploadRes = await fetch("/api/upload-media", {
          method: "POST",
          body: formData
        });

        const uploadText = await uploadRes.text();
        let uploadData: any;
        try {
          uploadData = JSON.parse(uploadText);
        } catch (e) {
          console.error("Raw upload response:", uploadText);
          throw new Error(`Upload response was not invalid JSON (Status: ${uploadRes.status}): ${uploadText.slice(0, 150)}`);
        }

        if (!uploadRes.ok) {
          throw new Error(`Upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
        }
        
        mediaId = uploadData.id;
        if (!mediaId) {
          throw new Error("Failed to get media ID from WhatsApp API");
        }
      }

      const messageToSend = inputText;
      const cachedAttachment = attachment;
      
      const isVideo = cachedAttachment?.type.startsWith('video/');
      const isDocument = cachedAttachment?.type === 'application/pdf';
      const msgType = mediaId ? (isVideo ? 'video' : isDocument ? 'document' : 'image') : 'text';

      const replyToMsg = replyingToMessage;
      setReplyingToMessage(null);

      // Update UI optimistically after upload starts/finishes for the message
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

      setConversations(prev => {
        return prev.map(chat => {
          if (chat.id === activeChatId) {
            return {
              ...chat,
              messages: [...chat.messages, newMsg],
              lastMessageTime: formatTimestamp(newMsg.timestamp)
            };
          }
          return chat;
        });
      });

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
          mediaId: mediaId,
          filename: cachedAttachment?.name,
          replyToId: replyToMsg?.id
        })
      });
      const data: any = await res.json();
      if (!res.ok) {
        console.error("Failed to send", data);
        alert(`Gagal mengirim pesan: ${data.error?.message || JSON.stringify(data)}`);
      } else {
        if (data.messages && data.messages.length > 0) {
          const realId = data.messages[0].id;
          
          setConversations(prev => {
            return prev.map(chat => {
              if (chat.id === activeChatId) {
                return {
                  ...chat,
                  messages: chat.messages.map(m => m.id === newMsg.id ? { ...m, id: realId, status: 'sent' } : m)
                };
              }
              return chat;
            });
          });
        }
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Gagal mengirim pesan, periksa koneksi Anda.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    if (!config.phoneNumberId || !config.accessToken) {
      alert('Mohon isi Phone Number ID dan Access Token di Pengaturan (Settings) terlebih dahulu.');
      return;
    }
    
    // Optimistic UI update
    setConversations(prev => {
      return prev.map(chat => {
        if (chat.id === activeChatId) {
          return {
            ...chat,
            messages: chat.messages.map(m => {
              if (m.id === messageId) {
                const currentReactions = m.reactions || [];
                const otherReactions = currentReactions.filter(r => r.fromMe !== true);
                const newReactions = emoji ? [...otherReactions, { emoji, fromMe: true }] : otherReactions;
                return { ...m, reactions: newReactions };
              }
              return m;
            })
          };
        }
        return chat;
      });
    });

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
      if (!res.ok) {
        console.error("Failed to react", data);
        alert(`Gagal memberi reaksi: ${data.error?.message || JSON.stringify(data)}`);
      }
    } catch (err) {
      console.error(err);
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

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 font-sans">
      {/* Global Sidebar */}
      <aside className="w-16 bg-slate-900 flex flex-col items-center py-6 space-y-8 text-slate-400">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-xl">
          B
        </div>
        <div className="flex flex-col space-y-6">
          <div className="p-2 bg-slate-800 text-white rounded-lg cursor-pointer">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div className="p-2 hover:text-white cursor-pointer transition-colors">
            <User className="w-6 h-6" />
          </div>
          <div onClick={() => setIsSettingsOpen(true)} className="p-2 hover:text-white cursor-pointer transition-colors">
            <Settings className="w-6 h-6" />
          </div>
        </div>
        <div className="mt-auto pb-4">
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs text-white cursor-pointer">
            A
          </div>
        </div>
      </aside>

      {/* Conversations List */}
      <nav className="w-80 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-100">
          <h1 className="text-xl font-bold text-slate-800">Inbox</h1>
          <p className="text-xs text-slate-500 uppercase tracking-widest mt-1">Business API Dashboard</p>
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
            return chat.name.toLowerCase().includes(q) || chat.messages.some(m => m.text?.body?.toLowerCase().includes(q) || m.image?.caption?.toLowerCase().includes(q) || m.video?.caption?.toLowerCase().includes(q));
          }).map(chat => {
            const lastMsg = chat.messages[chat.messages.length - 1];
            const isActive = chat.id === activeChatId;
            return (
              <div 
                key={chat.id}
                onClick={() => {
                  setActiveChatId(chat.id);
                  if (chat.unreadCount) {
                    setConversations(prev => prev.map(c => 
                      c.id === chat.id ? { ...c, unreadCount: 0 } : c
                    ));
                  }
                }}
                onMouseEnter={(e) => {
                  if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                  // Capture target before setTimeout — synthetic event becomes invalid after delay
                  const target = e.currentTarget as HTMLElement;
                  hoverTimeoutRef.current = setTimeout(() => {
                    if (chat.unreadCount && chat.unreadCount > 0) {
                      const rect = target.getBoundingClientRect();
                      const popupWidth = 288; // w-72
                      const popupMaxHeight = 340;
                      const viewportHeight = window.innerHeight;
                      const viewportWidth = window.innerWidth;

                      // Position to the right of the nav panel
                      let leftPos = rect.right + 8;
                      // If popup would overflow right edge, flip to left
                      if (leftPos + popupWidth > viewportWidth - 8) {
                        leftPos = rect.left - popupWidth - 8;
                      }

                      // Align top with hovered item, clamp so popup stays in viewport
                      let topPos = rect.top;
                      if (topPos + popupMaxHeight > viewportHeight - 16) {
                        topPos = Math.max(16, viewportHeight - popupMaxHeight - 16);
                      }

                      setHoverPos({ top: topPos, left: leftPos });
                      setHoveredChatId(chat.id);
                    }
                  }, 400);
                }}
                onMouseLeave={() => {
                  if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                  setHoveredChatId(null);
                }}
                className={`relative p-4 border-l-4 cursor-pointer transition-colors ${
                  isActive 
                    ? 'bg-indigo-50 border-indigo-600' 
                    : 'hover:bg-slate-50 border-transparent'
                }`}
              >
                <div className="flex justify-between items-start">
                  <span className={`font-semibold truncate pr-2 ${chat.unreadCount ? 'text-slate-900 font-bold' : 'text-slate-900'}`}>{chat.name}</span>
                  <span className={`text-xs whitespace-nowrap ${isActive ? 'text-indigo-600 font-medium' : chat.unreadCount ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
                    {chat.lastMessageTime}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <p className={`text-sm truncate flex-1 pr-2 ${chat.unreadCount ? 'text-slate-800 font-medium' : 'text-slate-600'}`}>
                    {lastMsg?.type === 'text' ? lastMsg.text?.body : lastMsg?.type === 'image' ? (lastMsg.image?.caption || '[Gambar]') : lastMsg?.type === 'video' ? (lastMsg.video?.caption || '[Video]') : lastMsg?.type === 'document' ? (lastMsg.document?.caption || lastMsg.document?.filename || '[Dokumen]') : lastMsg?.type === 'unsupported' ? '' : `[${lastMsg?.type}]`}
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
                      const color = 
                        label === 'Prospek' ? 'bg-blue-100 text-blue-700' :
                        label === 'Selesai' ? 'bg-emerald-100 text-emerald-700' :
                        label === 'Komplain' ? 'bg-rose-100 text-rose-700' : 
                        'bg-slate-100 text-slate-700';
                      return (
                        <span key={label} className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${color}`}>
                          {label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Portal: Hover Preview Popup — rendered to document.body, always above everything */}
        {hoveredChatId && (() => {
          const hoveredChat = conversations.find(c => c.id === hoveredChatId);
          if (!hoveredChat) return null;
          const unreadMsgs = hoveredChat.messages.filter(m => m.from !== 'me' && m.status !== 'read_by_me').slice(-10);
          if (unreadMsgs.length === 0) return null;
          return createPortal(
            <div
              className="fixed w-72 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden pointer-events-none"
              style={{
                top: hoverPos.top,
                left: hoverPos.left,
                // Ensure popup is always rendered above every other element
                zIndex: 2147483647,
                maxHeight: 'calc(100vh - 32px)',
              }}
            >
              <div className="px-4 py-2.5 bg-indigo-600 flex items-center justify-between">
                <span className="text-white text-xs font-bold">{hoveredChat.name}</span>
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
      <main className="flex-1 flex flex-col bg-[#F8FAFC]">
        {activeChat ? (
          <>
            <header className="h-16 bg-white border-b border-slate-200 flex items-center px-6 justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-500 font-medium">
                  {activeChat.name.charAt(0)}
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 flex items-center gap-2">
                    {activeChat.name}
                    {activeChat.labels && activeChat.labels.map(label => {
                      const color = 
                        label === 'Prospek' ? 'bg-blue-100 text-blue-700' :
                        label === 'Selesai' ? 'bg-emerald-100 text-emerald-700' :
                        label === 'Komplain' ? 'bg-rose-100 text-rose-700' : 
                        'bg-slate-100 text-slate-700';
                      return (
                        <span key={label} className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${color}`}>
                          {label}
                        </span>
                      );
                    })}
                  </h2>
                  <p className="text-xs flex items-center font-medium mt-0.5">
                    <span className="text-green-600 flex items-center">
                      <span className="w-2 h-2 bg-green-500 rounded-full mr-1.5" /> Online
                    </span>
                    <span className="mx-2 text-slate-300">|</span>
                    <span className={activeChatWindow.isOpen ? 'text-indigo-600' : 'text-rose-500'}>
                      {activeChatWindow.text}
                    </span>
                  </p>
                </div>
              </div>
              <div ref={labelMenuRef} className="flex space-x-2 relative">
                <button 
                  onClick={() => setShowLabelMenu(!showLabelMenu)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                  title="Tag / Label Obrolan"
                >
                  <Tag className="w-5 h-5" />
                </button>
                
                {showLabelMenu && (
                  <div className="absolute top-12 right-0 w-48 bg-white border border-slate-200 shadow-xl rounded-xl z-50 overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500">
                      Label Obrolan
                    </div>
                    <div className="p-1">
                      {AVAILABLE_LABELS.map(label => {
                        const hasLabel = activeChat.labels?.includes(label);
                        return (
                          <button 
                            key={label}
                            onClick={() => toggleLabel(activeChat.id, label)}
                            className="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-slate-50 rounded-lg transition-colors group"
                          >
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

                <button className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
                  <Phone className="w-5 h-5" />
                </button>
                <button className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
                  <Video className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setActiveChatId(null)}
                  className="p-2 ml-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                  title="Tutup Obrolan (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </header>

            <section className="flex-1 p-6 space-y-4 overflow-y-auto flex flex-col">
              <div className="flex justify-center mb-2">
                <span className="px-3 py-1 bg-slate-200 text-slate-500 text-[10px] font-bold rounded-full uppercase tracking-tighter">
                  Hari Ini
                </span>
              </div>
              
              {activeChat.messages.filter(msg => {
                if (!globalSearchQuery) return true;
                const query = globalSearchQuery.toLowerCase();
                const textBody = msg.text?.body?.toLowerCase() || '';
                const imageCaption = msg.image?.caption?.toLowerCase() || '';
                const videoCaption = msg.video?.caption?.toLowerCase() || '';
                return textBody.includes(query) || imageCaption.includes(query) || videoCaption.includes(query);
              }).map((msg) => {
                if (msg.type === 'unsupported') return null;
                const isMe = msg.from === "me";
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%] md:max-w-lg ${isMe ? 'self-end' : 'self-start'} group relative`}>
                    <div className={`p-3 rounded-2xl shadow-sm overflow-hidden relative ${
                      isMe 
                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                        : 'bg-white text-slate-800 rounded-tl-none border border-slate-200'
                    }`}>
                      {msg.context?.id && (() => {
                        const repliedMsg = activeChat.messages.find(m => m.id === msg.context?.id);
                        return (
                          <div className={`mb-2 pl-3 py-1.5 pr-2 rounded relative before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:rounded-l ${isMe ? 'bg-indigo-700/30 before:bg-indigo-300 text-indigo-100' : 'bg-slate-100 before:bg-indigo-400 text-slate-600'}`}>
                            <p className="text-xs font-semibold mb-0.5 opacity-80">{repliedMsg?.from === 'me' ? 'Anda' : activeChat.name}</p>
                            <p className="text-xs truncate">
                              {repliedMsg?.type === 'text' ? repliedMsg.text?.body : repliedMsg?.type === 'image' ? (repliedMsg.image?.caption || '[Gambar]') : repliedMsg?.type === 'video' ? (repliedMsg.video?.caption || '[Video]') : repliedMsg?.type === 'document' ? (repliedMsg.document?.filename || '[Dokumen]') : 'Pesan tidak ditemukan'}
                            </p>
                          </div>
                        );
                      })()}
                      {msg.referral && (
                        <a
                          href={msg.referral.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`block mb-2 rounded-lg overflow-hidden border ${isMe ? 'border-indigo-400/40' : 'border-slate-200'} hover:opacity-90 transition-opacity`}
                        >
                          {msg.referral.image_url && (
                            <img
                              src={msg.referral.image_url}
                              alt={msg.referral.headline || 'Iklan'}
                              className="w-full max-h-40 object-cover"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                          <div className={`px-3 py-2 ${isMe ? 'bg-indigo-700/30' : 'bg-slate-100'}`}>
                            <div className={`flex items-center gap-1 text-[10px] mb-1 ${isMe ? 'text-indigo-300' : 'text-slate-400'}`}>
                              📢 Kirim pesan melalui iklan
                            </div>
                            {msg.referral.headline && (
                              <p className={`text-xs font-semibold leading-tight ${isMe ? 'text-indigo-100' : 'text-slate-700'}`}>{msg.referral.headline}</p>
                            )}
                            {msg.referral.body && (
                              <p className={`text-[11px] mt-0.5 line-clamp-2 ${isMe ? 'text-indigo-200' : 'text-slate-500'}`}>{msg.referral.body}</p>
                            )}
                            {msg.referral.source_url && (
                              <p className={`text-[10px] mt-1 truncate ${isMe ? 'text-indigo-300' : 'text-slate-400'}`}>
                                🔗 {msg.referral.source_url}
                              </p>
                            )}
                          </div>
                        </a>
                      )}
                      {msg.type === 'text' && <p className="text-sm whitespace-pre-wrap break-words [word-break:break-word]">{globalSearchQuery ? renderHighlightedText(msg.text?.body || '', globalSearchQuery) : msg.text?.body}</p>}
                      {msg.type === 'image' && (
                        <div className="flex flex-col">
                          <img 
                            src={`/api/media?id=${msg.image?.id}&token=${config.accessToken}`} 
                            alt={msg.image?.caption || "Gambar"} 
                            className="max-w-[240px] sm:max-w-xs rounded-xl max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity" 
                            loading="lazy" 
                            onClick={() => setFullscreenImage(`/api/media?id=${msg.image?.id}&token=${config.accessToken}`)}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden text-sm italic opacity-80 p-2 bg-slate-100 rounded-lg text-slate-500 mt-2">Gagal memuat gambar.</div>
                          {msg.image?.caption && <p className="text-sm mt-2">{globalSearchQuery ? renderHighlightedText(msg.image.caption, globalSearchQuery) : msg.image.caption}</p>}
                        </div>
                      )}
                      {msg.type === 'video' && (
                        <div className="flex flex-col">
                          <video 
                            src={`/api/media?id=${msg.video?.id}&token=${config.accessToken}`} 
                            controls
                            className="max-w-[240px] sm:max-w-xs rounded-xl max-h-64 bg-black object-contain" 
                            onError={(e) => {
                              (e.target as HTMLVideoElement).style.display = 'none';
                              (e.target as HTMLVideoElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden text-sm italic opacity-80 p-2 bg-slate-100 rounded-lg text-slate-500 mt-2">Gagal memuat video.</div>
                          {msg.video?.caption && <p className="text-sm mt-2">{globalSearchQuery ? renderHighlightedText(msg.video.caption, globalSearchQuery) : msg.video.caption}</p>}
                        </div>
                      )}
                      {msg.type === 'document' && (
                        <div className="flex flex-col">
                          <a 
                            href={`/api/media?id=${msg.document?.id}&token=${config.accessToken}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 p-3 bg-slate-100/50 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200/50"
                          >
                            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded flex items-center justify-center shrink-0">
                              <Paperclip className="w-5 h-5" />
                            </div>
                            <div className="flex flex-col overflow-hidden">
                              <span className="text-sm font-medium text-slate-700 truncate">{msg.document?.filename || 'Dokumen'}</span>
                              <span className="text-xs text-slate-500 uppercase">PDF • {msg.document?.caption || 'lampiran'}</span>
                            </div>
                          </a>
                          {msg.document?.caption && <p className="text-sm mt-2">{globalSearchQuery ? renderHighlightedText(msg.document.caption, globalSearchQuery) : msg.document.caption}</p>}
                        </div>
                      )}
                      {msg.type !== 'text' && msg.type !== 'image' && msg.type !== 'video' && msg.type !== 'document' && msg.type !== 'unsupported' && (
                        <p className="text-sm italic opacity-80">[Pesan tipe {msg.type} belum didukung]</p>
                      )}
                      
                      <div className={`flex flex-row justify-between items-end mt-1 ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {msg.reactions && msg.reactions.length > 0 ? (
                          <div className={`flex flex-wrap gap-1 px-1 py-0.5 rounded-full ${isMe ? 'bg-indigo-700/50' : 'bg-slate-100'} mt-1`}>
                            {msg.reactions.map((r, i) => (
                              <span key={i} className="text-[12px]">{r.emoji}</span>
                            ))}
                          </div>
                        ) : <div />}
                        <span className="text-[10px] whitespace-nowrap ml-2">
                          {formatTimestamp(msg.timestamp)} {isMe && (msg.status === 'read' ? '• Dilihat' : msg.status === 'delivered' ? '• Terkirim' : msg.status === 'sent' ? '• Dikirim' : msg.status === 'failed' ? '• Gagal' : msg.status === 'pending' ? '• Mengirim...' : '')}
                        </span>
                      </div>
                    </div>
                    
                    {/* Action buttons - absolute positioned beside the message */}
                    <div className={`absolute top-1/2 -translate-y-1/2 ${isMe ? '-left-[80px]' : '-right-[80px]'} w-[76px] opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-1 px-1`}>
                      <button 
                        className="p-1.5 flex items-center justify-center bg-white border border-slate-200 rounded-full text-slate-400 hover:text-indigo-600 shadow-sm"
                        title="Balas pesan"
                        onClick={() => setReplyingToMessage(msg)}
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                      <button 
                        className="p-1.5 flex items-center justify-center bg-white border border-slate-200 rounded-full text-slate-400 hover:text-indigo-600 shadow-sm"
                        title="Beri reaksi"
                        onClick={() => setReactingToMessageId(reactingToMessageId === msg.id ? null : msg.id)}
                      >
                        <span className="text-sm leading-none block px-0.5 mt-0.5">😀</span>
                      </button>
                    </div>

                    {/* Reaction popup */}
                    {reactingToMessageId === msg.id && (
                      <div className={`absolute bottom-full mb-2 ${isMe ? 'right-0' : 'left-0'} z-10 bg-white border border-slate-200 shadow-xl rounded-full px-3 py-2 flex gap-2 animate-in fade-in slide-in-from-bottom-2`}>
                        {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                          <button 
                            key={emoji}
                            className="text-xl hover:scale-125 transition-transform origin-bottom"
                            onClick={() => {
                              handleReaction(msg.id, emoji);
                              setReactingToMessageId(null);
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                        {/* Remove reaction option if already reacted by me */}
                        {msg.reactions?.some(r => r.fromMe) && (
                          <button 
                            className="text-lg text-slate-400 hover:text-red-500 ml-1 border-l pl-2 border-slate-200"
                            title="Hapus reaksi"
                            onClick={() => {
                              handleReaction(msg.id, "");
                              setReactingToMessageId(null);
                            }}
                          >
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
                    <p className="text-xs font-semibold text-indigo-600 mb-0.5">{replyingToMessage.from === 'me' ? 'Anda' : activeChat.name}</p>
                    <p className="text-sm text-slate-600 line-clamp-1">
                      {replyingToMessage.type === 'text' ? replyingToMessage.text?.body : replyingToMessage.type === 'image' ? (replyingToMessage.image?.caption || 'Foto') : replyingToMessage.type === 'video' ? (replyingToMessage.video?.caption || 'Video') : replyingToMessage.type === 'document' ? (replyingToMessage.document?.filename || 'Dokumen') : 'Pesan'}
                    </p>
                  </div>
                  <button 
                    onClick={() => setReplyingToMessage(null)}
                    className="p-3 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              )}
              {attachment && (
                <div className="flex items-center gap-3 p-2 bg-slate-50 border border-slate-200 rounded-xl relative">
                  {attachment.type.startsWith('image/') ? (
                    <img src={URL.createObjectURL(attachment)} alt="preview" className="w-16 h-16 object-cover rounded-lg" />
                  ) : (
                    <div className="w-16 h-16 bg-slate-200 rounded-lg flex items-center justify-center">
                      <Paperclip className="w-8 h-8 text-slate-400" />
                    </div>
                  )}
                  <div className="flex-1 truncate text-sm font-medium text-slate-700">
                    {attachment.name}
                  </div>
                  <button 
                    onClick={() => {
                      setAttachment(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="p-1.5 bg-rose-100 text-rose-600 rounded-lg hover:bg-rose-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <div className="flex items-end space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 relative">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  disabled={!activeChatWindow.isOpen}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setAttachment(file);
                  }}
                  accept="image/*,video/*,application/pdf"
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!activeChatWindow.isOpen}
                  className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 transition-colors mb-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <textarea 
                  value={inputText}
                  disabled={!activeChatWindow.isOpen}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && activeChatWindow.isOpen) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder={activeChatWindow.isOpen ? "Ketik balasan Anda..." : "Sesi ditutup (Waktu 24 jam habis)"} 
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2.5 px-2 focus:outline-none resize-none disabled:text-slate-400 disabled:cursor-not-allowed" 
                  rows={Math.min(Math.max(inputText.split('\n').length, 1), 5)}
                />
                <button 
                  onClick={handleSendMessage}
                  disabled={(!inputText.trim() && !attachment) || isUploading || !activeChatWindow.isOpen}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 flex flex-row items-center gap-2 mb-0.5"
                >
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
        <aside className="w-64 bg-white border-l border-slate-200 p-6 flex flex-col overflow-y-auto">
          <div className="text-center">
            <div className="w-20 h-20 bg-slate-100 rounded-full mx-auto mb-4 border-2 border-slate-200 flex items-center justify-center text-slate-400 text-2xl font-bold">
              {activeChat.name.charAt(0)}
            </div>
            <h3 className="font-bold text-slate-900">{activeChat.name}</h3>
            <p className="text-xs text-slate-500 mt-1">Jakarta, Indonesia</p>
          </div>

          <div className="mt-8 space-y-6">
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Kontak Details</h4>
              <div className="space-y-2">
                <div className="text-sm text-slate-700 font-medium flex justify-between">
                  <span>WA:</span> 
                  <span className="text-slate-500">{activeChat.phone}</span>
                </div>
                <div className="text-sm text-slate-700 font-medium flex justify-between">
                  <span>ID:</span> 
                  <span className="text-slate-500">CUST-{activeChat.phone.slice(-4)}</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Riwayat Pesanan</h4>
              <div className="space-y-3">
                <div className="p-2 bg-slate-50 rounded border border-slate-100">
                  <p className="text-xs font-bold text-slate-800">Order #8829</p>
                  <p className="text-[10px] text-slate-500">Pending • Rp 450.000</p>
                </div>
                <div className="p-2 bg-slate-50 rounded border border-slate-100">
                  <p className="text-xs font-bold text-slate-800">Order #8712</p>
                  <p className="text-[10px] text-slate-500">Selesai • Rp 1.200.000</p>
                </div>
              </div>
            </div>

            <div className="mt-auto pt-4">
              <button className="w-full border border-slate-200 text-slate-600 py-2 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors">
                Lihat Profil Lengkap
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
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
              
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <h3 className="text-sm font-bold text-slate-800 mb-2">Konfigurasi Webhook</h3>
                <p className="text-xs text-slate-500 mb-4">Gunakan konfigurasi ini di Meta App Dashboard (WhatsApp &gt; Configuration).</p>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Callback URL</label>
                    <div className="flex">
                      <input 
                        type="text" 
                        readOnly 
                        value={`${window.location.origin}/api/webhook`} 
                        className="w-full bg-white border border-slate-300 rounded-l-lg py-1.5 px-3 text-sm focus:outline-none"
                      />
                      <button 
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/webhook`)}
                        className="bg-slate-200 text-slate-700 px-3 py-1.5 rounded-r-lg text-xs font-bold hover:bg-slate-300 border border-l-0 border-slate-300"
                      >Copy</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Verify Token</label>
                    <div className="flex">
                      <input 
                        type="text" 
                        readOnly 
                        value="my-verify-token" 
                        className="w-full bg-white border border-slate-300 rounded-l-lg py-1.5 px-3 text-sm focus:outline-none"
                      />
                      <button 
                        onClick={() => navigator.clipboard.writeText("my-verify-token")}
                        className="bg-slate-200 text-slate-700 px-3 py-1.5 rounded-r-lg text-xs font-bold hover:bg-slate-300 border border-l-0 border-slate-300"
                      >Copy</button>
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
                    <input 
                      type="text" 
                      value={config.phoneNumberId}
                      onChange={e => setConfig({...config, phoneNumberId: e.target.value})}
                      placeholder="Misal: 1059345267..." 
                      className="w-full bg-white border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Access Token / Permanent Token</label>
                    <input 
                      type="password" 
                      value={config.accessToken}
                      onChange={e => setConfig({...config, accessToken: e.target.value})}
                      placeholder="EAAL..." 
                      className="w-full bg-white border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end space-x-2">
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800"
              >
                Batal
              </button>
              <button 
                onClick={() => {
                  localStorage.setItem('wa_phone_number_id', config.phoneNumberId);
                  localStorage.setItem('wa_access_token', config.accessToken);
                  setIsSettingsOpen(false);
                }}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700"
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Image Modal */}
      {fullscreenImage && (
        <div 
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] p-4 cursor-zoom-out"
          onClick={() => setFullscreenImage(null)}
        >
          <img 
            src={fullscreenImage} 
            alt="Fullscreen" 
            className="max-w-full max-h-screen object-contain"
          />
          <button 
            className="absolute top-4 right-4 text-white bg-black/50 p-2 rounded-full hover:bg-black/70 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setFullscreenImage(null);
            }}
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}